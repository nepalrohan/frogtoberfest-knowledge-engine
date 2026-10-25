import type { TraceContextCarrier } from '../../common/telemetry';
import type { ErrorCategory } from '../../common/resilience/error-classifier';

/* Queue name constants across the Knowledge Engine */
export const EMBEDDING_QUEUE_NAME = 'embedding-queue';
export const INGESTION_SYNC_QUEUE_NAME = 'ingestion-sync-queue';
export const INGESTION_SYNC_DLQ_NAME = 'ingestion-sync-dlq';

export const EMBEDDING_QUEUE_TOKEN = Symbol('EMBEDDING_QUEUE_TOKEN');
export const INGESTION_SYNC_QUEUE_TOKEN = Symbol('INGESTION_SYNC_QUEUE_TOKEN');
export const INGESTION_SYNC_DLQ_TOKEN = Symbol('INGESTION_SYNC_DLQ_TOKEN');

/* Payload contract for BullMQ embedding jobs */
export interface EmbeddingJobPayload {
  documentId: string;
  documentVersion: number;
  sourceType: string;
  title: string;
  traceCarrier?: Record<string, unknown>;
}

/* Knowledge providers that can produce connector sync jobs */
export const SYNC_PROVIDERS = ['notion', 'confluence'] as const;
export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

/* Narrows a persisted provider string to a sync-capable provider */
export function isSyncProvider(value: string): value is SyncProvider {
  return (SYNC_PROVIDERS as readonly string[]).includes(value);
}

/* Payload contract for BullMQ connector resource sync jobs; trace context rides on the payload itself */
export interface SyncResourceJobPayload extends TraceContextCarrier {
  syncItemId: string;
  connectionId: string;
  provider: SyncProvider;
  externalResourceId: string;
  resourceType: string;
  outboxEventId?: string;
}

/* Dead-letter entry recorded when a sync job can never succeed */
export interface SyncDeadLetterPayload {
  originalJobId: string;
  payload: SyncResourceJobPayload;
  errorMessage: string;
  errorCategory: ErrorCategory;
  attemptsMade: number;
  failedAt: string;
  traceparent?: string;
  tracestate?: string;
}
