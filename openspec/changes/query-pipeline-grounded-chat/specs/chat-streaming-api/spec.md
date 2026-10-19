## Purpose

Defines the HTTP interface and server-sent event protocol the web chat uses to ask questions, receive answers as they are generated, and manage conversation history.

## ADDED Requirements

### Requirement: Chat endpoints
The system SHALL expose these endpoints under the API prefix and version 1:
- `GET /api/v1/chat` — list conversations
- `GET /api/v1/chat/:id` — fetch one conversation
- `DELETE /api/v1/chat/:id` — delete a conversation (HTTP 204)
- `POST /api/v1/chat` — ask a question in a new conversation
- `POST /api/v1/chat/:id` — ask a follow-up in an existing conversation

Request bodies for the POST endpoints SHALL be `{ "message": string }`.

#### Scenario: Follow-up to an unknown conversation
- **WHEN** a client posts a message to `/api/v1/chat/:id` for an id that does not exist
- **THEN** the system responds with HTTP 404 and no stream is opened

### Requirement: Streamed answer protocol
The POST endpoints SHALL respond with `Content-Type: text/event-stream`, each event a single `data:` line carrying one JSON object, in this order: exactly one `meta` event; zero or more `stage` events; at most one `sources` event; zero or more `token` events; then exactly one terminal `done` or `error` event, after which the stream closes. Event shapes SHALL match the shared contract in `packages/api-client/src/modules/chat.ts`.

#### Scenario: Successful answer event order
- **WHEN** a question with relevant evidence is asked
- **THEN** the client receives `meta`, then `stage` events, then `sources`, then `token` events, then `done` with outcome `answered`

#### Scenario: Meta event identifies the turn
- **WHEN** any question is asked
- **THEN** the first event is `meta` with the conversation id, the stored user message id, the assistant message id, the trace id and the conversation title

#### Scenario: Refusal still streams its text
- **WHEN** the system refuses for lack of evidence
- **THEN** the refusal text arrives as `token` events and the terminal `done` event has outcome `refused` and a refusal reason

#### Scenario: Failure after the stream started
- **WHEN** the language model fails after `meta` was sent
- **THEN** the stream ends with one `error` event carrying a code, a human-readable message and whether retrying may help

### Requirement: Pipeline stage reporting
The system SHALL emit a `stage` event with status `started` when each pipeline stage begins and `completed` with its duration when it ends, using the stage names `rewrite`, `embed`, `retrieve`, `rerank`, `select`, `generate` and `verify`. Stages that do not run for a question SHALL NOT be reported.

#### Scenario: First question skips rewriting
- **WHEN** the first question of a conversation is asked
- **THEN** no `rewrite` stage events are emitted

### Requirement: Cancellation on client disconnect
The system SHALL stop retrieval and generation work and release the model connection within 1 second when the client closes the stream.

#### Scenario: Client aborts during generation
- **WHEN** the client aborts the request while tokens are streaming
- **THEN** the request to the language model is cancelled and the partial answer is stored as `stopped`

### Requirement: Input validation
The system SHALL reject a message that is empty after trimming or longer than 2000 characters with HTTP 400 before opening a stream or storing anything.

#### Scenario: Oversized question
- **WHEN** a client posts a 2001-character message
- **THEN** the system responds with HTTP 400 and no conversation or message is created

### Requirement: Rate limiting
The system SHALL limit question submissions per client address to 20 per minute and respond with HTTP 429 beyond that limit; listing, fetching and deleting conversations SHALL NOT count toward it.

#### Scenario: Burst of questions
- **WHEN** one client posts 21 questions within a minute
- **THEN** the 21st request receives HTTP 429

### Requirement: Trace correlation
Every streamed turn SHALL run inside a trace whose id is returned in the `meta` event and in the stored run details, and its structured logs SHALL carry that trace id.

#### Scenario: Trace id matches logs
- **WHEN** a question is answered
- **THEN** the `meta` event trace id equals the trace id in the stored run details and in the chat request log entries
