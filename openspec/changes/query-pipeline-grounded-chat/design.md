## Context

See proposal.md - Why. Requirements are in `specs/`; this document covers how.

What already exists and is reused:
- **Schema for search** (`apps/backend/src/entities/DocumentChunk.entity.ts`, migration `1792401700765-InitialSchema`): `embedding vector(768)` with HNSW cosine index, `embedding_model`, generated `search_vector tsvector` with GIN index. Migrations run on startup; `synchronize` is off.
- **Embeddings** (`modules/indexing/embedding`): `IEmbeddingProvider.embed(texts, 'query' | 'document')` applies model task prefixes; `getModelName()` identifies the vector space. Exported from `IndexingModule` as `EMBEDDING_PROVIDER_TOKEN`.
- **Cross-cutting** (`src/common`): `AppTracer.traceSpan`, `TraceContextPropagator`, `StructuredLogger` + `LogEvents` (`RETRIEVAL_*`, `CHAT_REQUEST_*` already defined), `CircuitBreaker`, `RetryPolicy`, `ErrorClassifier`.
- **HTTP**: global prefix `api`, URI versioning, CORS with credentials (a `*` origin is already mapped to `WEB_URL`), global `ValidationPipe`.
- **Wire contract**: `packages/api-client/src/modules/chat.ts` (types + SSE client). The web UI (`apps/web/components/chat/*`) consumes it directly (its development mock was removed once this change was implemented).

Constraints from `AGENTS.md` and `docs/`: modular monolith, local Ollama only, block comments, config via `AppConfigService`, W3C trace propagation, `[Source N]` citations or explicit refusal, no autonomous agents.

## Goals / Non-Goals

**Goals:**
- One NestJS module, `src/modules/conversation/`, owning the chat API, conversation storage and the answer pipeline.
- Every external dependency (vector store, embeddings, LLM) behind an interface so the turn pipeline is testable with fakes.
- First token within ~2 s on local hardware for a typical question after retrieval (generation speed itself is model-bound).

**Non-Goals:**
- Authentication and per-user ownership (single-tenant; `owner_id` defaults to `local_user` as in `docs/data-model.md`).
- Cross-encoder reranking, semantic answer caching, LLM-as-judge evaluation, tool calling. The `rerank` stage is not emitted in v1.
- Any change to ingestion, chunking or the embedding worker.
- The `pnpm test:eval` benchmark (milestone M6); thresholds here are starting values to be tuned by it.

## Decisions

### 1. Module layout and boundaries
```
src/entities/Conversation.entity.ts, ConversationMessage.entity.ts   (shared entities, like the others)
src/modules/indexing/retrieval/vector-store.service.ts               (hybrid SQL; exported read contract)
src/modules/conversation/
  chat.controller.ts            HTTP + SSE framing only
  conversation.service.ts       CRUD, history window, persistence of turns
  chat-turn.service.ts          orchestrates one turn: rewrite → embed → retrieve → select → generate → verify
  retrieval/context-selector.ts dedupe, per-document cap, token budget, Source numbering
  generation/prompt-builder.ts  system rules + <source_document> blocks + history
  generation/citation-verifier.ts
  generation/query-rewriter.ts
  llm/llm-client.interface.ts   LLM_CLIENT token; streamChat(), complete()
  llm/ollama-llm.client.ts      /api/chat NDJSON streaming, wrapped in CircuitBreaker
```
`docs/architecture.md` says the conversation module reads chunks through a `VectorStoreService` owned by indexing, so the SQL lives in `modules/indexing/retrieval/` and is exported from `IndexingModule`. It is a read-only contract; agree its signature with the indexing owner before merging.
*Alternative*: put retrieval SQL inside the conversation module — rejected because it couples the conversation module to chunk-table internals the indexing owner may change.

