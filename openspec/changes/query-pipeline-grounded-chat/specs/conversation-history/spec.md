## Purpose

Keeps every chat conversation and its messages durable so users can list past conversations, resume them with full context, and see the sources behind every earlier answer.

## ADDED Requirements

### Requirement: Conversation creation on first message
The system SHALL create a new conversation when a message is sent without a conversation id, titled from the first question (trimmed to at most 60 characters), and SHALL return its id before any answer content is streamed.

#### Scenario: First question starts a conversation
- **WHEN** a client sends "How do I roll back a bad deploy?" without a conversation id
- **THEN** a conversation titled "How do I roll back a bad deploy?" exists and its id is delivered in the first stream event

#### Scenario: Long first question is truncated for the title
- **WHEN** the first question is 200 characters long
- **THEN** the conversation title is its first 60 characters

### Requirement: User message persisted before answering
The system SHALL persist the user's message before retrieval or generation begins, so the question survives any later failure.

#### Scenario: Generation fails after the question is stored
- **WHEN** the language model is unavailable while answering
- **THEN** the user message remains in the conversation history and no assistant message is stored as completed

### Requirement: Assistant answer persisted with sources and diagnostics
The system SHALL persist each finished assistant answer together with its outcome (`answered` or `refused`), refusal reason when refused, the context sources sent to the model (index, chunk, document, version, title, URL, section path, snippet, score, cited flag) and run details (trace id, models, token counts, per-stage timings). The answer SHALL only be reported as finished to the client after it is durably stored.

#### Scenario: Answer replayed from history with citations
- **WHEN** a client fetches a conversation whose answer cited Source 1 and Source 2
- **THEN** the returned assistant message contains the same content, outcome `answered`, both sources marked `cited`, and the run details

#### Scenario: Persistence failure surfaces as an error
- **WHEN** storing the assistant answer fails
- **THEN** the client receives an error event instead of a done event

### Requirement: Stopped answers are recorded as incomplete
The system SHALL store an answer interrupted by the client as status `stopped` with the content generated so far, and SHALL exclude it from the context window of later turns.

#### Scenario: User stops generation mid-answer
- **WHEN** the client disconnects after 20 tokens were streamed
- **THEN** an assistant message with status `stopped` and those 20 tokens is stored and is not used as history for the next question

### Requirement: Listing conversations
The system SHALL list conversations newest-updated first, each with id, title, a preview of the last message (at most 90 characters, whitespace collapsed), message count and last-updated time.

#### Scenario: Recently used conversation moves to the top
- **WHEN** a follow-up is sent in an older conversation
- **THEN** that conversation is first in the next listing

### Requirement: Fetching a conversation
The system SHALL return a conversation's full message history in chronological order, and SHALL respond with not found for an unknown id.

#### Scenario: Unknown conversation id
- **WHEN** a client fetches a conversation id that does not exist
- **THEN** the system responds with HTTP 404

### Requirement: Deleting a conversation
The system SHALL permanently delete a conversation and all its messages, and later fetches of it SHALL return not found.

#### Scenario: Deleted conversation disappears
- **WHEN** a client deletes a conversation and then lists conversations
- **THEN** the deleted conversation is absent and fetching it returns HTTP 404

### Requirement: Bounded conversation context
The system SHALL use at most the last 6 completed messages of a conversation as conversational context for a new question, and SHALL always retrieve fresh evidence for every question rather than relying on earlier answers as facts.

#### Scenario: Long conversation context is bounded
- **WHEN** a conversation already has 20 completed messages and a new question arrives
- **THEN** only the 6 most recent completed messages are used as context
