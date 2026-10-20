# PRD: Notion Connector and Canonical Document Normalization

**Status:** Ready for implementation planning  
**Priority:** High  
**Scope:** Notion integration, recursive block retrieval, parsing, and canonical normalization  
**Language:** TypeScript / Node.js

## 1. Objective

Build a maintainable Notion connector that retrieves page metadata and nested content, transforms supported Notion blocks into a structured, provider-neutral representation, and normalizes the result into the knowledge engine's canonical document schema.

The design must make adding future connectors, such as Confluence, possible without changing the existing downstream processing pipeline.

**Guiding principle:** Quality over quantity. Prefer a small number of explicit, testable responsibilities over a generalized connector framework.

## 2. Goals

- Retrieve Notion page metadata and all supported content within defined traversal limits.
- Handle API pagination and nested block retrieval reliably.
- Parse supported block types into structured content while preserving order and hierarchy.
- Normalize parsed content into the existing canonical document contract.
- Report incomplete retrieval and parsing failures explicitly.
- Keep Notion-specific API details out of shared domain models.
- Support independent unit testing using recorded API response fixtures.

## 3. Scope

### In scope

**Notion client**
- Execute required Notion API operations.
- Apply authentication and API-version configuration using existing project conventions.
- Handle HTTP errors, rate limits, timeouts, and predictable error classification.

**Notion adapter**
- Retrieve page properties and metadata.
- Retrieve paginated block children.
- Recursively retrieve nested blocks.
- Enforce maximum nesting depth and total-request limits.
- Preserve block order and parent-child relationships.
- Report whether retrieval completed successfully.

**Notion parser**
- Extract readable text from Notion rich-text elements.
- Map supported block types into structured, provider-neutral content.
- Preserve headings, list types, nesting, and task state.
- Handle unsupported and malformed blocks explicitly.

**Canonical normalizer**
- Map parsed content and source metadata into the existing canonical document schema.
- Validate required fields and supported content types.
- Preserve tenant identity and source provenance.
- Produce a normalized document suitable for downstream consumers.

**Testing and documentation**
- Unit tests for the client, adapter traversal, parser, and normalizer.
- Contract tests for canonical output.
- Focused documentation describing component responsibilities and limitations.

### Out of scope

- Changes to ingestion orchestration, workers, queues, or ingestion state machines.
- Database migrations or changes to existing persistence models.
- Chunking, embedding generation, vector storage, and indexing.
- Retrieval, ranking, and answer generation.
- Implementing the Confluence connector.
- Building a generic plugin framework or configurable parser engine.
- Supporting every Notion block type.
- Redesigning the existing authentication or source-connection management system.

## 4. Supported Notion content

The initial implementation must support the following block types:

| Notion block | Normalized representation | Requirements |
|---|---|---|
| `heading_1` | Heading | Preserve level |
| `heading_2` | Heading | Preserve level |
| `heading_3` | Heading | Preserve level |
| `paragraph` | Text | Preserve readable text and order |
| `bulleted_list_item` | List item | Preserve unordered semantics |
| `numbered_list_item` | List item | Preserve ordered semantics |
| `to_do` | Task | Preserve text and checked state |
| `toggle` | Structured container | Preserve label and nested content |

Rich-text extraction must preserve text ordering. Hyperlinks should be retained where supported by the canonical content model and existing requirements.

Unsupported block types must not crash an otherwise valid document by default. Record their type and location, and apply a documented skip policy. Do not silently classify malformed supported blocks as unsupported.

Tables, code blocks, images, files, bookmarks, and callouts are excluded from full content parsing in this iteration.

## 5. Architecture and responsibilities

### 5.1 Notion client

**Responsibility:** HTTP communication with the Notion API.

Inputs include page IDs, block IDs, pagination cursors, and request parameters.

Outputs are raw or provider-typed API responses.

The client must not perform recursive traversal, interpret document content, normalize domain entities, or access application persistence directly.

### 5.2 Notion adapter

**Responsibility:** Retrieve and reconstruct the source document's block hierarchy.

The adapter coordinates the client to:

1. Fetch page metadata.
2. Fetch top-level blocks.
3. Exhaust pagination for each block collection.
4. Recursively retrieve children for blocks with children.
5. Preserve source block identity, type, order, and parent-child relationships.
6. Return a complete source representation or an explicit incomplete-retrieval result.

Pagination and recursive traversal must be treated as separate responsibilities.

The adapter must not convert source blocks into canonical domain types or generate embeddings.

### 5.3 Notion parser

**Responsibility:** Interpret Notion-specific block structures.

The parser receives the retrieved block tree and returns structured, provider-neutral content.

It must:
- Extract readable rich text.
- Preserve content order.
- Preserve heading levels and list semantics.
- Preserve nested list and toggle relationships.
- Preserve task completion state.
- Apply explicit behavior for unsupported and malformed blocks.

The parser must not make HTTP calls or write to persistence.

### 5.4 Canonical normalizer

**Responsibility:** Map parsed content and source metadata into the existing canonical document contract.

It must:
- Map the Notion page ID to the external source identifier.
- Map title, source URL, and supported timestamps.
- Preserve tenant and source identity.
- Convert parsed blocks into supported canonical content types.
- Validate required fields and document invariants.

The normalizer must not contain Notion HTTP logic or depend on Notion-specific response shapes.

Reuse existing domain models and validation utilities wherever appropriate. Do not create duplicate canonical schemas.

## 6. Canonical document requirements

The output must conform to the existing canonical document schema.

At minimum, the resulting document must retain:

