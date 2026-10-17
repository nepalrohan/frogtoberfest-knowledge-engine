## Context

See proposal.md - Why.

The Knowledge Engine is designed as a TypeScript modular monolith ingesting external content into PostgreSQL 16 (`pgvector`), utilizing Redis 7 / BullMQ for asynchronous indexing, and OpenTelemetry for distributed tracing. To ingest knowledge from Notion, we must bridge the gap between Notion's deeply nested REST API responses (`v1/pages` and `v1/blocks/{id}/children`) and the database storage schema (`NormalizedDocumentPayload` / `document` table defined in `docs/data-model.md` and `docs/ingestion-and-sync.md`).

Existing infrastructure in `apps/backend/src/common` provides:
- Telemetry: `AppTracer` with OpenTelemetry tracing spans and `TraceContextPropagator`.
- Resilience: `CircuitBreaker`, `RetryPolicy` (with jittered exponential backoff), and `ErrorClassifier`.
- Structured Logging: `StructuredLogger` with domain event types in `LogEvents`.

## Goals / Non-Goals

**Goals:**
- Implement a decoupled, 4-stage processing pipeline: `NotionClient` → `NotionAdapter` → `NotionParser` → `CanonicalDocumentNormalizer`.
- Protect external API communication with existing `CircuitBreaker`, `RetryPolicy`, and `ErrorClassifier`.
- Implement bounded recursive traversal with configurable `maxDepth` and `maxRequests` budgets and explicit completeness diagnostics.
- Parse the 8 specified block types (`heading_1`, `heading_2`, `heading_3`, `paragraph`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`) into a provider-neutral AST preserving hierarchy and rich-text ordering.
- Normalize parsed AST into standard GitHub Flavored Markdown (GFM) with metadata frontmatter, compute SHA-256 hash, and validate `NormalizedDocumentPayload`.
- Provide complete offline test coverage using recorded API fixtures without external network dependencies.

**Non-Goals:**
- Modification of database migrations, TypeORM entities, or existing PostgreSQL schemas.
- Changes to BullMQ workers, vector embedding generation, chunking, or RAG query pipelines.
- Implementation of Confluence connectors (designed for future reuse of the canonical normalizer).
- Ingestion job scheduling, cron triggers, or persistence orchestration (handled by downstream ingestion workers).

## Decisions

### 1. Four-Tier Pipeline Architecture (Client → Adapter → Parser → Normalizer)
- **Decision**: Separate connector operations into distinct single-responsibility classes:
  1. `NotionClient`: Raw HTTP requests, authentication, circuit breaker, retries, and low-level error handling.
  2. `NotionAdapter`: Traversal orchestration, pagination, recursive child block assembly, and budget enforcement.
  3. `NotionParser`: Provider-neutral AST generation, rich-text extraction, and unsupported/malformed block handling.
  4. `CanonicalDocumentNormalizer`: Transformation of AST to GFM Markdown with frontmatter, SHA-256 hashing, and canonical contract validation.
- **Rationale**: Complies with SOLID (Single Responsibility, Interface Segregation), prevents Notion API types from leaking into domain entities, and enables straightforward unit testing at each seam.
- **Alternatives Considered**: Monolithic connector service. Rejected as it couples network failure handling with AST parsing, making testing and maintenance brittle.

### 2. Intermediate Provider-Neutral AST Representation
- **Decision**: Define a provider-neutral AST model (`NeutralElement[]` with `Heading`, `Text`, `ListItem`, `Task`, `Container`) between the parser and the canonical normalizer.
- **Rationale**: Decouples external API block structures from Markdown generation. When Confluence support is added, Confluence XHTML/ADF will map to the same `NeutralElement[]`, reusing the canonical markdown generation and validation engine.
- **Alternatives Considered**: Directly formatting Notion JSON into Markdown strings inside the parser. Rejected because it precludes structural validation, prevents tree traversal post-parsing, and prevents code reuse across future connectors.

### 3. Resilience Integration via Existing Common Modules
- **Decision**: Wrap Notion HTTP calls using `CircuitBreaker.execute` and `RetryPolicy.execute` from `apps/backend/src/common/resilience`. Use `ErrorClassifier` to distinguish transient errors (HTTP 429, 500, 503, timeouts) from permanent errors (HTTP 401, 403, 404).
- **Rationale**: Adheres to the user requirement and DRY principle, preventing duplicate resilience logic while providing production-grade fault tolerance.
- **Alternatives Considered**: Writing custom retry loops or axios interceptors. Rejected to avoid fragmentation and comply with existing project standards.

### 4. Distributed Tracing and Structured Logging Observability
- **Decision**: Instrument all client HTTP operations, adapter traversals, and normalization routines with `AppTracer.traceSpan`, recording semantic attributes (`source_type`, `page_id`, `request_count`, `block_count`). Emit structured JSON logs via `StructuredLogger` using `LogEvents`.
- **Rationale**: Provides end-to-end visibility across asynchronous synchronization pipelines and matches OpenTelemetry conventions.
- **Alternatives Considered**: Standard `console.log` or default NestJS logger. Rejected per project standards in `AGENTS.md`.

### 5. Configurable Safeguards and Explicit Completeness Outcomes
- **Decision**: Implement configurable `maxDepth` (default: 5) and `maxRequests` (default: 50) in `NotionAdapter`. When a limit is hit or a nested branch fails, the adapter returns a partial tree flagged with `isComplete: false` and attached diagnostics, rather than failing the entire document or silently dropping missing blocks.
- **Rationale**: Guarantees bounded resource usage and prevents runaway recursion while alerting operators to partial ingestions.
- **Alternatives Considered**: Throwing a fatal error on exceeding depth limits. Rejected because partial content is often valuable for recovery or logging, provided it is explicitly flagged.

## Risks / Trade-offs

- **[Risk] Deeply nested block hierarchies cause runaway recursion or API budget exhaustion**  
  → *Mitigation*: Hard recursion depth limits (`maxDepth`) and total request counters (`maxRequests`) enforced on each recursive step in `NotionAdapter`.
- **[Risk] Aggressive Notion API rate limits (HTTP 429)**  
  → *Mitigation*: Existing `RetryPolicy` with full jitter exponential backoff; reads and respects the `Retry-After` header when provided by Notion.
- **[Risk] Malformed or unsupported Notion blocks break pipeline**  
  → *Mitigation*: Supported blocks validate required fields; unsupported types follow a documented skip policy and log warnings; malformed blocks are explicitly captured as error diagnostics without unhandled exceptions.
- **[Risk] Non-deterministic tests due to external network dependency**  
  → *Mitigation*: Unit and contract test suites use offline JSON fixtures recorded from actual Notion API responses.

## Open Questions

*(None. All architectural requirements, schemas, and component seams are verified against docs/prd/connectors-prd.md and docs/data-model.md).*
