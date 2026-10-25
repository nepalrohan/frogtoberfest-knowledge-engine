/* Lifecycle of a transactional outbox row; dead_lettered rows are terminal and never claimed again */
export type OutboxStatus = 'pending' | 'publishing' | 'published' | 'dead_lettered';

/* Normalized view of any outbox row, independent of the owning table's column names */
export interface OutboxRecord<TPayload> {
  id: string;
  payload: TPayload;
  attemptCount: number;
}

/* Result of one publish attempt, persisted in bulk at the end of a relay cycle */
export interface OutboxOutcome {
  id: string;
  status: Exclude<OutboxStatus, 'publishing'>;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  publishedAt: Date | null;
}

/* Storage port each outbox table implements so the shared relay can drain it */
export interface IOutboxStore<TPayload> {
  /* Atomically leases up to batchSize claimable rows; locks are released before this resolves */
  claimBatch(batchSize: number, leaseMs: number): Promise<OutboxRecord<TPayload>[]>;
  /* Persists every outcome of a batch in a single round-trip */
  recordOutcomes(outcomes: OutboxOutcome[]): Promise<void>;
}
