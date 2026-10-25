# Tasks: Durable Connector Sync, Source Change Detection, and Version-Safe Updates

## 1. Entities and Persistence Layer

- [x] 1.1 Implement `ConnectorSyncItemEntity` in `apps/backend/src/modules/connector-persistence/entities/connector-sync-item.entity.ts` with tracking fields (`externalResourceId`, `status`, `attemptCount`, `lastSyncedAt`, `lastObservedRevision`, `lastProcessedFingerprint`) and unique index on `(connection_id, external_resource_id)`, and verify entity compiles
- [x] 1.2 Implement `ConnectorSyncOutboxEntity` in `apps/backend/src/modules/connector-persistence/entities/connector-sync-outbox.entity.ts` for transactional outbox dispatch with pending index, and verify entity compiles
- [x] 1.3 Register `ConnectorSyncItemEntity` and `ConnectorSyncOutboxEntity` in `ConnectorPersistenceModule` and `AppModule`, and verify `pnpm check-types` passes

## 2. Persistent Selection & Asynchronous API

- [x] 2.1 Implement `saveSelectedPagesAndEnqueueSync` in `ConnectorPersistenceService` to atomically update `metadata.selectedPageIds`, upsert sync items as `PENDING`, mark removed items as `DESELECTED`, and insert outbox events in a single ACID transaction, and verify unit tests pass
- [x] 2.2 Update `POST /v1/integrations/notion/pages` in `IntegrationsController` to return `202 Accepted` with synchronization tracking identifier and selected count, offloading document fetching from the HTTP request, and verify controller tests pass
- [x] 2.3 Add endpoint `GET /v1/integrations/notion/sync/status` returning current sync item progress without sensitive credentials, and verify controller tests pass

## 3. Reusable Outbox Relay & Interface

- [x] 3.1 Define `ISyncOutboxRelay` interface in `apps/backend/src/modules/connector-persistence/interfaces/sync-outbox-relay.interface.ts` ensuring poller logic is modular and reusable
- [x] 3.2 Implement `SyncOutboxRelayService` in `apps/backend/src/modules/connector-persistence/sync-outbox.relay.ts` using `SELECT ... FOR UPDATE SKIP LOCKED` to poll pending outbox events and dispatch to BullMQ with deterministic job IDs (`sync:<connectionId>:<externalResourceId>`), and verify relay tests pass
- [x] 3.3 Implement W3C trace context propagation across outbox records and BullMQ jobs using `TraceContextPropagator.injectToCarrier` and `TraceContextPropagator.extractFromCarrier`, and verify trace context is preserved

## 4. Provider-Neutral Change Detection & Notion Sync Processor

- [x] 4.1 Define `KnowledgeSyncProcessor` interface and `SyncExecutionResult` types in `apps/backend/src/modules/ingestion/interfaces/knowledge-sync-processor.interface.ts`, and verify interface contracts compile
- [x] 4.2 Implement `NotionSyncProcessor` in `apps/backend/src/modules/ingestion/connectors/notion/notion-sync.processor.ts` integrating `NotionAdapter`, `NotionParser`, and `CanonicalDocumentNormalizer`, with two-tier change detection (evaluating `last_edited_time` first, then canonical SHA-256 `contentHash`), and verify unit tests cover no-op detection on unchanged content

## 5. Document Storage Placeholder & Background Worker

- [x] 5.1 Define `IDocumentStorageService` interface and implement `DocumentStoragePlaceholderService` in `apps/backend/src/modules/ingestion/services/document-storage-placeholder.service.ts` to log and accept normalized payloads, and verify unit tests pass
- [x] 5.2 Implement `SyncResourceWorker` in `apps/backend/src/modules/ingestion/workers/sync-resource.worker.ts` with BullMQ `@Processor` decorator, concurrency limiting, and structured logging with `StructuredLogger`, and verify worker initializes
- [x] 5.3 Integrate `ErrorClassifier` and deselection protection in `SyncResourceWorker`: check sync item status before calling document storage, skip if `DESELECTED`, trigger exponential backoff on transient errors, and transition connection to `REAUTH_REQUIRED` on confirmed 401, and verify worker tests pass

## 6. Comprehensive Testing & Verification

- [x] 6.1 Write unit tests for `NotionSyncProcessor`, `SyncOutboxRelayService`, `DocumentStoragePlaceholderService`, and `SyncResourceWorker` using mocked provider data (no live external API calls), and verify all unit tests pass
- [x] 6.2 Write integration scenario tests covering:
  - Initial selection persisting sync items and outbox records
  - Outbox relay dispatching deterministic BullMQ jobs
  - Unchanged content producing no-op sync without calling document storage
  - Modified content parsing into canonical Markdown and invoking document storage
  - Deselection mid-flight preventing document storage invocation
  - Confirmed provider 401 error updating connection status to `REAUTH_REQUIRED`
- [x] 6.3 Run `pnpm --filter @my-project/backend check-types` and `pnpm --filter @my-project/backend test` to verify 100% pass rate
