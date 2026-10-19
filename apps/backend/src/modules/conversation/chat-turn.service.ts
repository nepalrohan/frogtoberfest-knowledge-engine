import { Inject, Injectable } from '@nestjs/common';
import { isValidTraceId } from '@opentelemetry/api';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AppConfigService } from '../../config';
import { AppTracer } from '../../common/telemetry';
import { StructuredLogger } from '../../common/logger/structured-logger';
import { LogEvents } from '../../common/logger/log-events';
import {
  EMBEDDING_PROVIDER_TOKEN,
  type IEmbeddingProvider,
} from '../indexing/embedding/embedding.interface';
import { VectorStoreService } from '../indexing/retrieval/vector-store.service';
import {
  ConversationService,
  type BegunTurn,
  type CachedAnswer,
} from './conversation.service';
import { LLM_CLIENT, type ILlmClient } from './llm/llm-client.interface';
import { TokenCounter } from '../indexing/chunker/token-counter';
import type { ChunkCandidate } from '../indexing/retrieval/vector-store.service';
import { selectContext } from './retrieval/context-selector';
import { explainInsufficientEvidence } from './generation/answer-text';
import { fitAnswerPrompt } from './generation/prompt-builder';
import {
  declaresNoEvidence,
  verifyCitations,
} from './generation/citation-verifier';
import { needsRewrite, rewriteFollowUp } from './generation/query-rewriter';
import { FirstSentenceGate } from './generation/first-sentence-gate';
import { RERANKER, type IReranker } from './rerank/reranker.interface';
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
  /* Diagnostics only some paths produce (cache reuse, trimming, citation support) */
  runExtras?: Partial<RunDetails>;
  /* Set on grounded answers to standalone questions so they can be reused */
  answerCacheKey?: string;
}

/* Same question (ignoring case, spacing and trailing punctuation) answered by the same models */
function answerCacheKey(question: string, models: string[]): string {
  const normalized = question
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s?.!]+$/, '')
    .trim();
  return createHash('sha256')
    .update([...models, normalized].join('\n'))
    .digest('hex');
}

