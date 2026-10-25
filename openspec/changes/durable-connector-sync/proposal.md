## Why

External knowledge sources like Notion and Confluence continuously change after initial ingestion. Currently, the system supports connecting Notion and selecting pages into metadata, but lacks an ongoing synchronization pipeline to detect external edits, schedule background updates via BullMQ, and persist new document versions safely without race conditions or redundant reprocessing.

Implementing durable synchronization now ensures that knowledge ingested into the RAG engine remains fresh and consistent without requiring users to manually re-select resources whenever source content changes.

## What Changes

- **Persistent Resource Selection & State Separation**: Separate the desired set of selected external resources (`connections_connectors.metadata`) from runtime synchronization tracking state by introducing the `connector_sync_items` entity.
- **Transactional Outbox & Relay Interface**: Maintain transactional queue dispatch durability using `connector_sync_outbox` and a reusable, interface-based poller relay (`SELECT ... FOR UPDATE SKIP LOCKED`) to dispatch jobs to BullMQ with deterministic IDs (`sync:<connectionId>:<externalResourceId>`), preventing stranded work across restarts.
- **Asynchronous Selection API**: Update `POST /v1/integrations/notion/pages` to return `202 Accepted` with a sync tracking identifier, offloading document fetching, parsing, and normalization from the HTTP request cycle.
- **Provider-Neutral Change Detection**: Implement a reusable `KnowledgeSyncProcessor` interface that supports provider-specific revision checks (`last_edited_time` for Notion) and content fingerprint fallbacks (SHA-256) to eliminate no-op document versions.
- **Placeholder Document Storage Integration**: Define a clean `IDocumentStorageService` interface that the background worker invokes with the canonical normalized document payload upon successful parsing, deferring concrete document table migrations to downstream indexing changes.
- **Optimistic Concurrency & Stale Result Protection**: Guard against out-of-order execution, concurrent sync triggers, and worker crashes by verifying generation counters and timestamps before calling the document storage interface.
- **Resilient Retry & Deselection Semantics**: Integrate `ErrorClassifier` and BullMQ exponential backoff for transient provider failures, mark connections as `REAUTH_REQUIRED` upon confirmed 401/revocation errors, and immediately invalidate or cancel running sync jobs if a resource is deselected by the user.

## Capabilities

### New Capabilities
- `connector-sync`: Durable background synchronization of selected external resources, provider-neutral change detection, BullMQ queue dispatch with transactional outbox durability, and version-safe canonical document updates with optimistic concurrency control.

### Modified Capabilities
<!-- None. Previous changes were not promoted to main openspec/specs root. -->

## Impact

- **Database**: New tables `connector_sync_items` and `connector_sync_outbox` managed via TypeORM entities (migrations to be generated via CLI).
- **Dependencies**: Leverages existing BullMQ queue setup without establishing Redis/BullMQ infrastructure from scratch.
- **API Endpoints**: `POST /v1/integrations/notion/pages` returns `202 Accepted` with synchronization job metadata; new sync status queries supported.
- **Modules**: New or updated services in `modules/connector-persistence` and `modules/ingestion` (Sync Item Repository, Outbox Relay with reusable interface, BullMQ Ingestion Worker, Notion Sync Adapter).
