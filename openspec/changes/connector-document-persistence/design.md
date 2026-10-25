## Context

See `proposal.md` (Why). Current state, as observed in `apps/backend/src`:

- **Two diverging outbox pollers.**
  - `modules/indexing/outbox.relay.ts` (`OutboxRelayService`) has a 1s `setInterval` lifecycle, an `isPolling` overlap guard, publishes outside the transaction with `p-limit(10)` + `Promise.allSettled`, uses `ErrorClassifier`, and persists outcomes with `manager.save(array)`. Its gap: rows are back to unlocked `pending` once the claim transaction commits, so a second instance can claim the same rows before outcomes are saved.
  - `modules/connector-persistence/sync-outbox.relay.ts` (`SyncOutboxRelayService`) publishes inside the `FOR UPDATE SKIP LOCKED` transaction, awaits each publish and `manager.save` one row at a time, mutates `customPublisher` via `(this as any)`, injects both its publisher and its queue as `@Optional`, and is never scheduled. A row is marked `failed` after 5 attempts with no recorded error.
- **The sync queue has no consumer.** `SyncResourceWorker` extends `@nestjs/bullmq` `WorkerHost`, but `BullModule` is never registered. `QueueModule` only provides `EMBEDDING_QUEUE_TOKEN`, and nothing provides the `INGESTION_SYNC_QUEUE` string token. `EmbeddingWorker` uses the project pattern: a custom `Processor` decorator plus a manual `new Worker(...)` in `onModuleInit`.
- **The worker drops permanent errors silently.** Non-retryable errors are swallowed, so BullMQ records the job as *completed*. Retryable errors are rethrown, and with `removeOnFail: false` the failed job keeps its deterministic id `sync:<connectionId>:<externalResourceId>`, so BullMQ silently ignores every later `add` for that resource.
- **No real persistence.** `DocumentStoragePlaceholderService` is an in-memory `Map`. The real version and hash logic for `Document` + `EmbeddingOutbox` lives inline in `IngestionService.ingestDocument` and calls `DataSource` directly.
- **Schema gaps.**
  - `connector_sync_items` and `connector_sync_outbox` have no migration. Integration tests run `runMigrations()` with `synchronize: false`.
  - `document(source_type, source_id)` is indexed but not unique.
- **Broken build.** `ingestion.module.ts` contains two concatenated `@Module` bodies from the `02e40c0` merge. `app.module.ts` is missing its `TypeOrmModule` import and imports `IngestionModule` twice.
- **Trace context is extracted but not used.** `SyncResourceWorker` calls `extractFromCarrier` but never runs its work inside the returned context.

## Goals / Non-Goals

**Goals:**
- One outbox relay implementation, reused by both outboxes, that satisfies `specs/outbox-relay/spec.md`.
- Persist synchronized documents and enqueue their indexing in one ACID transaction, together with the deselection check (`specs/connector-sync/spec.md`).
- Services depend on injected repositories and a transaction runner, not on `DataSource` query builders.
- No `any` in new or touched code. Payloads, carriers and errors are typed, with `unknown` narrowed where needed.

**Non-Goals:**
- A DLQ replay API or admin UI. Dead-letter entries are kept for inspection only (see Open Questions).
- Moving the whole app to `@nestjs/bullmq` / `BullModule`.
- Confluence sync, webhooks or periodic re-sync scheduling.
- Changing the embedding worker's chunking and vector logic. Only its upstream relay changes.

## Decisions

### D1. Shared relay as a Template-Method base class plus an outbox store port

`common/outbox/` gets three pieces:
- `OutboxRecord<TPayload>`: `{ id, payload, attemptCount, lastError }`, a normalized view of any outbox row.
- `IOutboxStore<TPayload>`, owned by each outbox's repository:
  - `claimBatch(batchSize, leaseMs): Promise<OutboxRecord<TPayload>[]>`
  - `recordOutcomes(outcomes: OutboxOutcome[]): Promise<void>`
