## MODIFIED Requirements

### Requirement: Version-Safe Canonical Document Updates
The system SHALL durably persist canonical documents produced by synchronization with strictly monotonic version numbers, guaranteeing that incomplete or failed processing runs never overwrite or degrade the last known-good published version, and that a published document survives application restarts.

#### Scenario: Initial synchronization document creation
- **WHEN** a selected external resource is synchronized for the first time
- **THEN** the system durably stores a canonical document for that resource at version 1 with its normalized content and content hash, and marks the sync item as completed

#### Scenario: Subsequent update increments version monotonically
- **WHEN** an existing document is updated with authoritatively verified new content
- **THEN** the system stores the new content under the next version number (previous version + 1) and marks the sync item as completed

#### Scenario: Identical content does not create a new version
- **WHEN** a synchronization run produces normalized content whose content hash equals the currently stored document's hash
- **THEN** the document version is not incremented, no indexing event is produced, and the sync item is marked completed

#### Scenario: Failed processing preserves current published version
- **WHEN** an error occurs during document fetching, parsing, normalization, or persistence during an update run
- **THEN** the existing published document version remains intact, no partial document or indexing event is committed, and the synchronization failure is logged with diagnostic details

#### Scenario: Persisted documents survive restart
- **WHEN** a document has been synchronized and the application restarts
- **THEN** the document and its version remain available for retrieval and are not re-created on the next unchanged synchronization run

---

### Requirement: Resilient Error Handling and Deselection Semantics
The system SHALL classify synchronization failures into retryable and permanent categories, adjust connection health on confirmed auth revocation, cleanly cease processing for deselected resources, and allow a resource whose synchronization failed permanently to be synchronized again when re-selected.

#### Scenario: Transient provider failure retry
- **WHEN** a synchronization run encounters a network timeout, rate limit (HTTP 429), or temporary 5xx provider outage
- **THEN** the system retries the job using exponential backoff up to the configured retry threshold before marking the attempt failed

#### Scenario: Confirmed credential revocation
- **WHEN** an external provider responds with an explicit authentication rejection (HTTP 401 Unauthorized or revoked token error)
- **THEN** the system updates the connection status to indicate re-authorization is required, suppresses automated retries, and records the failure reason

#### Scenario: Resource deselection terminates synchronization
- **WHEN** an administrator deselects a previously tracked resource
- **THEN** the system marks the sync item as deselected, suppresses subsequent scheduled runs, and rejects publication if an in-flight job completes after deselection

#### Scenario: Deselection racing with publication
- **WHEN** a resource is deselected at the same moment an in-flight job attempts to publish its document
- **THEN** exactly one outcome is committed: either the document is published before the deselection is recorded, or the publication is rejected and no document version or indexing event is written

#### Scenario: Re-selection after permanent failure
- **WHEN** a resource whose sync item is in a failed state is selected again
- **THEN** the system schedules and executes a fresh synchronization job for it

## ADDED Requirements

### Requirement: Synchronized Documents Trigger Indexing Atomically
The system SHALL record the indexing request for every new document version in the same atomic unit of work that persists that version, so that a published synchronized document is always eventually embedded and never indexed without being persisted.

#### Scenario: New version enqueues indexing
- **WHEN** a synchronization run persists a new document version
- **THEN** an indexing event for exactly that document identifier and version is recorded together with the document, and the document is reported as pending embedding

#### Scenario: Crash between persistence and indexing dispatch
- **WHEN** the application terminates after a document version is committed but before its indexing event is published to the queue
- **THEN** the indexing event is delivered after recovery and the document version is embedded

#### Scenario: Rejected publication emits no indexing event
- **WHEN** a publication is rejected because the resource was deselected or a newer version already exists
- **THEN** no indexing event is recorded for the rejected content

---

### Requirement: Single Canonical Document per Source Resource
The system SHALL maintain at most one canonical document per source type and source identifier, regardless of whether the document arrived through a connector synchronization or direct ingestion, and regardless of concurrent writers.

#### Scenario: Concurrent first synchronizations
- **WHEN** two writers attempt to create the first version of the same source resource concurrently
- **THEN** exactly one document record exists afterwards, and the losing writer either applies its content as the next version or detects identical content and makes no change

#### Scenario: Connector and direct ingestion share identity
- **WHEN** a resource has been synchronized by a connector and the same source type and identifier is later ingested directly
- **THEN** the ingestion updates the existing document under the same version rules instead of creating a second document
