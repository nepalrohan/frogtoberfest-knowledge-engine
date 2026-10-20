## Purpose

Provides secure OAuth 2.0 authorization initiation, administrator access control, anti-CSRF state validation, authorization code exchange, and encrypted credential storage for connecting a single Notion workspace.

## ADDED Requirements

### Requirement: Administrator Authorization for Connection Management
The system SHALL require valid application administrator authorization for initiating OAuth authorization, inspecting connection status, and disconnecting the Notion workspace.

#### Scenario: Unauthorized user access rejection
- **WHEN** a request without valid administrator credentials attempts to initiate authorization, retrieve connection status, or disconnect Notion
- **THEN** the system SHALL reject the request with an HTTP 401 Unauthorized status

#### Scenario: Authorized administrator access
- **WHEN** an authenticated administrator with valid administrative credentials invokes connection management endpoints
- **THEN** the system SHALL permit the operation and proceed with the requested lifecycle action

### Requirement: OAuth Authorization Initiation
The system SHALL generate a Notion OAuth authorization URL containing client identification, redirect URI, requested response type, and a cryptographically secure anti-CSRF state token with server-side expiration.

#### Scenario: Successful authorization URL generation
- **WHEN** an authorized administrator requests a Notion authorization URL
- **THEN** the system SHALL return a URL pointing to Notion's OAuth authorization endpoint with the registered client ID, encoded redirect URI, owner parameter set to user, and a 32-byte random state token saved with a 10-minute time-to-live

### Requirement: OAuth Callback State Validation and Code Exchange
The system SHALL validate the received state parameter against active server-side state records, mark the state as consumed upon first use, exchange the authorization code for an access token via Notion's token endpoint using HTTP Basic authentication, and redirect the user back to the frontend integration page with a safe status indicator.

#### Scenario: Successful code exchange and connection persistence
- **WHEN** the callback endpoint receives a valid authorization code and a matching, unconsumed, non-expired state
- **THEN** the system SHALL exchange the code with Notion via HTTP Basic client authentication, store the encrypted access token and workspace metadata, mark the state consumed, and redirect to the frontend integration page with a success indicator

#### Scenario: Replay attack prevention
- **WHEN** the callback endpoint receives a state token that has already been consumed
- **THEN** the system SHALL reject the callback and redirect to the frontend with an invalid_state error indicator

#### Scenario: Invalid or expired state rejection
- **WHEN** the callback endpoint receives an unknown or expired state token
- **THEN** the system SHALL reject the callback and redirect to the frontend with an invalid_state error indicator

#### Scenario: Notion authorization cancellation or denial
- **WHEN** Notion redirects to the callback with an error parameter indicating user cancellation or access denial
- **THEN** the system SHALL record the rejection and redirect the administrator to the frontend integration page indicating authorization was cancelled

### Requirement: Encrypted Credential and Single-Connection Storage
The system SHALL encrypt access tokens at rest using AES-256-GCM authenticated encryption before persisting the connection record, SHALL atomically update the existing record on reconnection, and SHALL NEVER expose access tokens or secrets through public API responses or logs.

#### Scenario: Reconnecting an existing Notion workspace
- **WHEN** an administrator completes OAuth authorization while an active Notion connection already exists
- **THEN** the system SHALL atomically update the existing single-tenant connection record with the newly encrypted access token and updated workspace metadata without creating duplicate rows

#### Scenario: Token leakage prevention
- **WHEN** connection details are queried through application APIs or logged to telemetry
- **THEN** the system SHALL return only non-sensitive workspace metadata and status, omitting decrypted access tokens and encryption keys

### Requirement: Safe Disconnection
The system SHALL provide endpoints for authorized administrators to safely disconnect the active workspace and handle repeated disconnect requests idempotently.

#### Scenario: Disconnect active workspace
- **WHEN** an authorized administrator sends a disconnect request
- **THEN** the system SHALL clear the stored credentials, set status to disconnected, and confirm successful disconnection

#### Scenario: Repeated disconnect request idempotency
- **WHEN** an administrator sends a disconnect request when the workspace is already disconnected
- **THEN** the system SHALL succeed without error and confirm the disconnected state
