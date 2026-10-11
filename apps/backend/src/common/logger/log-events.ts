/**
 * Crucial domain event identifiers for structured logging across the Knowledge Engine.
 */
export const LogEvents = {
  // Ingestion & Sync
  INGESTION_SYNC_STARTED: 'ingestion.sync.started',
  INGESTION_SYNC_COMPLETED: 'ingestion.sync.completed',
  INGESTION_SYNC_FAILED: 'ingestion.sync.failed',

  // Indexing & Embedding
  INDEXING_STARTED: 'indexing.started',
  INDEXING_COMPLETED: 'indexing.completed',
  INDEXING_FAILED: 'indexing.failed',
  JOB_STALE_SKIPPED: 'job.stale_skipped',

  // Outbox Relay
  OUTBOX_PUBLISH_FAILED: 'outbox.publish.failed',

  // Retrieval & RAG
  RETRIEVAL_COMPLETED: 'retrieval.completed',
  RETRIEVAL_NO_EVIDENCE: 'retrieval.no_evidence',
  RETRIEVAL_FAILED: 'retrieval.failed',

  // Chat & LLM Generation
  CHAT_REQUEST_COMPLETED: 'chat.request.completed',
  CHAT_REQUEST_FAILED: 'chat.request.failed',
} as const;

export type LogEvent = (typeof LogEvents)[keyof typeof LogEvents] | string;
