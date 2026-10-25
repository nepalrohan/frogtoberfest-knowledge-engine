## Why

Connector sync produces normalized documents, but none of them reach the knowledge base. `SyncResourceWorker` writes to an in-memory `DocumentStoragePlaceholderService`, nothing consumes `ingestion-sync-queue`, and nothing schedules `SyncOutboxRelayService`. The sync relay also publishes inside its row-lock transaction one row at a time (a separate save per row), mutates its own DI fields through `(this as any)`, and has no dead-letter path. The indexing `OutboxRelayService` already solves most of this (bounded concurrency, publishing outside the transaction, an overlap guard), so we should promote that design into one reusable relay rather than keep two diverging pollers. On top of that, the `02e40c0` merge left `ingestion.module.ts` and `app.module.ts` unable to compile, which blocks any further work on this branch.

## What Changes

- **Repair the branch build**: merge the two concatenated `IngestionModule` definitions into one and fix the `app.module.ts` imports, so that `check-types` passes again.
- **Reusable outbox relay**: extract one generic, provider-agnostic outbox relay engine from the indexing relay. It claims rows with `SKIP LOCKED` in a short transaction, publishes outside it with bounded concurrency, persists results in one bulk write, retries with backoff and dead-letters rows. Both `connector_sync_outbox` and `embedding_outbox` drain through it. **BREAKING (internal)**: `SyncOutboxRelayService.setQueuePublisher` and its `@Optional` publisher/queue injection are removed.
- **Outbox dead-lettering**: outbox rows that hit a permanent publish error or run out of attempts move to a terminal `dead_lettered` state that records the last error. Transient failures wait out a backoff window and are not retried on every tick.
- **Job dead-letter queue**: sync jobs that exhaust BullMQ attempts or fail permanently are copied to a dead-letter queue with their error and trace context. The original failed job is then removed, so later re-selection of that resource can enqueue again under the deterministic job id.
- **Real sync queue consumption**: register `ingestion-sync-queue` in `QueueModule` and run `SyncResourceWorker` as a lifecycle-managed BullMQ worker with bounded concurrency, the same way `EmbeddingWorker` runs.
- **Durable document persistence**: replace the placeholder with a repository-backed `DocumentStorageService`. In one transaction it locks the sync item, refuses to publish if the item was deselected, upserts the canonical `Document` with a monotonic version and content-hash dedupe, writes the `embedding_outbox` event and marks the sync item `COMPLETED`.
- **Repository layer**: add injectable repositories (`DocumentRepository`, `EmbeddingOutboxRepository`, `ConnectorSyncItemRepository`, outbox repositories) that hold all query logic, so that services hold only business rules. `IngestionService` reuses the same document upsert path (DRY).
- **Schema**: add the missing migration for `connector_sync_items` and `connector_sync_outbox`, add retry and dead-letter columns to both outbox tables, and add a unique index on `document(source_type, source_id)`.
- **Typing**: remove `any` across the touched code (`Record<string, any>` payloads, `catch (error: any)`, `Promise<any>`) and replace it with typed payloads and `unknown`, narrowed where needed.

## Capabilities

### New Capabilities
- `outbox-relay`: Reliable, reusable delivery of transactional outbox events to background queues. Covers bounded-concurrency publishing, backoff, dead-lettering of undeliverable events and dead-letter capture of exhausted background jobs.

### Modified Capabilities
- `connector-sync`: Canonical document updates are now durably persisted and atomically trigger indexing. A deselection check is enforced in the same transaction as publication. A resource whose earlier job failed permanently can be re-synchronized.

## Impact

- **Code**: `modules/connector-persistence` (relay, entities, new repositories), `modules/indexing/outbox.relay.ts` (moves onto the shared engine), `modules/queue` (sync and DLQ queue tokens), `modules/ingestion` (worker, storage service, module repair, `IngestionService` refactor), `app.module.ts`, `common/logger/log-events.ts`.
- **Database**: one new migration covering the sync tables, outbox retry and dead-letter columns, and the unique document source index (with a duplicate pre-check).
- **Queues**: new BullMQ queues `ingestion-sync-queue` and `ingestion-sync-dlq` on the existing Redis instance. No new infrastructure.
- **Config**: relay interval, batch size, concurrency, maximum attempts and worker concurrency are read through `AppConfigService`, with defaults that match today's values.
- **APIs**: no HTTP contract changes. `POST /v1/integrations/notion/pages` and `GET /v1/integrations/notion/sync/status` keep working, and sync items now actually reach `COMPLETED` or `FAILED`.
- **Tests**: update `sync-outbox.relay.spec.ts`, `outbox.relay.spec.ts`, `sync-resource.worker.spec.ts` and `test/integrations/durable-sync-scenarios.spec.ts`, and add DB-backed persistence scenarios.