const uniqueTitles = (sources: { documentTitle: string }[]): string[] => [
  ...new Set(sources.map((s) => s.documentTitle)),
];

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
    @Inject(RERANKER) private readonly reranker: IReranker,
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
        ...result.runExtras,
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
        answerCacheKey: result.answerCacheKey,
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
      const { llm, chat } = this.config;
      const cacheKey =
        turn.history.length === 0 && chat.answerCacheTtlSeconds > 0
          ? answerCacheKey(question, [
              llm.chatModel,
              embeddingModel,
              this.reranker.enabled ? 'reranked' : 'fused',
            ])
          : undefined;
      const cached =
        cacheKey &&
        (await this.conversations.findCachedAnswer(
          cacheKey,
          chat.answerCacheTtlSeconds,
        ));
      if (cached) {
        await this.replayCached(cached, sink, finish, traceId);
        return;
      }

      /* Follow-ups are rewritten for retrieval only, and only when they lean on earlier turns */
      if (turn.history.length > 0 && needsRewrite(question)) {
        rewrittenQuery = await timed('rewrite', () =>
          rewriteFollowUp(this.llm, {
            question,
            history: turn.history,
            timeoutMs: llm.rewriteTimeoutMs,
            signal: sink.signal,
          }),
        );
      }
      const searchQuery = rewrittenQuery ?? question;

      const [queryVector] = await timed('embed', () =>
        this.embeddings.embed([searchQuery], 'query'),
      );
      sink.signal.throwIfAborted();
      let candidates = await timed('retrieve', () =>
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
      let reranked = false;
      if (this.reranker.enabled && candidates.length > 1) {
        const ordered = await timed('rerank', () =>
          this.rerank(searchQuery, candidates, sink.signal, traceId),
        );
        reranked = ordered !== candidates;
        candidates = ordered;
      }
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
          content: explainInsufficientEvidence(selection.closestDocuments),
          outcome: 'refused',
          refusalReason: 'insufficient_evidence',
          sources: [],
          streamContent: true,
          model: '',
          promptTokens: 0,
          completionTokens: 0,
          runExtras: reranked ? { reranked } : undefined,
        });
        return;
      }

      /* Ollama cuts an overlong prompt from the start, losing the rules; trim history and sources instead */
      const fitted = fitAnswerPrompt({
        question,
        history: turn.history,
        sources: selection.sources,
        maxPromptTokens: llm.numCtx - llm.answerReserveTokens,
      });
      if (fitted.historyDropped > 0 || fitted.sourcesDropped > 0) {
        this.logger.warnEvent(LogEvents.CHAT_PROMPT_TRIMMED, {
          traceId,
          historyDropped: fitted.historyDropped,
          sourcesDropped: fitted.sourcesDropped,
          promptTokens: fitted.promptTokens,
        });
      }
      const sources = fitted.sources;
      contextTokens = sources.reduce(
        (total, s) => total + TokenCounter.countTokens(s.snippet),
        0,
      );
      this.logger.logEvent(LogEvents.RETRIEVAL_COMPLETED, {
        traceId,
        candidates: candidates.length,
        selectedChunkIds: sources.map((s) => s.chunkId),
        bestSimilarity: selection.bestSimilarity,
        reranked,
      });
      sink.emit({ type: 'sources', sources });

      const gate = new FirstSentenceGate(
        (delta) => sink.emit({ type: 'token', delta }),
        declaresNoEvidence,
      );
      const generated = await timed('generate', async () => {
        const result = await this.llm.streamChat(fitted.messages, {
          signal: sink.signal,
          onToken: (delta) => {
            partial += delta;
            gate.push(delta);
          },
        });
        gate.end();
        return result;
      });
      const verified = await timed('verify', async () =>
        verifyCitations(generated.text, sources),
      );
      const refusedForEvidence =
        verified.outcome === 'refused' &&
        verified.refusalReason === 'insufficient_evidence';
      await finish({
        ...verified,
        content: refusedForEvidence
          ? explainInsufficientEvidence(uniqueTitles(sources))
          : verified.content,
        /* A refusal held back by the gate has not been shown yet */
        streamContent: gate.suppressed,
        model: generated.model,
        promptTokens: generated.promptTokens,
        completionTokens: generated.completionTokens,
        runExtras: {
          ...(reranked ? { reranked } : {}),
          ...(fitted.historyDropped
            ? { historyDropped: fitted.historyDropped }
            : {}),
          ...(fitted.sourcesDropped
            ? { sourcesDropped: fitted.sourcesDropped }
            : {}),
          ...(verified.unsupportedCitations
            ? { unsupportedCitations: verified.unsupportedCitations }
            : {}),
        },
        answerCacheKey: verified.outcome === 'answered' ? cacheKey : undefined,
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

  /* Orders candidates by cross-encoder score; any reranker failure keeps the fused order */
  private async rerank(
    query: string,
    candidates: ChunkCandidate[],
    signal: AbortSignal,
    traceId: string,
  ): Promise<ChunkCandidate[]> {
    try {
      const scores = await this.reranker.rerank(
        query,
        candidates.map((c) => c.content),
        { signal },
      );
      return candidates
        .map((candidate, i) => ({
          candidate,
          score: scores[i] ?? Number.NEGATIVE_INFINITY,
        }))
        .sort((a, b) => b.score - a.score)
        .map(({ candidate }) => candidate);
    } catch (err) {
      if (signal.aborted) throw err;
      this.logger.logError(LogEvents.RETRIEVAL_RERANK_FAILED, err, { traceId });
      return candidates;
    }
  }

  /* Answers from an identical earlier question whose cited documents have not changed */
  private async replayCached(
    cached: CachedAnswer,
    sink: TurnSink,
    finish: (result: TurnOutcome) => Promise<void>,
    traceId: string,
  ): Promise<void> {
    this.logger.logEvent(LogEvents.CHAT_ANSWER_CACHE_HIT, {
      traceId,
      cachedFromMessageId: cached.messageId,
    });
    sink.emit({ type: 'sources', sources: cached.sources });
    await finish({
      content: cached.content,
      outcome: 'answered',
      sources: cached.sources,
      streamContent: true,
      model: cached.run.model,
      promptTokens: 0,
      completionTokens: 0,
      runExtras: {
        cachedFromMessageId: cached.messageId,
        contextTokens: cached.run.contextTokens,
      },
    });
  }
}
