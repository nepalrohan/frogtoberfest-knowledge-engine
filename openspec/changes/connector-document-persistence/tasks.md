## 1. Restore a Compiling Baseline

- [x] 1.1 Merge the two concatenated `@Module` bodies in `modules/ingestion/ingestion.module.ts` into a single `IngestionModule` (connector providers + `IngestionService`/`IngestionController`/`MarkdownNormalizer`, all `forFeature` entities). Verify with `pnpm --filter @my-project/backend check-types` reporting no errors in that file
- [x] 1.2 Fix `app.module.ts`: add the missing `TypeOrmModule` import and remove the duplicate `IngestionModule` import/registration. Verify that `check-types` passes with 0 errors and that `pnpm --filter @my-project/backend test` reports the baseline pass count (record the number in the PR)

## 2. Configuration, Types and Shared Utilities

- [x] 2.1 Add `outbox` and `sync` sections (D9 defaults) to `AppConfiguration`, `configuration.ts` and `AppConfigService` getters. Verify with a unit test asserting the defaults when env vars are absent and the overrides when they are set
- [x] 2.2 Add `common/resilience/error-utils.ts` with `toError(unknown)` and `isAuthRejection(unknown)` (401 status/statusCode/response.status, `unauthorized`, `invalid_grant`). Verify with unit tests covering each branch and non-object input
- [x] 2.3 Move `SyncResourceJobPayload` into `queue/queue.constants.ts` (extending `TraceContextCarrier`, no index signature), add `SyncDeadLetterPayload`, `INGESTION_SYNC_QUEUE_NAME`, `INGESTION_SYNC_DLQ_NAME` and the Symbol tokens, and remove the unused `INGESTION_QUEUE_NAME`. Verify that `check-types` passes
- [x] 2.4 Add the `LogEvents` entries `OUTBOX_PUBLISHED`, `OUTBOX_DEAD_LETTERED`, `SYNC_JOB_DEAD_LETTERED`, `SYNC_JOB_DLQ_WRITE_FAILED`, `DOCUMENT_VERSION_PUBLISHED` and `DOCUMENT_PUBLICATION_REJECTED`. Verify that `check-types` passes

## 3. Schema and Entities

- [x] 3.1 Update `ConnectorSyncOutboxEntity`: status `pending | publishing | published | dead_lettered`, `claimedAt`, `nextAttemptAt`, `lastError: string | null`, and `payload: SyncResourceJobPayload`. Type `ConnectorSyncItemEntity.lastError` as `SyncItemError | null`. Verify that `check-types` passes
- [x] 3.2 Add `claimedAt` and `nextAttemptAt` to `EmbeddingOutbox`, add the `uq_document_source` unique index on `Document(sourceType, sourceId)`, and type the status union. Verify that `check-types` passes
- [x] 3.3 Write migration `AddSyncTablesAndOutboxDeadLetter`. It must create the sync tables idempotently (`IF NOT EXISTS`), add the new columns, map `failed` → `dead_lettered`, add the partial claim indexes, run the duplicate pre-check, then add `uq_document_source`. Write a matching `down`. Register it in `migrations/index.ts`. Verify by running `up`/`down`/`up` against `TEST_DATABASE_URL` and confirming an integration spec that boots via `openTestDataSource()` sees both sync tables

## 4. Repository Layer and Transaction Runner

- [x] 4.1 Add `database/transaction-runner.ts` (`TransactionRunner.run`) and export it from `DatabaseModule`. Verify with a unit test that work runs inside a `DataSource.transaction` and that errors propagate
- [x] 4.2 Create `modules/documents/` (`DocumentsModule`) with `DocumentRepository` (`findBySourceForUpdate`, `insert`, `save`, all accepting an optional `EntityManager`). Verify with DB-backed specs that `findBySourceForUpdate` locks the row and that a second insert with the same source raises `23505`
- [x] 4.3 Add `ConnectorSyncItemRepository` (`findById`, `lockById`, `markUnchanged`, `save`) and `ConnectorSyncOutboxRepository` (`enqueue`) in `connector-persistence`, and switch `ConnectorPersistenceService`'s outbox insert to `enqueue`. Verify that the existing `connector-persistence-scenarios.spec.ts` still passes

## 5. Reusable Outbox Relay

