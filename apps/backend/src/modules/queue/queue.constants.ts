/* Queue name constants across the Knowledge Engine */
export const EMBEDDING_QUEUE_NAME = 'embedding-queue';
export const INGESTION_QUEUE_NAME = 'ingestion-queue';

export const EMBEDDING_QUEUE_TOKEN = Symbol('EMBEDDING_QUEUE_TOKEN');

/* Payload contract for BullMQ embedding jobs */
export interface EmbeddingJobPayload {
  documentId: string;
  documentVersion: number;
  sourceType: string;
  title: string;
  traceCarrier?: Record<string, unknown>;
}
