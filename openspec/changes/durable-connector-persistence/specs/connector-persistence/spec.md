## Purpose

Provides secure, durable persistence in PostgreSQL for external connector connections, encrypted credentials, and anti-CSRF OAuth state tokens, ensuring integration connections survive application restarts and deployments in a single-tenant environment.

## ADDED Requirements

### Requirement: Durable Connector Connection Storage
The system SHALL persist external connector connection metadata in PostgreSQL such that established connections survive application restarts, container redeployments, and process crashes without requiring administrator re-authorization.

#### Scenario: Connection persists across application restart
- **WHEN** an administrator successfully authorizes an external connector integration and the backend application restarts
- **THEN** the stored connection status remains available from PostgreSQL and subsequent requests can immediately use the persisted credentials

#### Scenario: Safe connection status serialization
- **WHEN** any user or client queries the connector status endpoint
- **THEN** the system returns connection metadata (provider, status, workspace name, workspace icon, connected timestamp, selected pages count) without ever exposing plaintext or encrypted credentials

---

### Requirement: Connection Lifecycle State Management
The system SHALL maintain a durable connection lifecycle state for each provider, supporting the states `CONNECTED`, `REAUTH_REQUIRED`, and `DISCONNECTED`.

#### Scenario: Normal connected lifecycle
- **WHEN** a provider authorization completes successfully
- **THEN** the connection status is set to `CONNECTED`, and `connectedAt` is recorded

#### Scenario: Transient provider outage does not invalidate connection
- **WHEN** an external provider API call experiences a network timeout or temporary 5xx server error
- **THEN** the system SHALL retain the `CONNECTED` state and SHALL NOT alter credentials or downgrade to `DISCONNECTED` or `REAUTH_REQUIRED`

#### Scenario: Confirmed provider invalidation transitions to reauth required
- **WHEN** an external provider explicitly returns an authentication error (such as HTTP 401 Unauthorized or revoked token error) indicating credentials are no longer valid
- **THEN** the system SHALL transition the connection status to `REAUTH_REQUIRED` while preserving audit metadata

---

### Requirement: Single Active Connection Constraint per Provider
The database layer SHALL enforce that at most one active connection exists per provider at any given time, where active is defined as having status `CONNECTED` or `REAUTH_REQUIRED`.

#### Scenario: Prevention of duplicate active connections
- **WHEN** a database insert or update attempts to create a second active connection record for an already connected provider
- **THEN** the database unique constraint rejects the operation and prevents duplicate active records

#### Scenario: Multiple distinct providers allowed concurrently
- **WHEN** the system holds an active connection for Notion and receives an active connection for Confluence
- **THEN** both active connection records are successfully stored concurrently in the database

#### Scenario: Concurrent OAuth callbacks race prevention
- **WHEN** two concurrent OAuth callback requests arrive simultaneously for the same provider
- **THEN** database constraints ensure exactly one connection record becomes active and no inconsistent orphaned credential records are created

---

### Requirement: Application-Level Credential Encryption
The system SHALL encrypt sensitive provider authentication material using authenticated AES-256-GCM encryption before writing to PostgreSQL, and decrypt credentials only within trusted backend services.

#### Scenario: Encryption and decryption round-trip
- **WHEN** a plaintext credential token is encrypted, stored, retrieved, and decrypted using the configured encryption secret
- **THEN** the decrypted output exactly matches the original plaintext token

#### Scenario: Key version tracking
- **WHEN** credentials are encrypted and stored in the database
- **THEN** the record includes an `encryptionKeyVersion` identifier to support future key rotation

#### Scenario: Graceful handling of unavailable or invalid encryption key
- **WHEN** the backend attempts to decrypt stored credentials with an incorrect key, missing key, or corrupted payload
- **THEN** the operation fails safely with an operational error, logs no secrets, and does not alter or delete existing stored credentials

#### Scenario: Exclusion from logs and exception messages
- **WHEN** an encryption or decryption operation encounters an error
- **THEN** the error message and system logs omit plaintext credentials, authorization codes, encryption keys, and raw payloads

---

### Requirement: Transactional Atomic Connection Persistence
The system SHALL persist connection metadata and encrypted credentials atomically within a single database transaction.

#### Scenario: Rollback on credential persistence failure
- **WHEN** saving a connector connection succeeds but storing the associated encrypted credential fails
- **THEN** the entire database transaction is rolled back and no partial connection record remains in the database

#### Scenario: Failed reconnection preserves existing valid connection
- **WHEN** an existing valid connection is active, and a subsequent OAuth reconnection attempt fails or is cancelled
- **THEN** the existing valid connection and its stored credentials remain unmodified and active

#### Scenario: Successful reauthorization replaces credentials atomically
- **WHEN** an administrator successfully completes a re-authorization flow for an existing provider
- **THEN** the credentials are replaced and connection status is updated within a single atomic database transaction

---

### Requirement: Idempotent Connector Disconnection
The system SHALL provide an idempotent disconnect operation that invalidates credentials and records the disconnection timestamp.

#### Scenario: Initial disconnect operation
- **WHEN** an administrator requests disconnection of an active integration
- **THEN** the connection status transitions to `DISCONNECTED`, `disconnectedAt` timestamp is recorded, and the stored credential payload is cleared or made permanently unusable

#### Scenario: Repeated disconnect operation
- **WHEN** a disconnect request is executed on a provider that is already `DISCONNECTED`
- **THEN** the operation succeeds with no error and leaves the disconnected state unchanged

---

### Requirement: Durable Anti-CSRF OAuth State Management
The system SHALL persist OAuth anti-CSRF state tokens in PostgreSQL to ensure authorization callbacks can be verified across application restarts and process boundaries.

#### Scenario: State verification across backend restarts
- **WHEN** an OAuth flow is initiated, generating an anti-CSRF state token, and the backend application restarts before the user returns from the provider
- **THEN** the callback verification succeeds against the persisted state in PostgreSQL

#### Scenario: Single-use state consumption and replay rejection
- **WHEN** a valid anti-CSRF state token is verified during an OAuth callback
- **THEN** the state is atomically marked consumed, and any subsequent callback using the same state token is rejected

#### Scenario: Expired state rejection
- **WHEN** an OAuth callback arrives with a state token whose expiration timestamp has passed
- **THEN** the verification fails and the request is rejected

---

### Requirement: Dynamic Provider Credential Resolution
Downstream connector components (such as `NotionClient` and `NotionPagesService`) SHALL obtain access tokens dynamically from the authorized, persisted `ConnectorConnection`.

#### Scenario: Ingestion client uses persisted credentials
- **WHEN** an ingestion or page synchronization operation executes for a connected provider
- **THEN** the client dynamically retrieves the decrypted access token from the persistence service rather than static environment variables

#### Scenario: Connector fails cleanly when disconnected
- **WHEN** an operation requires provider credentials but the provider connection is `DISCONNECTED` or missing
- **THEN** the operation halts with a clear configuration/authorization exception without falling back to any developer personal token