- `abstract class OutboxRelay<TPayload, TJob>`, which implements `OnModuleInit` / `OnModuleDestroy`. It owns:
  - the timer and the overlap guard
  - `p-limit` bounded publishing with `Promise.allSettled`
  - `ErrorClassifier`-driven retry, backoff and dead-letter decisions
  - structured logging (`LogEvents.OUTBOX_*`)
  - trace-carrier pass-through

  Subclasses implement only `toJob(record): { name: string; jobId: string; data: TJob }`.

The two concrete relays are each a small class: `SyncOutboxRelayService` (connector-persistence) and `OutboxRelayService` (indexing, which keeps its name so existing wiring stays). Each injects its repository (as the store), its queue token and `AppConfigService`.

- *Alternative:* a fully generic `@Injectable()` engine configured per outbox via factory providers. Rejected because it needs multiple instances of one class behind custom tokens, which makes DI harder to follow. The subclass is roughly 20 lines and reads clearly (KISS).
- *Alternative:* keep `SyncOutboxRelayService` and patch it. Rejected because it duplicates the indexing relay and violates DRY.

### D2. Claim with a lease in a single statement, and publish outside the transaction

`claimBatch` runs one statement:

```sql
UPDATE <outbox> SET status = 'publishing', claimed_at = now()
WHERE id IN (
  SELECT id FROM <outbox>
  WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
     OR (status = 'publishing' AND claimed_at < now() - <leaseMs>)
  ORDER BY created_at
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

Locks are held only for that statement. A crashed instance's rows become claimable again once the lease expires. A double publish after lease expiry is harmless because job ids are deterministic (`specs/outbox-relay` → Deterministic Job Identity).

`recordOutcomes` is one `UPDATE … FROM unnest($ids::uuid[], $statuses::text[], $attempts::int[], $nextAttemptAt::timestamptz[], $errors::text[])`. That is a single round-trip per batch, whatever the batch size.

- *Alternative:* the current pattern of `FOR UPDATE SKIP LOCKED` in a transaction that is then closed. Rejected because the rows are reclaimable immediately (see Context).
- *Alternative:* `manager.save(rows)`. Rejected because TypeORM issues one `UPDATE` per entity.

### D3. Retry, backoff and outbox dead-lettering

Per failed publish:
1. `attemptCount += 1` and `lastError` is set.
2. If `ErrorClassifier.classify(err) === 'PERMANENT'` or `attemptCount >= maxAttempts`, the status becomes `dead_lettered`.
3. Otherwise the status returns to `pending` with `next_attempt_at = now + min(base * 2^(attempt-1), maxBackoff)`.

Successful publishes set `published` and `published_at`. The status vocabulary for both tables is `pending | publishing | published | dead_lettered`. Existing `failed` rows are migrated to `dead_lettered`. A partial index `(next_attempt_at) WHERE status IN ('pending','publishing')` keeps claims cheap.

### D4. A job dead-letter queue, with the deterministic id released

`QueueModule` builds every queue through one `createQueue(name, config)` helper (DRY on the Redis connection and default job options). It provides:
- `INGESTION_SYNC_QUEUE_TOKEN` → `ingestion-sync-queue`
- `INGESTION_SYNC_DLQ_TOKEN` → `ingestion-sync-dlq` (with `removeOnComplete: false`, and retention by age and count)

`SyncResourceWorker` changes in three ways:
- **Retryable errors:** rethrow them. BullMQ backs off.
- **Permanent errors, including auth rejection after `REAUTH_REQUIRED` is set:** record `FAILED` on the sync item and throw `UnrecoverableError`, so BullMQ stops retrying. The job no longer reports as completed.
- **On the worker's `failed` event:** when the job is final (`UnrecoverableError`, or `attemptsMade >= opts.attempts`), add a `SyncDeadLetterPayload` to the DLQ. The payload holds the original payload, error message, category, attempts, failedAt and trace carrier, under job id `dlq:<originalJobId>:<failedAtEpoch>`. Then `job.remove()` runs, so the deterministic id is free for re-selection.

Sync jobs use `removeOnFail: true` as a safety net only after the DLQ write succeeds. The worker removes the job explicitly, rather than relying on that option, so that a failed DLQ write leaves the job in the failed set (logged) instead of losing it.

- *Alternative:* treat BullMQ's retained failed set as the DLQ. Rejected because it blocks any later re-enqueue under the deterministic id.

### D5. Worker hosting follows the `EmbeddingWorker` pattern

`SyncResourceWorker` drops `WorkerHost` and `@nestjs/bullmq` and uses the project's `Processor(INGESTION_SYNC_QUEUE_NAME)` decorator. It creates the `Worker` in `onModuleInit`, using `config.sync.workerConcurrency` (default 2), and closes it in `onModuleDestroy`. Job handling runs inside `context.with(TraceContextPropagator.extractFromCarrier(data), …)`, so logs and spans join the originating trace.

Provider dispatch goes through a `KNOWLEDGE_SYNC_PROCESSORS` multi-provider. That is a `KnowledgeSyncProcessor[]` indexed by `provider`, which replaces `if (provider === 'notion')` (Open/Closed).

- *Alternative:* register `BullModule.forRootAsync` and keep `WorkerHost`. Rejected for this change because it would leave two queue-wiring styles side by side. Migrating to it is a separate decision.

### D6. Repository layer and transaction runner

Each new `@Injectable()` repository wraps `@InjectRepository(Entity)`. Every method takes an optional `EntityManager`, so it can run inside a caller's transaction:

| Repository | Location | Responsibilities |
|---|---|---|
| `DocumentRepository` | `modules/documents/` | `findBySourceForUpdate`, `insert`, `save` |
| `EmbeddingOutboxRepository` | `modules/documents/` | implements `IOutboxStore<EmbeddingJobPayload>`; `enqueue(documentId, version, payload, manager)` |
| `ConnectorSyncItemRepository` | `connector-persistence` | `findById`, `lockById`, `save` |
| `ConnectorSyncOutboxRepository` | `connector-persistence` | implements `IOutboxStore<SyncResourceJobPayload>` |

`TransactionRunner` (`database/transaction-runner.ts`) exposes `run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T>` over `DataSource.transaction`. Services inject the runner and repositories, never `DataSource`.

`ConnectorPersistenceService.saveSelectedPagesAndEnqueueSync` moves its outbox insert onto `ConnectorSyncOutboxRepository.enqueue` without changing behaviour. Rewriting its other per-row saves is out of scope.

### D7. Document versioning is shared, and connector publication is atomic

`DocumentVersioningService` (`modules/documents/`) holds the version rules currently inline in `IngestionService`:
- an identical `contentHash` produces `UNCHANGED`
- otherwise the version becomes `version + 1` (or 1 for a new document), with `syncStatus = 'pending_embedding'`
- every new version also gets an `embedding_outbox` row with payload `{ documentId, documentVersion, sourceType, title, traceCarrier }`

Its method `applyVersion(input, manager)` returns `{ outcome: 'CREATED' | 'UPDATED' | 'UNCHANGED', documentId, version }`. `IngestionService.ingestDocument` calls it inside `TransactionRunner.run`, and its response DTO is unchanged.

`DocumentStorageService` implements `IDocumentStorageService` under the `DOCUMENT_STORAGE_SERVICE` token, which becomes a `Symbol`. Its method `publishSyncedDocument({ syncItemId, payload, observedRevision, contentFingerprint })` runs one transaction:
1. `ConnectorSyncItemRepository.lockById(syncItemId)` (`FOR UPDATE`). If the item is missing or `DESELECTED`, return `REJECTED_DESELECTED`.
2. `DocumentRepository.findBySourceForUpdate(sourceType, sourceId)`. If the existing `sourceUpdatedAt` is newer than `payload.sourceUpdatedAt`, return `REJECTED_STALE` (this implements the existing Concurrency and Stale-Result requirement).
3. `DocumentVersioningService.applyVersion(...)`.
4. Set the sync item to `COMPLETED`, with `lastSyncedAt`, `lastObservedRevision`, `lastProcessedFingerprint` and `lastError = null`.

Locking the sync item serialises with deselection, which `ConnectorPersistenceService` writes in its own transaction on the same row. That serialisation is what satisfies "Deselection racing with publication". The worker's NO_OP path calls a separate `markUnchanged` repository update. The in-memory placeholder is deleted, and tests use mocks of the interface.

**Concurrent first insert.** The new unique index `uq_document_source (source_type, source_id)` turns the race into a `23505` error. `DocumentRepository.insert` lets it surface, and `DocumentStorageService` and `IngestionService` retry the whole transaction once. On the retry, `findBySourceForUpdate` sees the winner's row and the normal UPDATE or UNCHANGED path follows.

### D8. Typing without `any`

- `SyncResourceJobPayload` and `SyncDeadLetterPayload` move to `queue/queue.constants.ts`. `SyncResourceJobPayload` extends `TraceContextCarrier` and drops the `[key: string]: unknown` index signature.
- `ConnectorSyncOutboxEntity.payload` becomes `SyncResourceJobPayload`, and `lastError` becomes `string | null`.
- `ConnectorSyncItemEntity.lastError` becomes the typed `SyncItemError { message; category: ErrorCategory; timestamp }`.
- `catch (error: unknown)` narrows through `common/resilience/error-utils.ts`, which provides `toError(unknown): Error` and `isAuthRejection(unknown): boolean`. The latter replaces the worker's inline 401 / `unauthorized` / `invalid_grant` string checks.
- `process()` returns `Promise<void>`.

### D9. Configuration

`AppConfiguration` gets two new sections, read only through `AppConfigService`. Defaults match today's behaviour.
- `outbox: { pollIntervalMs: 1000, batchSize: 50, concurrency: 10, maxAttempts: 5, baseBackoffMs: 2000, maxBackoffMs: 60000, claimLeaseMs: 30000 }`
- `sync: { workerConcurrency: 2, jobAttempts: 4, dlqRetentionDays: 14 }`

## Risks / Trade-offs

- **[Unique index migration fails on existing duplicate `document` rows]** → The migration first runs a `GROUP BY … HAVING count(*) > 1` check and aborts with a clear message listing the offending `source_type/source_id` pairs. This is single-tenant dev data, so a manual cleanup is acceptable.
- **[Sync tables already exist in dev DBs created by `synchronize: true`]** → The migration uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
- **[Lease expiry while a slow publish is still in flight causes a duplicate publish]** → Deterministic job ids dedupe in BullMQ, and the lease (30s) is far above normal Redis latency.
- **[Re-selection while a job for the same resource is active is coalesced by job-id dedupe]** → This is unchanged existing behaviour. The active job fetches authoritative current content, so it usually covers the edit. A follow-up can re-emit after completion if needed.
- **[The DLQ write fails inside the `failed` handler]** → The job is left in the failed set (not removed) and a `LogEvents.SYNC_JOB_DLQ_WRITE_FAILED` error is logged. Re-selection stays blocked until an operator clears it. This is visible and rare.
- **[Refactoring the embedding relay onto the shared base could regress indexing]** → The existing `outbox.relay.spec.ts` and `pipeline-resilience.spec.ts` must pass unchanged in intent, with only constructor wiring updated.
- **[A long transaction holds the `FOR UPDATE` lock on the sync item]** → The transaction contains only DB writes. All provider I/O happens before it.

## Migration Plan

1. Fix the build (module merge). `check-types` must be green before any other step.
2. Deploy the migration `AddSyncTablesAndOutboxDeadLetter` (`up`):
   - create the sync tables if they are missing
   - add `claimed_at`, `next_attempt_at` and `last_error` to `connector_sync_outbox`
   - add `claimed_at` and `next_attempt_at` to `embedding_outbox`
   - migrate `failed` rows to `dead_lettered`
   - add the partial claim indexes
   - run the duplicate check, then add `uq_document_source`
3. Roll out the code. Both relays start draining on boot, and pending rows written before deploy drain normally.
4. **Rollback:** `down` drops the added columns and indexes and maps `dead_lettered` back to `failed`. It does not drop the sync tables, since earlier code depends on them. Leftover DLQ queue keys in Redis are inert.

## Open Questions

- What DLQ replay and inspection tooling is needed (admin endpoint vs. a CLI script)? This is deferrable because dead-letter entries already carry everything a replay needs.
- Should `REAUTH_REQUIRED` auth failures be dead-lettered or only recorded on the sync item? The plan dead-letters them for visibility, and changing this later is a single branch in the worker.
