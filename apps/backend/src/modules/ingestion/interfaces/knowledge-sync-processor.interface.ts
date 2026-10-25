import { NormalizedDocumentPayload } from '../types';

/* Result status of a resource synchronization execution */
export type SyncExecutionStatus = 'NO_OP' | 'UPDATED' | 'FAILED';

/* Details of sync outcome returned by a connector sync processor */
export interface SyncExecutionResult {
  status: SyncExecutionStatus;
  externalResourceId: string;
  observedRevision?: string | null;
  contentFingerprint?: string | null;
  normalizedPayload?: NormalizedDocumentPayload | null;
  error?: Error | null;
}

/* Parameters passed to a knowledge provider sync processor */
export interface SyncResourceParams {
  connectionId: string;
  externalResourceId: string;
  lastObservedRevision?: string | null;
  lastProcessedFingerprint?: string | null;
}

/* Provider-neutral sync processor interface allowing each connector to execute change detection and retrieval */
export interface KnowledgeSyncProcessor {
  readonly provider: string;
  syncResource(params: SyncResourceParams): Promise<SyncExecutionResult>;
}
