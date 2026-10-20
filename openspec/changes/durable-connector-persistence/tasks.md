# Tasks: Durable Connector Connection Persistence

## 1. Dependencies and Database Configuration

- [x] 1.1 Add `typeorm`, `@nestjs/typeorm`, and `pg` to `apps/backend/package.json` dependencies and `@types/pg` to devDependencies, and verify `pnpm install` and build succeed
- [x] 1.2 Configure `TypeOrmModule` in `apps/backend/src/app.module.ts` using `AppConfigService` database configuration, and verify database connection initializes without error
- [x] 1.3 Database migrations: omitted per user instruction (schema managed via TypeORM entity synchronization / external schema)

## 2. Portable Connector Persistence Module & Entities

- [x] 2.1 Implement portable `ConnectorConnectionEntity` in `apps/backend/src/modules/connector-persistence/entities/connector-connection.entity.ts` with lifecycle states (`CONNECTED`, `REAUTH_REQUIRED`, `DISCONNECTED`) and partial unique index, and verify entity unit tests
- [x] 2.2 Implement portable `ConnectorCredentialEntity` in `apps/backend/src/modules/connector-persistence/entities/connector-credential.entity.ts` with 1-to-1 foreign key cascade and payload metadata, and verify entity unit tests
- [x] 2.3 Implement portable `OAuthStateEntity` in `apps/backend/src/modules/connector-persistence/entities/oauth-state.entity.ts` with TTL and single-use consumption fields, and verify entity unit tests

## 3. Credential Security & Encryption Service

- [x] 3.1 Implement self-contained `CredentialEncryptionService` in `apps/backend/src/modules/connector-persistence/credential-encryption.service.ts` supporting AES-256-GCM, key derivation from `ENCRYPTION_SECRET`, and `encryptionKeyVersion` tracking, and verify encryption/decryption round-trip tests pass
- [x] 3.2 Add error-handling and masking tests to `credential-encryption.service.spec.ts` verifying corrupted payloads and unavailable keys fail safely without leaking secrets or keys in exceptions or logs

## 4. Connector Persistence Service & Dynamic Module

- [x] 4.1 Implement `ConnectorPersistenceService` in `apps/backend/src/modules/connector-persistence/connector-persistence.service.ts` with atomic transaction boundaries for saving connections and credentials, and verify transaction rollback on credential failure
- [x] 4.2 Implement safe connection retrieval, multi-connector listing (`listConnections()`), status update (`CONNECTED`, `REAUTH_REQUIRED`), and last-verified timestamp updates, and verify unit tests pass
- [x] 4.3 Implement idempotent disconnect operation in `ConnectorPersistenceService` that transitions status to `DISCONNECTED` and clears credentials, and verify idempotent disconnect tests pass
- [x] 4.4 Implement `OAuthStateService` in `apps/backend/src/modules/connector-persistence/oauth-state.service.ts` for atomic anti-CSRF state token creation and consumption, and verify unit tests pass
- [x] 4.5 Assemble `ConnectorPersistenceModule` with `.register()` / `.forRoot()` options in `apps/backend/src/modules/connector-persistence/connector-persistence.module.ts` as a completely decoupled, copy-pasteable module, and verify module isolation

## 5. Consumer Integration: Notion OAuth and Controller

- [x] 5.1 Refactor `NotionOAuthService` to use `OAuthStateService` from `ConnectorPersistenceModule` and perform atomic single-use validation, and verify restart resilience, replay rejection, and expiration unit tests pass
- [x] 5.2 Refactor `IntegrationsController` to store authorized Notion connections via `ConnectorPersistenceService` and return safe status DTOs, and verify controller tests pass
- [x] 5.3 Update `ConnectionStorageService` to delegate to or be superseded by `ConnectorPersistenceService`, ensuring backward-compatible interfaces for selected page IDs and workspace info

## 6. Dynamic Runtime Credential Resolution

- [x] 6.1 Update `NotionClient` to dynamically resolve access tokens from `ConnectorPersistenceService` and eliminate static environment API key fallback, and verify client unit tests pass
- [x] 6.2 Update `NotionPagesService` to resolve tokens via `ConnectorPersistenceService` when not provided explicitly, and verify workspace search tests pass
- [x] 6.3 Implement automatic status transition to `REAUTH_REQUIRED` in `ConnectorPersistenceService` upon confirmed provider authentication failures (HTTP 401 Unauthorized), and verify error-interceptor unit tests pass

## 7. Multi-Connector Concurrency, Scenarios A–F Verification, and Documentation

- [x] 7.1 Verify Scenario A (Normal restart preserves connection) and Scenario B (Failed reconnection preserves existing connection) via integration tests
- [x] 7.2 Verify Multi-Connector Concurrency (concurrent Notion + Confluence connections active simultaneously) via integration tests
- [x] 7.3 Verify Scenario C (Transient 5xx/network errors do not alter connection) and Scenario D (Confirmed 401 transitions to `REAUTH_REQUIRED`) via integration tests
- [x] 7.4 Verify Scenario E (Unavailable key fails safely) and Scenario F (Concurrent callbacks rejected by unique constraint / single-use state) via automated concurrency tests
- [x] 7.5 Run backend test suite (`pnpm --filter @my-project/backend test`) and type checking (`pnpm --filter @my-project/backend check-types`) to confirm 100% pass rate
- [x] 7.6 Document entity schema, encryption key backup procedures, lifecycle transitions, copy-paste module integration guide, and multi-provider extension guidelines in `docs/data-model.md` and `docs/security.md`
