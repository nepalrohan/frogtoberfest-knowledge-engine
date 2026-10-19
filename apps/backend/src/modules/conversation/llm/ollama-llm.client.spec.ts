import { OllamaLlmClient } from './ollama-llm.client';
import { LlmUnavailableError } from './llm-unavailable.error';
import type { AppConfigService } from '../../../config';

/* A fetch Response whose body yields the given string chunks, then optionally hangs */
const ndjsonResponse = (chunks: string[], { hang = false } = {}) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!hang) controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
};

const line = (obj: object) => `${JSON.stringify(obj)}\n`;

describe('OllamaLlmClient', () => {
  const config = {
    llm: {
      baseUrl: 'http://ollama:11434/',
      chatModel: 'phi4-mini',
      temperature: 0.1,
      numCtx: 8192,
      idleTimeoutMs: 50,
      rewriteTimeoutMs: 8000,
    },
  } as unknown as AppConfigService;
  const messages = [{ role: 'user' as const, content: 'How do I roll back?' }];
  let fetchMock: jest.Mock;
  let client: OllamaLlmClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    client = new OllamaLlmClient(config);
  });

  it('streams deltas in order across split chunks and returns text with token usage', async () => {
    const payload =
      line({ message: { content: 'Redeploy ' }, done: false }) +
      line({ message: { content: 'the tag.' }, done: false }) +
      line({
        message: { content: '' },
        done: true,
        prompt_eval_count: 42,
        eval_count: 7,
      });
    fetchMock.mockResolvedValue(
      ndjsonResponse([
        payload.slice(0, 20),
        payload.slice(20, 55),
        payload.slice(55),
      ]),
    );
    const deltas: string[] = [];

    const result = await client.streamChat(messages, {
      onToken: (d) => deltas.push(d),
    });

    expect(deltas).toEqual(['Redeploy ', 'the tag.']);
    expect(result).toEqual({
      text: 'Redeploy the tag.',
      model: 'phi4-mini',
      promptTokens: 42,
      completionTokens: 7,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ollama:11434/api/chat');
    expect(JSON.parse(init.body)).toEqual({
      model: 'phi4-mini',
      messages,
      stream: true,
      options: { temperature: 0.1, num_ctx: 8192 },
    });
  });

  it('maps an unreachable model server to a retryable LLM_UNAVAILABLE error', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      }),
    );
    const error = await client
      .streamChat(messages, { onToken: () => undefined })
      .catch((e) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect(error).toMatchObject({ code: 'LLM_UNAVAILABLE', retryable: true });
  });

  it('maps an HTTP error or an in-stream error line to LLM_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('model not found', { status: 404 }),
    );
    await expect(
      client.streamChat(messages, { onToken: () => undefined }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);

    fetchMock.mockResolvedValueOnce(
      ndjsonResponse([line({ error: 'model crashed' })]),
    );
    await expect(
      client.streamChat(messages, { onToken: () => undefined }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('times out when no chunk arrives within the idle timeout', async () => {
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      const response = ndjsonResponse(
        [line({ message: { content: 'Partial' }, done: false })],
        { hang: true },
      );
      init.signal?.addEventListener('abort', () =>
        response.body?.cancel().catch(() => undefined),
      );
      return response;
    });
    const deltas: string[] = [];

    const error = await client
      .streamChat(messages, { onToken: (d) => deltas.push(d) })
      .catch((e) => e);

    expect(deltas).toEqual(['Partial']);
    expect(error).toBeInstanceOf(LlmUnavailableError);
  });

  it('rejects with AbortError, not LLM_UNAVAILABLE, when the caller aborts', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      );
    });

    const pending = client.streamChat(messages, {
      signal: controller.signal,
      onToken: () => undefined,
    });
    controller.abort();
    const error = await pending.catch((e) => e);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(error).not.toBeInstanceOf(LlmUnavailableError);
  });

  it('fails fast without calling the server after 5 consecutive failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    for (let i = 0; i < 5; i++) {
      await client
        .streamChat(messages, { onToken: () => undefined })
        .catch(() => undefined);
    }
    fetchMock.mockClear();

    const error = await client
      .streamChat(messages, { onToken: () => undefined })
      .catch((e) => e);

    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a non-streamed completion', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        message: { content: 'standalone query' },
        done: true,
        prompt_eval_count: 9,
        eval_count: 3,
      }),
    );
    const result = await client.complete(messages, { timeoutMs: 1000 });
    expect(result).toEqual({
      text: 'standalone query',
      model: 'phi4-mini',
      promptTokens: 9,
      completionTokens: 3,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      stream: false,
    });
  });
});
