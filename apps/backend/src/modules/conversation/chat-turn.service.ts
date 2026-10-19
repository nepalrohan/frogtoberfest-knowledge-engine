import { Inject, Injectable } from '@nestjs/common';
import { isValidTraceId } from '@opentelemetry/api';
import { randomBytes, randomUUID } from 'crypto';
import { AppConfigService } from '../../config';
import { AppTracer } from '../../common/telemetry';
import { StructuredLogger } from '../../common/logger/structured-logger';
import { LogEvents } from '../../common/logger/log-events';
import {
  EMBEDDING_PROVIDER_TOKEN,
  type IEmbeddingProvider,
} from '../indexing/embedding/embedding.interface';
import { VectorStoreService } from '../indexing/retrieval/vector-store.service';
import { ConversationService, type BegunTurn } from './conversation.service';
import { LLM_CLIENT, type ILlmClient } from './llm/llm-client.interface';
import { selectContext } from './retrieval/context-selector';
import { INSUFFICIENT_EVIDENCE_TEXT } from './generation/answer-text';
import { buildAnswerPrompt } from './generation/prompt-builder';
import { verifyCitations } from './generation/citation-verifier';
import { rewriteFollowUp } from './generation/query-rewriter';
import { LlmUnavailableError } from './llm/llm-unavailable.error';
import type {
  AnswerOutcome,
  ChatSource,
  ChatStreamEvent,
  PipelineStage,
  RefusalReason,
  RunDetails,
  StageTiming,
} from './chat.types';

export interface TurnSink {
  emit: (event: ChatStreamEvent) => void;
  /* Fires when the client disconnects; the turn stores what it has and stops */
  signal: AbortSignal;
}

interface TurnOutcome {
  content: string;
  outcome: AnswerOutcome;
  refusalReason?: RefusalReason;
  sources: ChatSource[];
  /* Refusal text never came from the model, so it still has to be streamed */
  streamContent: boolean;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/* Runs one question-to-answer turn: embed, retrieve, select context, generate; reports progress as stream events */
@Injectable()
export class ChatTurnService {
  private readonly logger = new StructuredLogger(ChatTurnService.name);

  constructor(
    private readonly conversations: ConversationService,
    @Inject(LLM_CLIENT) private readonly llm: ILlmClient,
    @Inject(EMBEDDING_PROVIDER_TOKEN)
    private readonly embeddings: IEmbeddingProvider,
    private readonly vectorStore: VectorStoreService,
    private readonly config: AppConfigService,
  ) {}

  /* Runs the turn inside one trace so the meta event, stored run details and logs share its id */
  async answer(turn: BegunTurn, sink: TurnSink): Promise<void> {
    return AppTracer.traceSpan(
      'chat.turn',
      {
        attributes: {
          'chat.conversation_id': turn.conversation.id,
          'chat.follow_up': turn.history.length > 0,
        },
      },
      async (span) => {
        /* Without an OpenTelemetry SDK the span is a no-op with an all-zero id; fall back to a fresh one */
        const spanTraceId = span.spanContext().traceId;
        const traceId = isValidTraceId(spanTraceId)
          ? spanTraceId
          : randomBytes(16).toString('hex');
        return this.runTurn(turn, sink, traceId);
      },
    );
  }