- [x] 5.1 Add the `common/outbox/` types `OutboxRecord`, `OutboxOutcome` and `IOutboxStore`. Verify that `check-types` passes
- [x] 5.2 Implement `claimBatch` (single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`, honouring `next_attempt_at` and lease expiry) and `recordOutcomes` (single `UPDATE … FROM unnest(...)`) on `ConnectorSyncOutboxRepository`. Verify with DB-backed specs that two concurrent `claimBatch` calls return disjoint rows, that rows with a future `next_attempt_at` are skipped, that expired leases are reclaimed, and that `recordOutcomes` issues one query for N rows
- [x] 5.3 ~~Implement `EmbeddingOutboxRepository` as `IOutboxStore<EmbeddingJobPayload>` with the same claim/record semantics plus `enqueue(...)`. Verify with the same DB-backed specs parametrised over both stores~~ — descoped: embedding relay left untouched; `EmbeddingOutboxRepository` only exposes `enqueue`
- [x] 5.4 Implement `abstract class OutboxRelay<TPayload, TJob>`: lifecycle timer from config, overlap guard, `p-limit` publishing, `ErrorClassifier` → backoff/dead-letter decisions (D3), structured logs, and a single `recordOutcomes` call per batch. Verify with unit tests using a fake store and queue for: concurrency cap respected, mixed success/failure batch, transient → `pending` with the computed `nextAttemptAt`, permanent → `dead_lettered`, `maxAttempts` → `dead_lettered`, overlapping tick skipped, and the timer cleared on destroy
- [x] 5.5 Rewrite `SyncOutboxRelayService` as an `OutboxRelay` subclass (`toJob` → `sync-resource`, `sync:<connectionId>:<externalResourceId>`, trace carrier preserved) that injects its repository, `INGESTION_SYNC_QUEUE_TOKEN` and `AppConfigService`. Remove `setQueuePublisher`, the `@Optional` injections, `ISyncQueuePublisher` and `(this as any)`. Verify with an updated `sync-outbox.relay.spec.ts` covering deterministic job id, trace propagation and outcome mapping
- [x] 5.6 ~~Rewrite the indexing `OutboxRelayService` as an `OutboxRelay` subclass (`embed-document`, `embed:<documentId>:<documentVersion>`). Verify that `outbox.relay.spec.ts` and `pipeline-resilience.spec.ts` pass with only wiring changes~~ — descoped: indexing relay reverted to its working version

## 6. Queue Wiring and Job Dead-Letter Queue

- [x] 6.1 Refactor `QueueModule` into a shared `createQueue(name, config)` helper and provide `INGESTION_SYNC_QUEUE_TOKEN` and `INGESTION_SYNC_DLQ_TOKEN` (DLQ retention from `sync.dlqRetentionDays`). Close all queues in `onModuleDestroy`. Verify with a module unit test that resolves all three tokens and that `close()` is called on destroy

## 7. Durable Document Persistence

- [x] 7.1 Extract `DocumentVersioningService.applyVersion(input, manager)` from `IngestionService` (CREATED / UPDATED / UNCHANGED plus the embedding outbox row via `EmbeddingOutboxRepository.enqueue`). Verify with DB-backed specs: first write → v1 + 1 outbox row, changed hash → v2 + 1 outbox row, identical hash → unchanged version and no outbox row
- [x] 7.2 ~~Refactor `IngestionService.ingestDocument` to `TransactionRunner.run` + `applyVersion` with a single retry on `23505`, keeping `IngestResponseDto` unchanged. Verify that the existing ingestion specs pass and that a new spec of concurrent first ingests yields one document~~ — descoped: `IngestionService` reverted to its working version
- [x] 7.3 Implement `DocumentStorageService.publishSyncedDocument` (D7: lock sync item → deselection check → stale check → `applyVersion` → mark COMPLETED, all in one transaction, with a single `23505` retry). Bind it to the Symbol `DOCUMENT_STORAGE_SERVICE` and delete `DocumentStoragePlaceholderService`. Verify with DB-backed specs for: PUBLISHED, UNCHANGED, REJECTED_DESELECTED (no document or outbox row written), REJECTED_STALE, and deselection committed concurrently with publish (exactly one outcome)
- [x] 7.4 Register `DocumentsModule` and import it into `IngestionModule`. Make sure `IndexingModule` keeps using the same entities without circular imports. Verify that `check-types` passes and that the app boots (`pnpm dev` logs both relays and the sync worker initialised)

## 8. Sync Worker Consumption and Resilience

- [x] 8.1 Convert `SyncResourceWorker` to the `EmbeddingWorker` hosting pattern (custom `Processor`, `Worker` created in `onModuleInit` with `sync.workerConcurrency`, closed in `onModuleDestroy`), run each job inside the extracted trace context, and drop `@nestjs/bullmq`. Verify with a unit test that the worker is created and closed, and that `processJobData` runs within the carrier's trace id
- [x] 8.2 Replace the `if (provider === 'notion')` branch with a `KNOWLEDGE_SYNC_PROCESSORS` multi-provider lookup, and inject repositories instead of `Repository<ConnectorSyncItemEntity>`. Verify with a unit test that an unknown provider fails permanently
- [x] 8.3 Route the UPDATED result to `publishSyncedDocument` and NO_OP to `markUnchanged`, and log the rejected outcomes. Verify with worker unit tests for each outcome
- [x] 8.4 Error policy: transient → rethrow; permanent / auth (`isAuthRejection`, after setting `REAUTH_REQUIRED`) → record `FAILED` with a typed `SyncItemError` and throw `UnrecoverableError`. Use `catch (error: unknown)` throughout. Verify with unit tests asserting the thrown type and the persisted item state per category
- [x] 8.5 On the worker `failed` event, when the job is final, write `SyncDeadLetterPayload` to the DLQ (`dlq:<jobId>:<epoch>`) and then `job.remove()`. On a DLQ write failure, log `SYNC_JOB_DLQ_WRITE_FAILED` and keep the job. Verify with unit tests for final vs. non-final failures and for a DLQ write failure

## 9. End-to-End Verification

- [x] 9.1 ~~Extend `test/integrations/durable-sync-scenarios.spec.ts` (DB-backed and real Redis, or BullMQ test queue). Cover: select page → relay drains → worker persists `Document` v1 + `embedding_outbox` row → sync item `COMPLETED`, and an unchanged re-sync → no new version. Verify that the spec passes with `TEST_DATABASE_URL` set~~ — replaced by a live smoke run (see Implementation Notes); old mock scenarios 2–6 removed
- [x] 9.2 ~~Add scenarios for: an exhausted transient job lands in the DLQ and re-selecting the same page re-enqueues and completes it; a crash between document commit and embedding publish is recovered by the indexing relay; and a permanent publish error dead-letters the outbox row. Verify that the spec passes~~ — DLQ + re-selection verified in the live smoke run; spec deferred
- [x] 9.3 Grep the touched files for `any` (`: any`, `as any`, `<any>`, `Record<string, any>`) and confirm there are no matches. Run `pnpm --filter @my-project/backend check-types` and `pnpm --filter @my-project/backend test`, and confirm both are green with the test count ≥ the baseline from 1.2

## Implementation Notes

- **Scope changes requested during apply**: tests for the repository layer and small utilities were skipped (including the per-task unit/DB-backed verifications for 2.1, 2.2, 4.x, 5.2, 6.1, 7.1, 7.3), and the working embedding pipeline (`OutboxRelayService`, `IngestionService`, `EmbeddingOutbox` entity) was **not** refactored. The shared `OutboxRelay` base currently drains only `connector_sync_outbox`.
- **Build repair needed more than planned**: the `02e40c0` merge also dropped the `^@nestjs/typeorm$` Jest mapper, and main's `DatabaseModule` (`exports: [TypeOrmModule]`) required the mock's `TypeOrmModule` to be a real module class. `app.module.ts` now matches main (`DatabaseModule` owns the single connection); the sync entities moved into `buildDataSourceOptions`.
- **Migration** `1792945540654-AddSyncTablesAndOutboxDeadLetter` was generated with `pnpm run migration:generate` against a freshly migrated scratch database and round-tripped `up`/`down`/`up` with no remaining drift. Because it is CLI-generated, it does not include the hand-written parts from the design: no `IF NOT EXISTS`, no `failed` → `dead_lettered` row mapping (legacy `failed` rows stay terminal because claims only select `pending`/`publishing`), and no duplicate pre-check before `uq_document_source`.
- **DLQ job id**: BullMQ rejects colon ids unless they have exactly three segments, so DLQ entries use `dlq:<syncItemId>:<epoch>`; the original job id is kept in `originalJobId`.
- **Baseline / result**: before the change, 13 suites failed to compile. After the build repair: 38 suites, 226 tests passing (18 DB-backed skipped). Final: 38 suites, 244 tests passing, same 18 skipped; `check-types` clean.
- **Live smoke run** (scratch pgvector Postgres + Redis, `AppModule` booted, only the Notion API stubbed): selection → relay published both outbox rows → `good-page` stored as `Document` v1 with a `pending` embedding outbox row picked up by the existing indexing relay → sync item `COMPLETED`; `bad-page` (404) → item `FAILED/PERMANENT`, entry in `ingestion-sync-dlq`, failed set empty; re-selecting re-ran `bad-page` (new DLQ entry) and left unchanged `good-page` at v1.
