# Implementation Roadmap, Interface Contracts & Risk Matrix

This document defines shared TypeScript and TypeORM interfaces, the sequential milestone roadmap, and a comprehensive risk mitigation matrix for the Knowledge Engine.

---

## 🤝 Shared Type & Contract Definitions

The following shared types and DTOs in `src/shared/types/index.ts` govern data transfer across modules:

```typescript
// ==========================================
// 1. INGESTION <-> INDEXING CONTRACT
// ==========================================
export interface EmbeddingJobPayload {
  documentId: string;
  documentVersion: number;
  sourceType: 'notion' | 'confluence';
  title: string;
}

export interface NormalizedDocumentPayload {
  sourceType: 'notion' | 'confluence';
  sourceId: string;
  sourceUrl: string;
  title: string;
  rawContent: string;
  normalizedContent: string;
  contentHash: string;
  sourceUpdatedAt: Date;
  metadata: {
    spaceKey?: string;
    parentHierarchy: string[];
    author?: string;
    tags?: string[];
  };
}

// ==========================================
// 2. INDEXING <-> RETRIEVAL CONTRACT
// ==========================================
export interface ChunkSearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  sourceUrl: string;
  content: string;
  cosineSimilarity: number;
  rrfScore: number;
  metadata: Record<string, any>;
}

export interface IVectorStore {
  searchHybrid(queryText: string, queryVector: number[], topK: number): Promise<ChunkSearchResult[]>;
}

// ==========================================
// 3. CONVERSATION & CHAT API CONTRACT
// ==========================================
export interface ChatRequestDTO {
  conversationId?: string;
  message: string;
  userId?: string;
}

export interface CitationItem {
  sourceIndex: number;
  documentId: string;
  title: string;
  sourceUrl: string;
  snippet: string;
}

export interface ChatResponseDTO {
  conversationId: string;
  messageId: string;
  role: 'assistant';
  content: string;
  citations: CitationItem[];
  metadata: {
    model: string;
    latencyMs: number;
    chunksRetrieved: number;
  };
}
```

---

## 📅 Milestone Execution Roadmap

```
Milestone 1 ──► Contracts, Docker Compose & TypeORM Schema Migrations
Milestone 2 ──► Vertical Slice (Mock Markdown -> Local Embedding -> Local LLM RAG)
Milestone 3 ──► Real Notion/Confluence Connectors & BullMQ Chunking Workers
Milestone 4 ──► Hybrid Retrieval (Vector + BM25) & Citation Validation
Milestone 5 ──► Transactional Outbox Poller, Retries, Deletions & Tombstones
Milestone 6 ──► Full E2E Benchmark Suite (test:eval) & Demo Hardening
```

### Milestone Breakdown & Acceptance Criteria

| Milestone | Core Deliverables | Acceptance Criteria |
| :--- | :--- | :--- |
| **M1: Baseline & Contracts** | - Setup Docker Compose (`PostgreSQL 16 + pgvector`, `Redis 7`, `Ollama`).<br>- Initialize TypeORM DataSource and entity schema migrations.<br>- Define shared DTOs and queue payloads. | `docker compose up` starts DB, Redis, and Ollama; TypeORM migrations execute cleanly. |
| **M2: Vertical Slice** | - Seed sample Markdown documents into PostgreSQL.<br>- Implement single-turn `/api/v1/chat` endpoint.<br>- Wire up local Ollama embeddings and generation. | Submitting a test question via API returns a grounded response with `[Source 1]`. |
| **M3: Connectors & Queues** | - Implement Notion API search & block tree traversal.<br>- Implement Confluence v2 REST connector.<br>- Build GFM Markdown normalizer.<br>- Configure BullMQ `embedding-queue`. | Real workspace pages are ingested, normalized, and enqueued in Redis automatically. |
| **M4: RAG Core & Citations** | - Implement hybrid retrieval SQL query in TypeORM.<br>- Build sliding-window conversation history (last 6 messages).<br>- Implement `CitationGuard` regex validator. | Multi-turn chat maintains recent conversation context and rejects ungrounded claims. |
| **M5: Resilience & Tombstones** | - Implement transactional outbox poller (`FOR UPDATE SKIP LOCKED`).<br>- Add version-check guard in embedding worker to prevent stale overwrites.<br>- Handle connector deletions and chunk purging. | Deleting a page in Notion removes its chunks from PostgreSQL within 1 sync cycle. |
| **M6: E2E Benchmarking & Polish** | - Run 15-question synthetic evaluation benchmark (`pnpm test:eval`).<br>- Verify HNSW index recall and query latency.<br>- Document local setup and known limitations. | Benchmark achieves $\ge 90\%$ Recall@5 and zero hallucinated citations on unanswerable questions. |

---

## ⚠️ Comprehensive Risk & Tradeoff Matrix

| Risk Area | Failure Scenario | Impact | MVP Mitigation | Post-MVP Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Stale Content Overwrite** | Embedding worker for old v1 completes after v2 was written. | Search index serves outdated information. | Compare `doc.version` against `job.version` inside a locked TypeORM transaction before saving chunks. | Event sourcing / global write ledger. |
| **Connector Rate Limits** | Notion returns HTTP 429 Too Many Requests. | Ingestion job crashes halfway through space sync. | Exponential backoff with jitter and respect `Retry-After` header. | Distributed token bucket rate limiter. |
| **Worker Crash Mid-Task** | Node process killed while embedding 50 chunks. | Unfinished chunks left in database or job lost. | BullMQ automatic lock timeout (30s) + atomic chunk table replacement in a single transaction. | Distributed checkpointing & partial resume. |
| **Dual-Write Inconsistency** | DB write succeeds, but Redis crashes before BullMQ enqueue. | Document stuck in `pending_embedding` forever. | **Transactional Outbox Table**: Event committed in PostgreSQL; poller retries until published. | Debezium CDC from PostgreSQL Write-Ahead Log (WAL). |
| **Hallucinated Citations** | LLM generates `[Source 9]` when only 5 chunks were provided. | False attribution undermines user trust. | `CitationGuard` parses all `[Source N]` tags and strips unverified citations or forces fallback. | Fine-tuned citation head / logit masking. |
| **Insufficient Evidence** | User asks a question not covered in Notion/Confluence. | Model invents plausible-sounding answer. | Hard cosine threshold ($\ge 0.65$) + strict system prompt with mandatory fallback phrase. | Reranker cross-encoder score threshold. |
| **Local Compute Bottleneck** | Local 7B model generation takes 20+ seconds on CPU. | Degraded user experience during demo. | Use 4-bit quantized models (`qwen2.5:7b-instruct-q4_K_M`) and limit batch concurrency to 2. | Dedicated GPU server or vLLM cluster. |
| **Prompt Injection Attack** | Ingested Notion doc contains instructions to reveal system keys. | Malicious prompt leak. | Delimit source documents with `<source_document>` tags and explicit instruction hierarchy. | LLM guardrail classifier (e.g. Llama-Guard). |