  private async runTurn(
    turn: BegunTurn,
    sink: TurnSink,
    traceId: string,
  ): Promise<void> {
    const startedAt = Date.now();
    const assistantMessageId = randomUUID();
    const embeddingModel = this.embeddings.getModelName();
    const retrieval = this.config.retrieval;
    const question = turn.userMessage.content;
    const stages: StageTiming[] = [];
    let partial = '';
    let candidatesRetrieved = 0;
    let contextTokens = 0;
    let rewrittenQuery: string | undefined;

    /* Wraps one pipeline stage with started/completed events and a recorded duration */
    const timed = async <T>(
      stage: PipelineStage,
      work: () => Promise<T>,
    ): Promise<T> => {
      sink.emit({ type: 'stage', stage, status: 'started' });
      const stageStartedAt = Date.now();
      const result = await work();
      const durationMs = Date.now() - stageStartedAt;
      stages.push({ stage, durationMs });
      sink.emit({ type: 'stage', stage, status: 'completed', durationMs });
      return result;
    };

    const finish = async (result: TurnOutcome): Promise<void> => {
      if (result.streamContent) {
        sink.emit({ type: 'token', delta: result.content });
      }
      const run: RunDetails = {
        traceId,
        model: result.model,
        embeddingModel,
        ...(rewrittenQuery ? { rewrittenQuery } : {}),
        candidatesRetrieved,
        contextTokens,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalLatencyMs: Date.now() - startedAt,
        stages,
      };
      /* The answer is only reported done once it is durably stored */
      await this.conversations.saveAnswer({
        id: assistantMessageId,
        conversationId: turn.conversation.id,
        content: result.content,
        status: 'completed',
        outcome: result.outcome,
        refusalReason: result.refusalReason,
        sources: result.sources,
        run,
      });
      sink.emit({
        type: 'done',
        outcome: result.outcome,
        content: result.content,
        ...(result.refusalReason
          ? { refusalReason: result.refusalReason }
          : {}),
        citedIndexes: result.sources.filter((s) => s.cited).map((s) => s.index),
        run,
      });
      this.logger.logEvent(LogEvents.CHAT_REQUEST_COMPLETED, {
        traceId,
        conversationId: turn.conversation.id,
        outcome: result.outcome,
        refusalReason: result.refusalReason,
        latencyMs: run.totalLatencyMs,
      });
    };

    sink.emit({
      type: 'meta',
      conversationId: turn.conversation.id,
      userMessageId: turn.userMessage.id,
      assistantMessageId,
      traceId,
      conversationTitle: turn.conversation.title,
    });

    try {
      /* Follow-ups are rewritten for retrieval only; the answer prompt keeps the user's own words */
      if (turn.history.length > 0) {
        rewrittenQuery = await timed('rewrite', () =>
          rewriteFollowUp(this.llm, {
            question,
            history: turn.history,
            timeoutMs: this.config.llm.rewriteTimeoutMs,
            signal: sink.signal,
          }),
        );
      }
      const searchQuery = rewrittenQuery ?? question;

      const [queryVector] = await timed('embed', () =>
        this.embeddings.embed([searchQuery], 'query'),
      );
      sink.signal.throwIfAborted();
      const candidates = await timed('retrieve', () =>
        this.vectorStore.searchHybrid(
          searchQuery,
          queryVector ?? [],
          embeddingModel,
          {
            candidateK: retrieval.candidateK,
            signal: sink.signal,
          },
        ),
      );
      candidatesRetrieved = candidates.length;
      const selection = await timed('select', async () =>
        selectContext(candidates, retrieval),
      );

      if (selection.kind === 'insufficient_evidence') {
        this.logger.warnEvent(LogEvents.RETRIEVAL_NO_EVIDENCE, {
          traceId,
          candidates: candidates.length,
          bestSimilarity: selection.bestSimilarity,
        });
        await finish({
          content: INSUFFICIENT_EVIDENCE_TEXT,
          outcome: 'refused',
          refusalReason: 'insufficient_evidence',
          sources: [],
          streamContent: true,
          model: '',
          promptTokens: 0,
          completionTokens: 0,
        });
        return;
      }
      contextTokens = selection.contextTokens;
      this.logger.logEvent(LogEvents.RETRIEVAL_COMPLETED, {
        traceId,
        candidates: candidates.length,
        selectedChunkIds: selection.sources.map((s) => s.chunkId),
        bestSimilarity: selection.bestSimilarity,
      });
      sink.emit({ type: 'sources', sources: selection.sources });

      const prompt = buildAnswerPrompt({
        question,
        history: turn.history,
        sources: selection.sources,
      });
      const generated = await timed('generate', () =>
        this.llm.streamChat(prompt, {
          signal: sink.signal,
          onToken: (delta) => {
            partial += delta;
            sink.emit({ type: 'token', delta });
          },
        }),
      );
      const verified = await timed('verify', async () =>
        verifyCitations(generated.text, selection.sources),
      );
      await finish({
        ...verified,
        streamContent: false,
        model: generated.model,
        promptTokens: generated.promptTokens,
        completionTokens: generated.completionTokens,
      });
    } catch (err) {
      if (!sink.signal.aborted) {
        this.logger.logError(LogEvents.CHAT_REQUEST_FAILED, err, {
          traceId,
          conversationId: turn.conversation.id,
          code:
            err instanceof LlmUnavailableError ? err.code : 'INTERNAL_ERROR',
        });
      }
      if (err instanceof LlmUnavailableError && !sink.signal.aborted) {
        /* A transient model fault is an error the user can retry, never a stored refusal */
        sink.emit({
          type: 'error',
          code: err.code,
          message:
            'The language model is not responding right now. Please try again in a moment.',
          retryable: true,
        });
        return;
      }
      if (!sink.signal.aborted) throw err;
      /* Client left: keep what was generated for display, excluded from future context */
      await this.conversations.saveAnswer({
        id: assistantMessageId,
        conversationId: turn.conversation.id,
        content: partial,
        status: 'stopped',
        sources: [],
      });
    }
  }
}