### 2. SSE over POST, written directly to the response
`@Sse()` in NestJS only supports GET and the browser `EventSource` cannot send a body, so the controller takes the Express `Response`, sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`, calls `flushHeaders()`, and writes `data: <json>\n\n` per event. The client already reads this with `fetch` + a stream parser.
Validation (DTO with `class-validator`: trimmed, 1–2000 chars) and the 404 check for an unknown conversation happen **before** headers are flushed, so they stay normal JSON errors (400/404/429).
*Alternatives*: GET + `EventSource` with a two-step "create then stream" handshake (extra round trip, harder retries); WebSockets (bidirectional channel not needed).

### 3. Cancellation via one AbortController per turn
The controller creates an `AbortController` and aborts it on `req.on('close')` when the response has not finished. The signal is passed to the embedding call and the Ollama `fetch`; the retrieval SQL is checked before and after (it completes in milliseconds, so it is not cancelled mid-query). On abort the turn stores the partial answer as `stopped` and writes nothing further.

### 4. Message storage: sources and run as JSONB
`conversation_message` follows `docs/data-model.md` with these refinements:
- `status`: `completed | stopped` (failed turns store no assistant row; see Risks).
- `outcome` (`answered | refused`, nullable), `refusal_reason` (nullable).
- `sources jsonb` replaces the docs' `citations`: it stores **all** context sources with a `cited` flag, because the UI shows uncited context too.
- `run jsonb` holds `RunDetails`.
The assistant message id is generated up front (`crypto.randomUUID()`) so `meta` can announce it; the row is inserted only after verification, and `done` is written only after that insert commits.
*Alternative*: normalized `message_source` table — rejected; sources are always read with their message and never queried independently.

### 5. Hybrid retrieval in one SQL statement
The `docs/retrieval-and-citations.md` CTE (vector top-20 ⟗ keyword top-20, RRF k=60) with these changes:
- Keyword side uses the stored `search_vector` and an **OR** of the question's stemmed lexemes (`tsvector_to_array(to_tsvector('english', $q))`, each `quote_literal`-ed), ranked by `ts_rank_cd`. *Changed during implementation*: `websearch_to_tsquery` ANDs every word, so "How do I roll back a bad deploy?" did not match "To roll back, redeploy the previous release tag"; OR + coverage ranking keeps exact-identifier hits while letting partial matches rank. A stopword-only question yields no keyword side.
- Both sides filter `d.deleted_at IS NULL AND d.sync_status = 'indexed' AND c.document_version = d.version AND c.embedding_model = $model`.
- Runs in a transaction with transaction-local `hnsw.ef_search = max(100, 2·K)` and `hnsw.iterative_scan = relaxed_order` (verified on pgvector 0.8.7) so the filters cannot starve the top-K vector list. The vector side orders and limits in an inner query so the HNSW index drives the scan (confirmed with `EXPLAIN`); ranks are numbered outside it.
- Returns cosine similarity, both ranks and the RRF score; the relevance gate (best cosine ≥ `minSimilarity`, default 0.65) and context selection happen in TypeScript.

### 6. LLM client: Ollama `/api/chat` streaming
`OllamaLlmClient.streamChat(messages, { signal, onToken })` posts `{ model, messages, stream: true, options: { temperature, num_ctx } }`, parses NDJSON lines, forwards `message.content` deltas, and returns final text plus `prompt_eval_count` / `eval_count` as token usage. An idle timer aborts if no chunk arrives for 30 s. Calls run inside `CircuitBreaker` (5 failures → open 30 s); no automatic retry once tokens have been streamed (a retry would duplicate text). Errors map to `LLM_UNAVAILABLE` (retryable).
`complete()` (non-streaming) serves query rewriting with an 8 s timeout and falls back to the original question.

### 7. Prompt and citation verification
Prompt order: system rules (from `docs/retrieval-and-citations.md` plus the instruction-hierarchy rule from `docs/security.md`), then the last ≤ 6 completed messages as chat history, then a user turn containing the `<source_document id="N" title="…">` blocks followed by the question.
`CitationVerifier` is a pure function: normalize marker variants (small local models such as `phi4-mini` write `[Source Document 1]`), extract `[Source N]`, drop invalid N, mark `cited`, decide outcome (`answered`, `refused/unverifiable_citations`, or `refused/insufficient_evidence` when the model emits the fallback phrase). Since tokens are already streamed, a post-hoc refusal is signalled by `done.outcome = 'refused'`; the UI renders the refusal state from `done`, and the stored content is the refusal text.

### 8. Configuration
New `llm` section in `AppConfiguration` via `AppConfigService` (no `process.env` elsewhere): `baseUrl` (default `OLLAMA_URL`), `chatModel` (`GENERATION_MODEL`, default `qwen2.5:7b-instruct`), `temperature` (0.1), `numCtx` (8192), `idleTimeoutMs` (30000), `rewriteTimeoutMs` (8000). New `retrieval` section: `minSimilarity` (0.65), `candidateK` (20), `maxSources` (5), `maxSourcesPerDocument` (2), `contextTokenBudget` (2500).

### 9. Rate limiting
`@nestjs/throttler` with an in-memory store (single process, per the monolith non-goals), applied only to the two POST routes (20/min/IP). Verify the throttler release that supports NestJS 12 during the first task.

### 10. Test seams (to confirm when applying, per the `tdd` skill)
- `ChatTurnService` with fake `IVectorStore`, `IEmbeddingProvider`, `ILlmClient`: event order, refusal paths, persistence order, abort.
- `CitationVerifier` and `ContextSelector`: pure unit tests from worked examples.
- `VectorStoreService`: integration test against a real pgvector database (opt-in via `TEST_DATABASE_URL`), asserting filters and RRF ordering.
- `ChatController`: supertest over the Nest app with fakes, asserting HTTP codes and SSE framing.

## Risks / Trade-offs

- **[0.65 cosine threshold is from the docs, not measured for nomic-embed-text]** → Configurable `RETRIEVAL_MIN_SIMILARITY`; log best similarity per question; tune with the M6 eval set.
- **[Tokens stream before verification]** → A refused-after-streaming answer is briefly visible as text; `done.outcome = 'refused'` switches the UI to the refusal state and history stores only the refusal. Buffering the whole answer would remove streaming, which is a stated requirement.
- **[Failed turns leave a user message without a reply; UI "Retry" re-sends it, duplicating the question in history]** → Accepted for v1; history remains readable. Revisit if it confuses users.
- **[Filtered HNSW scans can return fewer than K rows]** → `hnsw.iterative_scan` (pgvector ≥ 0.8; `pgvector/pgvector:pg16` ships 0.8+); verify the version in the first retrieval task.
- **[Local 7B model latency on CPU]** → Stage events keep the UI informative; quantized model default; LLM concurrency limited by the circuit breaker plus rate limit.
- **[Indexing module boundary]** → `VectorStoreService` lives in the collaborator's module; agree the interface (`searchHybrid(query, vector, model, options)`) before implementation to avoid churn. *Shared with the indexing owner (2026-10-19): schema changes, `embed(texts, 'query' | 'document')`, `searchHybrid`, and `GET /api/v1/documents`.*

## Migration Plan

1. Add migration `AddConversations` (tables `conversation`, `conversation_message`, index `(conversation_id, created_at)`); it runs automatically on startup and is reversible with `pnpm migration:revert`.
2. Add `ollama` service to `docker-compose.dev.yaml` (if the team agrees) and pull `qwen2.5:7b-instruct` + `nomic-embed-text`.
3. Deploy the backend and web app together. Rollback: revert both and run `pnpm migration:revert`.

## Open Questions

- Exact rate-limit numbers and context token budget for the demo hardware — tunable config values, no design change.
