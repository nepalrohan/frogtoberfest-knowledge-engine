## Purpose

Guarantees that events recorded in transactional outbox tables are delivered to background queues reliably, with bounded load, retry backoff, and dead-lettering of events or jobs that can never succeed, using one shared delivery mechanism for every outbox.

## ADDED Requirements

### Requirement: Continuous Background Outbox Draining
The system SHALL continuously drain every registered outbox table in the background while the application runs, without requiring a user action or API call to trigger delivery, and SHALL stop draining cleanly on shutdown.

#### Scenario: Pending events are delivered without manual triggering
- **WHEN** a pending outbox event is committed and the application is running
- **THEN** the event is published to its target queue within the configured polling interval and marked published

#### Scenario: Overlapping drain cycles are prevented
- **WHEN** a drain cycle is still in progress when the next polling interval elapses
- **THEN** the system skips the new cycle rather than running two drain cycles concurrently in the same process

#### Scenario: Graceful shutdown
- **WHEN** the application receives a shutdown signal
- **THEN** the system stops scheduling new drain cycles and does not leave claimed events stuck in a non-pending, non-terminal state

---

### Requirement: Multi-Instance Safe Event Claiming
The system SHALL claim outbox events so that concurrent application instances never publish the same event concurrently, and SHALL NOT hold database row locks while waiting on queue network calls.

#### Scenario: Concurrent instances claim disjoint events
- **WHEN** two application instances drain the same outbox table at the same time
- **THEN** each pending event is claimed by at most one instance per cycle

#### Scenario: Database locks are released before publishing
- **WHEN** a drain cycle publishes a batch of claimed events
- **THEN** the claiming transaction has already committed, and event outcomes are persisted in a separate short transaction after publishing

---

### Requirement: Bounded Publishing Concurrency
The system SHALL publish a claimed batch with a configurable upper bound on concurrent queue operations and SHALL persist all outcomes of the batch with a constant number of database round-trips, independent of batch size.

#### Scenario: Concurrency limit is respected
- **WHEN** a batch larger than the configured concurrency limit is published
- **THEN** no more than the configured number of publish operations are in flight at any moment

#### Scenario: Batch outcomes persisted in bulk
- **WHEN** a batch of N events finishes publishing with mixed success and failure
- **THEN** all N outcome updates are persisted together rather than through one write per event

#### Scenario: One failure does not block the batch
- **WHEN** one event in a batch fails to publish
- **THEN** the remaining events in the batch are still published and marked published

---

### Requirement: Deterministic Job Identity on Publish
The system SHALL publish each outbox event with a deterministic job identifier derived from the event's domain identity, so that re-publishing the same event after a crash or retry does not create duplicate active jobs.

#### Scenario: Re-publish after crash is deduplicated
- **WHEN** an event was published to the queue but the process crashed before marking it published, and the event is published again
- **THEN** the queue holds at most one job for that identifier

#### Scenario: Trace context travels with the job
- **WHEN** an outbox event carrying W3C trace context is published
- **THEN** the resulting job payload carries the same `traceparent` and `tracestate` values

---

### Requirement: Publish Retry Backoff and Outbox Dead-Lettering
The system SHALL retry transiently failed publish attempts after an increasing delay, and SHALL move an event to a terminal dead-lettered state, recording the failure reason, when the failure is permanent or the configured maximum number of attempts is reached.

#### Scenario: Transient publish failure waits before retry
- **WHEN** publishing an event fails with a transient error
- **THEN** the event stays pending, its attempt count increments, and it is not claimed again until its backoff delay has elapsed

#### Scenario: Permanent publish failure is dead-lettered immediately
- **WHEN** publishing an event fails with a permanent error
- **THEN** the event is marked dead-lettered with the error message and is never claimed again

#### Scenario: Attempts exhausted
- **WHEN** an event's attempt count reaches the configured maximum
- **THEN** the event is marked dead-lettered with its last error, and a structured log entry identifies the event and its target job identifier

---

### Requirement: Background Job Dead-Letter Capture
The system SHALL capture every background sync job that fails permanently or exhausts its retry attempts into a dead-letter queue, preserving its payload, final error, attempt count, and trace context, and SHALL release the job's deterministic identifier so the same resource can be scheduled again.

#### Scenario: Exhausted job captured in dead-letter queue
- **WHEN** a sync job fails on its final allowed attempt
- **THEN** a dead-letter entry containing the original payload, error message, error category, and attempt count is added to the dead-letter queue

#### Scenario: Permanent job failure captured without further retries
- **WHEN** a sync job fails with a permanent, non-retryable error
- **THEN** the job is not retried and a dead-letter entry is recorded

#### Scenario: Dead-lettered resource can be re-scheduled
- **WHEN** a resource whose previous job was dead-lettered is selected for synchronization again
- **THEN** a new job for that resource is enqueued and executed rather than being silently dropped as a duplicate
