import {
  trace,
  context,
  Context,
  Span,
  SpanKind,
  SpanStatusCode,
  SpanOptions,
  Tracer,
} from '@opentelemetry/api';
import { TraceContextPropagator } from './trace-context.propagator';

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export const TRACER_NAME = 'knowledge-engine';

export const SemanticAttributes = {
  // Standard Messaging Semantics
  MESSAGING_SYSTEM: 'messaging.system',
  MESSAGING_DESTINATION_NAME: 'messaging.destination.name',
  MESSAGING_OPERATION: 'messaging.operation',
  MESSAGING_MESSAGE_ID: 'messaging.message.id',
  MESSAGING_BATCH_COUNT: 'messaging.batch.message_count',

  // Knowledge Engine Domains
  KE_JOB_ID: 'knowledge_engine.job_id',
  KE_EVENT_ID: 'knowledge_engine.event_id',
  KE_DOCUMENT_ID: 'knowledge_engine.document_id',
  KE_VERSION_ID: 'knowledge_engine.version_id',
  KE_CHUNK_ID: 'knowledge_engine.chunk_id',
  KE_TENANT_ID: 'knowledge_engine.tenant_id',
  KE_STAGE: 'knowledge_engine.stage',
  KE_ATTEMPT: 'knowledge_engine.attempt',

  // RAG & Chat Semantics
  RAG_QUERY: 'rag.query',
  RAG_TOP_K: 'rag.top_k',
  RAG_RETRIEVED_COUNT: 'rag.retrieved_count',
  RAG_HIGHEST_SCORE: 'rag.highest_score',
  RAG_CANDIDATE_IDS: 'rag.candidate_ids',
  RAG_LLM_MODEL: 'rag.llm.model',
  RAG_INSUFFICIENT_EVIDENCE: 'rag.insufficient_evidence',

  // Error Classification
  ERROR_TYPE: 'error.type',
  ERROR_RETRYABLE: 'error.retryable',
} as const;

let providerRegistered = false;

export class AppTracer {
  private static tracerInstance: Tracer;

  static getTracer(): Tracer {
    if (!providerRegistered) {
      try {
        const provider = new NodeTracerProvider();
        provider.register();
      } catch {
        // Provider already registered
      }
      providerRegistered = true;
    }

    if (!this.tracerInstance) {
      this.tracerInstance = trace.getTracer(TRACER_NAME);
    }
    return this.tracerInstance;
  }

  /**
   * Executes an asynchronous operation inside a named OpenTelemetry span.
   * Handles exception recording, span status updates, and graceful termination.
   */
  static async traceSpan<T>(
    spanName: string,
    options: SpanOptions,
    fn: (span: Span) => Promise<T>,
    parentCtx?: Context,
  ): Promise<T> {
    const tracer = this.getTracer();
    const activeContext = parentCtx || context.active();

    return tracer.startActiveSpan(
      spanName,
      options,
      activeContext,
      async (span) => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error: any) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          if (error && typeof error === 'object') {
            if (error.code || error.name) {
              span.setAttribute(
                SemanticAttributes.ERROR_TYPE,
                String(error.code || error.name),
              );
            }
          }
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  /**
   * Starts a consumer / worker span for an asynchronous job or outbox event.
   * Preserves parent trace context using W3C traceparent extracted from carrier.
   */
  static async traceConsumer<T>(
    spanName: string,
    attributes: Record<string, any> | null | undefined,
    fn: (span: Span) => Promise<T>,
    spanOptions: Partial<SpanOptions> = {},
  ): Promise<T> {
    const extractedCtx = TraceContextPropagator.extractFromCarrier(attributes);

    return this.traceSpan(
      spanName,
      {
        kind: SpanKind.CONSUMER,
        ...spanOptions,
      },
      fn,
      extractedCtx,
    );
  }
}