- Internal document identity, if required by the existing model.
- Tenant identity.
- Source type and external page identifier.
- Source URL, when available.
- Document title.
- Structured content blocks.
- Supported source timestamps and metadata.
- Content hash, if already part of the canonical contract.

Do not introduce new database entities or migrations solely to satisfy this PRD.

If the existing canonical schema cannot represent a required structure, document the gap and propose the smallest compatible change before implementing it.

The canonical model must not depend on Notion's raw response format.

## 7. Retrieval safeguards and failure handling

Recursive retrieval must be bounded and observable.

**Required safeguards**
- Configurable maximum nesting depth.
- Configurable maximum API-request budget per document retrieval.
- Complete pagination within the configured budget.
- Bounded retries with backoff for transient failures and rate limits.
- Request timeout and cancellation support where compatible with existing project conventions.
- Explicit reporting of retrieval completeness.

**Failure behavior**

| Failure | Expected behavior |
|---|---|
| Invalid credentials or access denied | Return a classified, non-retryable error unless the existing authentication layer specifies otherwise |
| Transient API error | Retry within configured limits |
| Rate limit | Respect provider retry guidance and remain within the overall budget |
| Pagination failure | Mark retrieval incomplete |
| Nested child retrieval failure | Identify the affected block and mark retrieval incomplete |
| Traversal limit reached | Return an explicit limit-exceeded outcome |
| Unsupported block | Record and skip according to policy |
| Malformed supported block | Record a parsing error with source block context |
| Invalid canonical document | Reject normalization with validation details |

An incomplete source tree must never be represented as a fully retrieved document. Retain useful diagnostics for troubleshooting, but do not add a new persistence or retry workflow within this feature.

## 8. Acceptance criteria

The feature is complete when all of the following are satisfied:

- [ ] A Notion page's metadata and top-level blocks can be retrieved through the connector.
- [ ] Pagination retrieves all available blocks within configured limits.
- [ ] Nested blocks are retrieved recursively while respecting depth and request budgets.
- [ ] Block order and parent-child relationships are preserved.
- [ ] All eight supported block types are mapped according to the defined requirements.
- [ ] Rich-text content is extracted without reordering its text elements.
- [ ] Unsupported blocks follow an explicit policy and do not silently disappear from diagnostics.
- [ ] Retrieval failures and traversal limits produce explicit incomplete outcomes.
- [ ] The normalizer produces a valid document conforming to the existing canonical contract.
- [ ] No Notion-specific response types leak into the shared canonical model.
- [ ] Unit tests run without requiring a live Notion API connection.
- [ ] Existing ingestion and downstream processing behavior remains unchanged.

## 9. Testing strategy

Prioritize behavior at component boundaries.

**Client tests**
- Successful responses.
- Authentication and permission errors.
- Rate limiting, transient failures, and timeouts.

**Adapter tests**
- Multiple pages of results.
- Nested toggles and nested list items.
- Empty child collections.
- Depth and request limits.
- Failure in a nested branch.
- Correct ordering and completeness reporting.

**Parser tests**
- Each supported block type.
- Rich-text extraction.
- Nested structures and task state.
- Unsupported blocks.
- Malformed supported blocks.

**Normalizer tests**
- Correct source and tenant metadata.
- Correct mapping of timestamps and title.
- Valid canonical content.
- Missing required fields and invalid structures.

**Contract tests**
- Representative Notion fixtures produce canonical documents matching the existing schema.
- Changes to the Notion response format do not require changes to downstream consumers when the canonical contract remains unchanged.

Use fixtures for deterministic tests. Live API tests, if needed, should be limited to a separate, explicitly configured integration-test suite.

## 10. Implementation sequence

1. **Inspect existing conventions:** Locate the canonical schema, source metadata model, validation utilities, HTTP client conventions, and existing error-handling patterns.
2. **Confirm contracts:** Define the adapter result, retrieved block tree, parser output, and normalization boundary before implementing behavior.
3. **Implement the client:** Add only the API operations required for page and block retrieval.
4. **Implement the adapter:** Add pagination, recursive traversal, request budgets, and completeness reporting.
5. **Implement the parser:** Support the eight specified block types and structured nested content.
6. **Implement the normalizer:** Map parsed content into the existing canonical schema.
7. **Add tests:** Verify individual responsibilities, error cases, and end-to-end connector behavior using fixtures.
8. **Review scope:** Confirm that no ingestion, persistence, embedding, indexing, or unrelated modules were modified.

## 11. AI-assisted development constraints

The AI coding agent must follow these rules:

- Inspect the existing repository and relevant domain models before proposing new abstractions.
- Follow established naming, module, dependency-injection, and testing conventions.
- Prefer explicit interfaces and small components over unnecessary inheritance or generic frameworks.
- Do not invent canonical fields or duplicate existing models.
- Do not implement unsupported Notion block types in this iteration.
- Do not change ingestion orchestration, queues, persistence, chunking, embeddings, or indexing.
- Do not refactor unrelated modules.
- Add dependencies only when existing project capabilities are insufficient and the need is justified.
- Do not silently swallow API, retrieval, parsing, or validation errors.
- Keep the implementation testable without network access.
- If an existing schema or architectural constraint conflicts with this PRD, explain the conflict and propose the smallest change before proceeding.

Implement in small, reviewable stages. After each stage, run the relevant tests and report changed files, verified behavior, and unresolved limitations.

## 12. Definition of done

The Notion connector can retrieve and reconstruct supported page content within explicit limits, parse it into structured provider-neutral content, and normalize it into the existing canonical document model.

The feature is independently testable, reports incomplete retrieval accurately, respects the agreed scope, and introduces no changes to the existing ingestion pipeline or downstream processing.