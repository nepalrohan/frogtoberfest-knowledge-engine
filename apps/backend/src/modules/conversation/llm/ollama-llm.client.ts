import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config';
import { CircuitBreaker } from '../../../common/resilience/circuit-breaker';
import type { ILlmClient, LlmMessage, LlmResult } from './llm-client.interface';
import { LlmUnavailableError } from './llm-unavailable.error';

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

const abortError = (): DOMException =>
  new DOMException('Aborted', 'AbortError');

/* Local Ollama chat client: NDJSON streaming, idle timeout, caller cancellation, and a circuit breaker */
@Injectable()
export class OllamaLlmClient implements ILlmClient {
  private readonly breaker = new CircuitBreaker({
    name: 'OllamaLlmClient',
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  });

  constructor(private readonly config: AppConfigService) {}

  async streamChat(
    messages: LlmMessage[],
    {
      signal,
      onToken,
    }: { signal?: AbortSignal; onToken: (delta: string) => void },
  ): Promise<LlmResult> {
    const { chatModel, idleTimeoutMs } = this.config.llm;
    return this.guarded(signal, async () => {
      /* Aborts the request whenever the model goes quiet for idleTimeoutMs */
      const idle = new AbortController();
      let idleTimer: NodeJS.Timeout | undefined;
      const touch = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(), idleTimeoutMs);
      };
      const combined = signal
        ? AbortSignal.any([signal, idle.signal])
        : idle.signal;

      touch();
      try {
        const res = await fetch(
          this.url('/api/chat'),
          this.request(messages, true, combined),
        );
        if (!res.ok || !res.body) {
          throw new LlmUnavailableError(
            `Ollama chat failed [${res.status}]: ${await res.text().catch(() => '')}`,
          );
        }

        let text = '';
        let promptTokens = 0;
        let completionTokens = 0;
        await readNdjson(res.body, combined, (chunk) => {
          touch();
          if (chunk.error)
            throw new LlmUnavailableError(`Ollama chat error: ${chunk.error}`);
          const delta = chunk.message?.content ?? '';
          if (delta) {
            text += delta;
            onToken(delta);
          }
          if (chunk.done) {
            promptTokens = chunk.prompt_eval_count ?? 0;
            completionTokens = chunk.eval_count ?? 0;
          }
        });
        return { text, model: chatModel, promptTokens, completionTokens };
      } catch (err) {
        if (signal?.aborted) throw abortError();
        if (idle.signal.aborted)
          throw new LlmUnavailableError(
            `Ollama produced no tokens for ${idleTimeoutMs}ms`,
          );
        throw toUnavailable(err);
      } finally {
        clearTimeout(idleTimer);
      }
    });
  }

  async complete(
    messages: LlmMessage[],
    { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<LlmResult> {
    const { chatModel, rewriteTimeoutMs } = this.config.llm;
    return this.guarded(signal, async () => {
      const timeout = AbortSignal.timeout(timeoutMs ?? rewriteTimeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await fetch(
          this.url('/api/chat'),
          this.request(messages, false, combined),
        );
        if (!res.ok) {
          throw new LlmUnavailableError(
            `Ollama chat failed [${res.status}]: ${await res.text().catch(() => '')}`,
          );
        }
        const body = (await res.json()) as OllamaChatChunk;
        if (body.error)
          throw new LlmUnavailableError(`Ollama chat error: ${body.error}`);
        return {
          text: body.message?.content ?? '',
          model: chatModel,
          promptTokens: body.prompt_eval_count ?? 0,
          completionTokens: body.eval_count ?? 0,
        };
      } catch (err) {
        if (signal?.aborted) throw abortError();
        throw toUnavailable(err);
      }
    });
  }

  /* Runs through the circuit breaker; an open circuit surfaces as LLM_UNAVAILABLE without calling Ollama */
  private async guarded<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) throw abortError();
    try {
      return await this.breaker.execute(work);
    } catch (err) {
      if ((err as { code?: string })?.code === 'CIRCUIT_OPEN') {
        throw new LlmUnavailableError(
          'The language model is temporarily unavailable',
          { cause: err },
        );
      }
      throw err;
    }
  }

  private url(path: string): string {
    return `${this.config.llm.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private request(
    messages: LlmMessage[],
    stream: boolean,
    signal: AbortSignal,
  ): RequestInit {
    const { chatModel, temperature, numCtx } = this.config.llm;
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        messages,
        stream,
        options: { temperature, num_ctx: numCtx },
      }),
      signal,
    };
  }
}

function toUnavailable(err: unknown): LlmUnavailableError {
  if (err instanceof LlmUnavailableError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new LlmUnavailableError(`Ollama request failed: ${message}`, {
    cause: err,
  });
}

/* Reads newline-delimited JSON, racing every read against the signal so a stalled body cannot hang the caller */
async function readNdjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onChunk: (chunk: OllamaChatChunk) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(abortError());
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  aborted.catch(() => undefined);

  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onChunk(JSON.parse(line) as OllamaChatChunk);
        newline = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest) onChunk(JSON.parse(rest) as OllamaChatChunk);
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
