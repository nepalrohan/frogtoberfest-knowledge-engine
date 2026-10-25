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
  OUTBOX_PUBLISHED: 'outbox.published',
  OUTBOX_DEAD_LETTERED: 'outbox.dead_lettered',

  // Connector Sync Jobs
  SYNC_JOB_DEAD_LETTERED: 'sync.job.dead_lettered',
  SYNC_JOB_DLQ_WRITE_FAILED: 'sync.job.dlq_write_failed',

  // Canonical Documents
  DOCUMENT_VERSION_PUBLISHED: 'document.version.published',
  DOCUMENT_PUBLICATION_REJECTED: 'document.publication.rejected',

  // Retrieval & RAG
  RETRIEVAL_COMPLETED: 'retrieval.completed',
  RETRIEVAL_NO_EVIDENCE: 'retrieval.no_evidence',
  RETRIEVAL_FAILED: 'retrieval.failed',
  RETRIEVAL_RERANK_FAILED: 'retrieval.rerank_failed',

  // Chat & LLM Generation
  CHAT_REQUEST_COMPLETED: 'chat.request.completed',
  CHAT_REQUEST_FAILED: 'chat.request.failed',
  CHAT_ANSWER_CACHE_HIT: 'chat.answer_cache.hit',
  CHAT_PROMPT_TRIMMED: 'chat.prompt.trimmed',
} as const;

export type LogEvent = (typeof LogEvents)[keyof typeof LogEvents] | string;
