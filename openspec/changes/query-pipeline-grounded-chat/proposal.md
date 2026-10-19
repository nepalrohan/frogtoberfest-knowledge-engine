## Why

The Knowledge Engine can ingest and index documents, but nobody can ask it anything yet: there is no chat API, no conversation storage, no retrieval and no answer generation. The web chat UI (`apps/web/app/chat`) and its API contract (`packages/api-client/src/modules/chat.ts`) already exist and run against an in-browser mock. The indexing side now stores searchable chunks (`vector(768)` with HNSW, a generated `search_vector`, and `embedding_model` per chunk), so the query pipeline can be built against real data.

## What Changes

- Add conversation persistence: `conversation` and `conversation_message` tables via a TypeORM migration, storing each assistant answer's outcome, refusal reason, sources and run details so history can be replayed with citations.
- Add the chat HTTP API under `/api/v1/chat`: list, get and delete conversations, plus `POST /api/v1/chat` (new conversation) and `POST /api/v1/chat/:id` (follow-up) that answer as a server-sent event stream (`meta → stage* → sources → token* → done`, or `error`).
- Add hybrid retrieval over `document_chunk`: query embedding (`embed(..., 'query')`) + pgvector cosine search + full-text search fused with Reciprocal Rank Fusion, limited to indexed, non-deleted documents embedded by the active model.
- Add grounded generation: a prompt that wraps sources in `<source_document>` delimiters, streams tokens from a local Ollama chat model, and post-checks `[Source N]` citations, refusing when evidence or citations are insufficient.
- Add a bounded conversation window (last 6 completed messages) and follow-up question rewriting so multi-turn questions retrieve on their own.
- Add operational safeguards: cancellation on client disconnect, LLM timeouts, a circuit breaker around the LLM, input length validation and per-client rate limiting.
- **Deviation from docs**: `docs/retrieval-and-citations.md` describes `POST /api/v1/chat` as a single JSON response. This change streams over SSE instead, matching the non-functional requirement for low-latency streaming and the existing web UI. The docs are updated as part of the change.

## Capabilities

### New Capabilities
- `conversation-history`: Storing, listing, resuming and deleting conversations and their messages, including the sources and diagnostics of every answer.
- `chat-streaming-api`: The `/api/v1/chat` HTTP surface and its server-sent event protocol, cancellation, validation and rate limiting.
- `hybrid-retrieval`: Turning a question into ranked, deduplicated context chunks using vector and keyword search with relevance gating.
- `grounded-answer-generation`: Prompt assembly, streamed local-LLM generation, citation verification and refusal behaviour.

### Modified Capabilities

## Impact

- **Backend**: New `apps/backend/src/modules/conversation/` module (controller, services, LLM adapter, entities) registered in `AppModule`; a new migration in `src/database/migrations/`; new config section (`llm`) in `AppConfigService`; new `LogEvents` use (`RETRIEVAL_*`, `CHAT_REQUEST_*`).
- **Indexing boundary**: Retrieval reads chunks through a `VectorStoreService` exported by the indexing module (per `docs/architecture.md`), and reuses the exported `EMBEDDING_PROVIDER_TOKEN`. No changes to ingestion or the embedding worker.
- **Shared contract**: `packages/api-client/src/modules/chat.ts` is the wire contract; the backend implements it unchanged. The web app switches from mock to live with `NEXT_PUBLIC_CHAT_API_MODE=live`.
- **Dependencies**: `@nestjs/throttler` for rate limiting. Ollama must serve a chat model (default `qwen2.5:7b-instruct`) in addition to `nomic-embed-text`.
- **Docs**: `docs/retrieval-and-citations.md` and `docs/implementation-plan.md` updated for SSE streaming and the final contract.
