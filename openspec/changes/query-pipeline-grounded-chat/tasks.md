## 1. Retrieval-ready schema (prerequisite, shared with indexing)

- [x] 1.1 Change `document_chunk.embedding` to `vector(768)`, add `embedding_model` and generated `search_vector` (GIN) and verify with the entity spec and a migration drift check reporting no changes
- [x] 1.2 Add TypeORM migrations (shared `buildDataSourceOptions`, CLI `data-source.ts`, `migration:*` scripts, `migrationsRun`, `synchronize` off by default) with `InitialSchema` including the HNSW cosine index, and verify run → revert → run on pgvector and a fresh app boot applying it
- [x] 1.3 Add `embed(texts, 'query' | 'document')` with model task prefixes and `getModelName()`; worker stores `embeddingModel` and rejects wrong-width vectors with `UnrecoverableError`; verify embedding worker and provider specs pass
- [x] 1.4 Update `docs/data-model.md` for 768-d vectors, new columns and the migration workflow
- [ ] 1.5 Share the schema and `embed()` signature change with the indexing owner and confirm the `VectorStoreService.searchHybrid(query, vector, model, options)` signature; record the agreement in this change's design.md

## 2. Configuration and module skeleton

- [ ] 2.1 Add `llm` and `retrieval` sections to `AppConfiguration`, `loadConfiguration` and `AppConfigService` with the defaults from design.md §8, plus `.env.example` entries; verify `pnpm --filter @my-project/backend check-types` passes
- [ ] 2.2 Create `src/modules/conversation/` (`ConversationModule` importing `IndexingModule`) registered in `AppModule`, and verify the app boots with `pnpm start` against a migrated database

## 3. Conversation persistence

- [ ] 3.1 Add `Conversation` and `ConversationMessage` entities (design.md §4) and generate the `AddConversations` migration; verify run/revert and a drift check reporting no changes
- [ ] 3.2 Implement `ConversationService` (create with 60-char title, append user message, store completed/stopped assistant message with sources and run, list with 90-char preview newest first, get, delete, last-6-completed history window) test-first at the agreed seams; verify its spec passes
- [ ] 3.3 Implement `GET /api/v1/chat`, `GET /api/v1/chat/:id` (404 on unknown) and `DELETE /api/v1/chat/:id` (204) and verify with a supertest spec

## 4. Streaming turn with a stub answer (wire protocol first)

- [ ] 4.1 Add `SendMessageDto` validation (trimmed, 1–2000 chars) and the SSE writer in `ChatController` for `POST /api/v1/chat` and `POST /api/v1/chat/:id` emitting `meta` → `token` (fixed text) → `done`; verify with a supertest spec asserting 400/404 before streaming, headers and event order
- [ ] 4.2 Wire client-disconnect cancellation (one `AbortController` per turn) storing the partial answer as `stopped`; verify with a spec that aborts mid-stream
- [ ] 4.3 Switch the web app to `NEXT_PUBLIC_CHAT_API_MODE=live` and verify in the browser that a new chat, sidebar listing, reopening and deleting work end to end against the stub

## 5. Hybrid retrieval

- [ ] 5.1 Implement `VectorStoreService.searchHybrid` in `modules/indexing/retrieval/` with the filtered vector + keyword CTE, RRF and `SET LOCAL` HNSW settings, exported from `IndexingModule`; verify with an opt-in integration spec against pgvector covering deleted, stale-version and other-model exclusion and keyword-only hits (also confirm pgvector ≥ 0.8)
- [ ] 5.2 Implement `ContextSelector` (relevance gate, max 5 sources, max 2 per document, duplicate removal, token budget, Source numbering) and verify with worked-example unit tests
- [ ] 5.3 Plug embedding (`'query'`), retrieval and selection into the turn, emitting `embed`/`retrieve`/`select` stage events and the `sources` event, and refusing with `insufficient_evidence` (no LLM call) below the threshold; verify with a turn spec using fakes

## 6. Grounded generation

- [ ] 6.1 Implement `OllamaLlmClient.streamChat` and `complete` (NDJSON parsing, idle timeout, abort, `CircuitBreaker`, `LLM_UNAVAILABLE` mapping) and verify with a spec using a mocked fetch stream
- [ ] 6.2 Implement `PromptBuilder` with `<source_document>` isolation and history, and verify with a spec asserting source delimiting and that history excludes stopped messages
- [ ] 6.3 Implement `CitationVerifier` (invalid citation removal, cited flags, `unverifiable_citations` and model-declared `insufficient_evidence` refusals) and verify with worked-example unit tests
- [ ] 6.4 Replace the stub with real generation in the turn (`generate` and `verify` stages, `done` only after the assistant row commits, retryable `error` on LLM failure); verify with turn specs for answered, refused, failure and circuit-open paths

## 7. Multi-turn and safeguards

- [ ] 7.1 Implement `QueryRewriter` for follow-ups (`rewrite` stage, 8 s timeout with fallback, rewritten query in run details) and verify with a turn spec for a pronoun follow-up and a rewrite timeout
- [ ] 7.2 Add `@nestjs/throttler` (NestJS 12 compatible release) limiting only the POST routes to 20/min/IP and verify the 21st request in a minute returns 429 while GET routes are unaffected
- [ ] 7.3 Add tracing and logs: run each turn in an `AppTracer` span, put its trace id in `meta` and run details, and log `RETRIEVAL_COMPLETED` / `RETRIEVAL_NO_EVIDENCE` / `CHAT_REQUEST_COMPLETED` / `CHAT_REQUEST_FAILED`; verify the trace id matches across `meta`, stored run and logs in a spec

## 8. End-to-end and docs

- [ ] 8.1 Add an Ollama service to `docker-compose.dev.yaml` (after team agreement) and document pulling `qwen2.5:7b-instruct` and `nomic-embed-text`; verify both models answer locally
- [ ] 8.2 Ingest two sample docs via `/api/v1/feed-knowledge`, wait for indexing, and verify in the browser: a cited answer, a citation hover/inspector, an off-topic refusal, a follow-up, stopping mid-answer, and reloading history with citations intact
- [ ] 8.3 Update `docs/retrieval-and-citations.md` and `docs/implementation-plan.md` for SSE streaming, the final message schema (`sources`, `run`, `outcome`) and config, and verify `openspec validate query-pipeline-grounded-chat --strict` passes
