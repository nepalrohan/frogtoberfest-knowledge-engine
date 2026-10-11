# AI Context & Coding Standards — Knowledge Engine

## 1. System Overview & Scope
- **Domain**: Internal knowledge assistant (RAG) ingesting **Notion** & **Confluence**.
- **Stack**: NestJS 12, PostgreSQL 16 (`pgvector`) + TypeORM, Redis 7 + BullMQ, Ollama (Local OSS LLM/Embeddings).
- **Architecture**: Modular monolith in Docker Compose.
- **Boundaries (Strict Non-Goals)**: No cloud queues (no AWS SQS/Kafka), no microservices/k8s, no autonomous multi-step agents, single-tenant internal workspace only.

---

## 2. Mandatory Engineering Rules

### 1. Agent Skills & References
- **Must Read Skills**: Always check relevant `.agents/skills/` (e.g. `nestjs-best-practices`, `nextjs-app-router-patterns`, `tdd`) before writing or refactoring code.

### 2. Design Principles
- **DRY**: Centralize shared logic in domain/common services; avoid copy-pasting DTOs or query logic.
- **KISS**: Favor straightforward solutions over over-engineered abstractions.
- **SOLID**:
  - Single Responsibility: Keep services, controllers, and workers focused on a single task.
  - Open/Closed: Design connectors and processors via interfaces for extensibility.
  - Liskov Substitution: Connector implementations must adhere strictly to base contracts.
  - Interface Segregation: Keep interfaces lean and role-specific.
  - Dependency Injection: Inject dependencies via constructors using NestJS tokens/classes.

### 3. Commenting Standard
- **Format**: Always use block comments for function, class, and inline logic explanations:
  ```typescript
  /* comment goes here ... */
  ```
- Keep comments concise and focused on intent/invariants rather than restating code.

### 4. Telemetry, Tracing & Logging
- **Trace Propagation**: Propagate W3C trace context (`traceparent`, `tracestate`) across asynchronous jobs and outbox events using `TraceContextPropagator.injectToCarrier` and `TraceContextPropagator.extractFromCarrier`.
- **Structured Logs**: Always use `StructuredLogger` with defined `LogEvents` (`LogEvents.INGESTION_*`, `LogEvents.INDEXING_*`, etc.).
- **Error Classification**: Use `ErrorClassifier` for error categorizing (`TRANSIENT`, `PERMANENT`) to drive retries.

### 5. Configuration
- **NestJS ConfigService**: Always retrieve environment variables via `ConfigService` / `AppConfigService`. Never use raw `process.env` in domain logic. No Zod schemas in backend configuration.

---

## 3. Core Architecture Invariants

- **Transactional Outbox**: Mutations must persist domain entities and outbox rows in the same ACID transaction. Poller reads with `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Deduplication**: BullMQ Job ID format: `embed:<documentId>:<documentVersion>`.
- **Stale Job Protection**: Workers must verify `currentDoc.version <= documentVersion` before overwriting vector chunks.
- **Grounded Citations**: LLM responses must strictly use verifiable `[Source N]` citations or explicitly refuse when evidence is insufficient.

---

## 4. Key Commands
- Typecheck: `pnpm --filter @my-project/backend check-types`
- Test: `pnpm --filter @my-project/backend test`
- Dev: `pnpm dev`
