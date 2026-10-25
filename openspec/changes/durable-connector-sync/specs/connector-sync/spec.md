## Purpose

Enables durable, background synchronization of selected external documents, detecting remote edits across external providers, safely incrementing document versions, and preventing stale or failed updates from corrupting canonical knowledge.

## ADDED Requirements

### Requirement: Persistent Resource Selection and Tracking Separation
The system SHALL persist user-selected external resources independently from transient processing state, ensuring selections remain subscribed for continuous synchronization without requiring manual re-selection.

#### Scenario: Selection persists across system restarts
- **WHEN** an administrator selects external resources for a connection and the system restarts
- **THEN** the selection configuration remains durably saved and the resources remain actively tracked for future synchronization

#### Scenario: Idempotent resource selection
- **WHEN** a selection request specifies resources that are already tracked for that connection
- **THEN** the system updates the selection set without creating duplicate tracking records or duplicate running jobs

#### Scenario: Distinct connections tracking identical external resources
- **WHEN** two distinct connections select the same external resource identifier
- **THEN** the system maintains independent synchronization tracking states, versions, and schedules for each connection

---

### Requirement: Asynchronous Selection Acceptance and Queue Durability
The system SHALL process document retrieval, parsing, normalization, and version publication asynchronously via background queues, immediately acknowledging selection requests with an accepted status.

#### Scenario: Immediate acceptance response
- **WHEN** a client submits a resource selection request
- **THEN** the system responds with HTTP status 202 Accepted containing a safe synchronization tracking identifier, without blocking on document fetching or processing

#### Scenario: Transactional queue dispatch durability
- **WHEN** a resource selection is persisted to the database and an unexpected application termination occurs before message queue publishing
- **THEN** the persisted work is preserved in a transactional outbox and automatically enqueued for background processing upon service recovery

#### Scenario: Deterministic job deduplication
- **WHEN** duplicate synchronization signals for the same resource and connection arrive while a job is pending or active
- **THEN** the queue infrastructure coalesces the duplicate requests, executing at most one active job for that resource

---

### Requirement: Provider-Neutral Change Detection and Content Fingerprinting
The system SHALL evaluate source revision metadata and deterministic content fingerprints before updating canonical documents, avoiding redundant storage and unnecessary re-indexing when source content is unchanged.

#### Scenario: No-op synchronization for unchanged content
- **WHEN** a synchronization job executes for a resource whose source revision and content fingerprint match the last successfully processed state
- **THEN** the system records a successful synchronization timestamp and SHALL NOT increment the document version or produce downstream indexing events

#### Scenario: Detection of meaningful content modifications
- **WHEN** a synchronization job detects that external source content has changed from the last processed fingerprint
- **THEN** the system generates a new normalized representation, updates the tracked fingerprint, and advances the document version

#### Scenario: Authoritative snapshot retrieval from change signals
- **WHEN** a webhook or periodic change notification signals that a resource was modified
- **THEN** the system treats the signal as a trigger to fetch the authoritative current content from the provider API rather than assuming the payload is complete

---

### Requirement: Version-Safe Canonical Document Updates
The system SHALL delegate canonical document persistence to a document storage contract with strictly monotonic version numbers, guaranteeing that incomplete or failed processing runs never overwrite or degrade the last known-good published version.

#### Scenario: Initial synchronization document creation
- **WHEN** a selected external resource is synchronized for the first time
- **THEN** the system invokes the document storage service with the normalized payload and version 1, and marks the sync item as completed

#### Scenario: Subsequent update increments version monotonically
- **WHEN** an existing document is updated with authoritatively verified new content
- **THEN** the system invokes the document storage service with an incremented version number, preserving previous versions in history

#### Scenario: Failed processing preserves current published version
- **WHEN** an error occurs during document fetching, parsing, or normalization during an update run
- **THEN** the document storage service is not invoked, the existing published document version remains intact, and the synchronization failure is logged with diagnostic details

---

### Requirement: Concurrency and Stale-Result Protection
The system SHALL enforce optimistic concurrency checks prior to publishing document updates, ensuring that slower or out-of-order worker executions cannot overwrite newer published versions.

#### Scenario: Stale job execution prevention
- **WHEN** a worker completes processing for an older revision after a newer version of the same document has already been published
- **THEN** the system detects the version mismatch, discards the obsolete processing output, and does not alter the current published document

#### Scenario: Concurrent update serialization
- **WHEN** two synchronization executions for the same resource execute concurrently
- **THEN** atomic database checks ensure only the job representing the latest valid state commits the current document version

---

### Requirement: Resilient Error Handling and Deselection Semantics
The system SHALL classify synchronization failures into retryable and permanent categories, adjust connection health on confirmed auth revocation, and cleanly cease processing for deselected resources.

#### Scenario: Transient provider failure retry
- **WHEN** a synchronization run encounters a network timeout, rate limit (HTTP 429), or temporary 5xx provider outage
- **THEN** the system retries the job using exponential backoff up to the configured retry threshold before marking the attempt failed

#### Scenario: Confirmed credential revocation
- **WHEN** an external provider responds with an explicit authentication rejection (HTTP 401 Unauthorized or revoked token error)
- **THEN** the system updates the connection status to indicate re-authorization is required, suppresses automated retries, and records the failure reason

#### Scenario: Resource deselection terminates synchronization
- **WHEN** an administrator deselects a previously tracked resource
- **THEN** the system marks the sync item as deselected, suppresses subsequent scheduled runs, and rejects publication if an in-flight job completes after deselection
