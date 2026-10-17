## 1. Contracts, Shared Types & Test Fixtures

- [x] 1.1 Define domain contracts and interfaces (`KnowledgeConnector`, `RawSourceItem`, `NormalizedDocumentPayload`, `NeutralElement`, `NotionRetrievalResult`, `DiagnosticMessage`) in `apps/backend/src/modules/ingestion/types/` and verify typechecking passes with `pnpm --filter @my-project/backend check-types`.
- [x] 1.2 Create realistic offline test fixtures for Notion pages, paginated blocks, nested toggles/lists, unsupported blocks, and malformed blocks in `apps/backend/test/fixtures/notion/` and verify files are present and valid JSON.

## 2. Resilient Notion Client

- [x] 2.1 Write failing unit tests for `NotionClient` covering authentication headers, successful page/block fetching, 429 rate limit backoff via `RetryPolicy`, fast failure on 401/403 via `ErrorClassifier`, and circuit tripping via `CircuitBreaker` in `apps/backend/src/modules/ingestion/connectors/notion/notion.client.spec.ts`.
- [x] 2.2 Implement `NotionClient` in `apps/backend/src/modules/ingestion/connectors/notion/notion.client.ts` with `AppTracer.traceSpan`, `StructuredLogger`, and resilience integration, and verify all client unit tests pass with `pnpm --filter @my-project/backend test notion.client.spec.ts`.

## 3. Notion Traversal Adapter

- [x] 3.1 Write failing unit tests for `NotionAdapter` covering page metadata fetching, multi-page cursor pagination, recursive child block assembly, `maxDepth` cutoff, `maxRequests` budget cutoff, and completeness reporting in `apps/backend/src/modules/ingestion/connectors/notion/notion.adapter.spec.ts`.
- [x] 3.2 Implement `NotionAdapter` in `apps/backend/src/modules/ingestion/connectors/notion/notion.adapter.ts` with OpenTelemetry tracing and completeness diagnostics, and verify all adapter unit tests pass with `pnpm --filter @my-project/backend test notion.adapter.spec.ts`.

## 4. Provider-Neutral Notion Parser

- [x] 4.1 Write failing unit tests for `NotionParser` covering rich-text extraction with preserved ordering, mapping of the 8 supported block types (`heading_1`, `heading_2`, `heading_3`, `paragraph`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`), and explicit handling of unsupported and malformed blocks in `apps/backend/src/modules/ingestion/normalizers/notion/notion.parser.spec.ts`.
- [x] 4.2 Implement `NotionParser` in `apps/backend/src/modules/ingestion/normalizers/notion/notion.parser.ts` producing `NeutralElement[]` AST and structured diagnostics, and verify all parser unit tests pass with `pnpm --filter @my-project/backend test notion.parser.spec.ts`.

## 5. Canonical Document Normalizer

- [x] 5.1 Write failing unit tests for `CanonicalDocumentNormalizer` covering AST-to-GFM Markdown formatting, frontmatter header generation, SHA-256 content hashing, and schema validation of `NormalizedDocumentPayload` in `apps/backend/src/modules/ingestion/normalizers/canonical/canonical-document.normalizer.spec.ts`.
- [x] 5.2 Implement `CanonicalDocumentNormalizer` in `apps/backend/src/modules/ingestion/normalizers/canonical/canonical-document.normalizer.ts` with structured logging and schema validation, and verify all normalizer unit tests pass with `pnpm --filter @my-project/backend test canonical-document.normalizer.spec.ts`.

## 6. Module Integration and End-to-End Contract Verification

- [x] 6.1 Implement `NotionConnector` implementing `KnowledgeConnector` in `apps/backend/src/modules/ingestion/connectors/notion/notion.connector.ts` orchestrating client, adapter, parser, and normalizer.
- [x] 6.2 Deferred: IngestionModule registration and AppModule import omitted per user request.
- [x] 6.3 Implement end-to-end connector contract test in `apps/backend/test/connectors/notion-connector.spec.ts` asserting full pipeline normalization from raw Notion fixture to canonical storage payload, and verify entire backend test suite passes with `pnpm --filter @my-project/backend test`.
