# Proposal: Durable Connector Connection Persistence

## Why

External connector integrations (currently Notion OAuth, with Confluence planned) currently rely on volatile in-memory storage for connection records, OAuth anti-CSRF state tokens, and credential references. As a result, any application restart, container deployment, or process crash wipes active connections, forcing administrators to re-authorize the integration and invalidating in-flight OAuth callbacks.

To make the knowledge engine robust and production-ready, connector connections and credentials must be durably persisted in PostgreSQL as the single source of truth, secured with authenticated AES-256-GCM encryption, constrained to at most one active connection per provider, and isolated from client-facing serialization and application startup failures.

## What Changes

- **Database-Backed Connection Persistence**: Introduce `connector_connections` and `connector_credentials` tables in PostgreSQL 16 managed via TypeORM migrations and entities, enforcing a strict 1-to-1 relationship.
- **Active Connection Database Constraint**: Enforce at most one active connection (`CONNECTED` or `REAUTH_REQUIRED`) per provider via a PostgreSQL partial unique index (`idx_connector_connection_provider_active`), preventing race conditions and duplicate active records.
- **Dedicated Credential Encryption Service**: Extract and formalize authenticated AES-256-GCM application-level credential encryption (`iv.tag.ciphertext`) with key ve  rsioning (`encryptionKeyVersion`) and strict key derivation from environment configuration. Decrypted credentials never leak to API responses or logs.
- **Durable OAuth Anti-CSRF State**: Replace volatile in-memory `Map` with a durable PostgreSQL `oauth_states` table featuring short TTL expiration, administrator user binding, atomic single-use consumption, and replay protection surviving process restarts.
- **Transactional Persistence Service**: Replace `ConnectionStorageService` in-memory state with a transactional `ConnectorPersistenceService` that ensures atomic writes, preserves existing valid connections upon failed reconnections, handles idempotent disconnects, and manages verified timestamps.
- **Notion Client Runtime Credential Decoupling**: Update `NotionClient` and `NotionPagesService` to dynamically resolve access tokens from the persisted connection, eliminating reliance on static environment variables or volatile process memory.
- **Lifecycle Error Handling & Re-auth Transition**: Formalize connection lifecycle state transitions (`CONNECTED`, `REAUTH_REQUIRED`, `DISCONNECTED`) where transient network errors preserve credentials, but confirmed provider invalidations (HTTP 401 / revoked token) transition status to `REAUTH_REQUIRED`.

## Capabilities

### New Capabilities
- `connector-persistence`: Secure, durable PostgreSQL storage for external connector connections, encrypted credentials, and durable OAuth state, supporting multi-provider extensibility (Notion, Confluence) in a single-tenant architecture.

### Modified Capabilities
*(None; no existing capability specs currently exist in `openspec/specs/`)*

## Impact

- **Database / Schema**:
  - Requires dependencies `@nestjs/typeorm`, `typeorm`, and `pg` in `apps/backend/package.json`.
  - TypeORM migrations for `connector_connections`, `connector_credentials`, and `oauth_states` tables, indexes, and foreign keys.
- **Backend Services & Modules**:
  - `apps/backend/src/modules/integrations/`:
    - Refactor `connection-storage.service.ts` into a database-backed `ConnectorPersistenceService` (or back `ConnectionStorageService` with TypeORM repositories).
    - Introduce `CredentialEncryptionService` supporting key versioning and fail-safe handling.
    - Refactor `notion-oauth.service.ts` to persist and consume anti-CSRF states via `oauth_states` repository.
    - Update `integrations.controller.ts` to use the persistence service and ensure safe status serialization.
  - `apps/backend/src/modules/ingestion/connectors/notion/notion.client.ts`:
    - Update authorization header resolution to query active connector credentials from the persistence service rather than static environment variables.
- **Security & Configuration**:
  - Requires `ENCRYPTION_SECRET` (minimum 32 bytes) configured in environment variables.
  - Requires PostgreSQL connection configuration (`DATABASE_URL` or `POSTGRES_*` environment variables) hooked into TypeORM.
- **Zero API Breaking Changes**:
  - The public REST API contracts (`/api/v1/integrations/notion/*`) and frontend integration UI remain compatible; status DTOs continue returning safe non-sensitive metadata.
