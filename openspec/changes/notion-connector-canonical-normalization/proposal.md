## Why

To ingest enterprise knowledge from Notion into the Knowledge Engine, raw and nested Notion API responses must be retrieved reliably and standardized into a provider-neutral canonical format compatible with PostgreSQL storage, vector chunking, and downstream RAG pipelines. Standardizing Notion external responses now establishes a decoupled connector and canonical document contract that future connectors (such as Confluence) can leverage without impacting downstream indexing.

## What Changes

- Add a resilient Notion HTTP client implementing authentication (`Notion-Version`, Bearer token), OpenTelemetry tracing (`AppTracer`), structured logging (`StructuredLogger` with `LogEvents`), and resilience mechanisms (`CircuitBreaker`, `RetryPolicy`, `ErrorClassifier`).
- Add a Notion adapter that orchestrates page metadata retrieval and paginated, recursive block tree reconstruction bounded by configurable depth and request budgets, providing explicit retrieval completeness diagnostics.
- Add an AST-based Notion parser that extracts ordered rich text, preserves hierarchy for the 8 supported block types (`heading_1`, `heading_2`, `heading_3`, `paragraph`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`), and handles unsupported or malformed blocks explicitly.
- Add a canonical document normalizer that transforms parsed block content into standard GitHub Flavored Markdown (GFM) with frontmatter, computes SHA-256 content hashes, and outputs strongly-typed `NormalizedDocumentPayload` records matching the storage schema.
- Add comprehensive offline fixture-based unit and contract test suites verifying the client, adapter traversal, parser, and normalizer components.

## Capabilities

### New Capabilities
- `notion-connector`: Resilient Notion API client and recursive block tree retrieval adapter with pagination, depth/request safeguards, and completeness diagnostics.
- `canonical-normalization`: Structured parsing of external Notion block responses and canonical normalization into provider-neutral GFM Markdown and `NormalizedDocumentPayload` conforming to the database schema.

### Modified Capabilities

## Impact

- **Backend Architecture**: Introduces `apps/backend/src/modules/ingestion` with submodules for connectors (`connectors/notion`) and normalization (`normalizers/notion`, `normalizers/canonical`).
- **Telemetry & Resilience**: Integrates existing `StructuredLogger`, `LogEvents`, `AppTracer`, `CircuitBreaker`, `RetryPolicy`, and `ErrorClassifier` from `common/`.
- **Database & Downstream Compatibility**: Output matches `NormalizedDocumentPayload` and PostgreSQL `document` table specification (`title`, `source_type`, `source_id`, `source_url`, `normalized_content`, `content_hash`, `source_updated_at`, `metadata`) without requiring database migrations or queue modifications.
- **Dependencies**: No heavy external dependencies required; utilizes standard HTTP client utilities and Node.js built-in crypto (`crypto.createHash`).
