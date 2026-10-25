import type { DataSource } from 'typeorm';
import type { OutboxOutcome, OutboxRecord } from './outbox.types';

/* Physical column names of an outbox table; the two outboxes predate a shared naming scheme */
export interface OutboxTableSpec {
  table: string;
  attemptColumn: string;
  errorColumn: string;
}

/* Leases claimable rows in one statement: SKIP LOCKED keeps instances disjoint and locks end with the statement */
export async function claimOutboxRows<TPayload>(
  dataSource: DataSource,
  spec: OutboxTableSpec,
  batchSize: number,
  leaseMs: number,
): Promise<OutboxRecord<TPayload>[]> {
  /* The CTE turns UPDATE ... RETURNING into a plain SELECT result set */
  return dataSource.query<OutboxRecord<TPayload>[]>(
    `WITH claimed AS (
       UPDATE "${spec.table}" SET "status" = 'publishing', "claimed_at" = now()
       WHERE "id" IN (
         SELECT "id" FROM "${spec.table}"
         WHERE ("status" = 'pending' AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= now()))
            OR ("status" = 'publishing' AND "claimed_at" < now() - make_interval(secs => $2::double precision / 1000))
         ORDER BY "created_at" ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING "id", "payload", "${spec.attemptColumn}" AS "attemptCount", "created_at"
     )
     SELECT "id", "payload", "attemptCount" FROM claimed ORDER BY "created_at" ASC`,
    [batchSize, leaseMs],
  );
}

/* Writes every outcome of a relay cycle with a single UPDATE ... FROM unnest(...) */
export async function recordOutboxOutcomes(
  dataSource: DataSource,
  spec: OutboxTableSpec,
  outcomes: OutboxOutcome[],
): Promise<void> {
  if (outcomes.length === 0) {
    return;
  }
  await dataSource.query(
    `UPDATE "${spec.table}" AS t SET
       "status" = o.status,
       "${spec.attemptColumn}" = o.attempt_count,
       "next_attempt_at" = o.next_attempt_at,
       "${spec.errorColumn}" = o.last_error,
       "published_at" = COALESCE(o.published_at, t."published_at"),
       "claimed_at" = NULL
     FROM unnest($1::uuid[], $2::text[], $3::int[], $4::timestamptz[], $5::text[], $6::timestamptz[])
       AS o(id, status, attempt_count, next_attempt_at, last_error, published_at)
     WHERE t."id" = o.id`,
    [
      outcomes.map((o) => o.id),
      outcomes.map((o) => o.status),
      outcomes.map((o) => o.attemptCount),
      outcomes.map((o) => o.nextAttemptAt),
      outcomes.map((o) => o.lastError),
      outcomes.map((o) => o.publishedAt),
    ],
  );
}
