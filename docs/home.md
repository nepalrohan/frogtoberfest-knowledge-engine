# Knowledge Engine — Engineering Documentation

Welcome to the internal engineering documentation for the **Knowledge Engine (KE)**. This vault outlines the architecture, data contracts, job reliability patterns, model constraints, and implementation plan for our internal knowledge assistant.

---

## 🎯 Executive Summary & Scope

KE is an internal knowledge assistant that ingests documentation from **Notion** and **Confluence**, normalizes and indexes it using **open-source embedding models**, and delivers grounded answers with verifiable source citations via a **local LLM**.

```
                 ┌────────────────────────────────────────────────┐
                 │             Knowledge Engine (KE)              │
                 └────────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                 ▼                                 ▼
┌───────────────────┐           ┌───────────────────┐           ┌───────────────────┐
│ Ingestion & Sync  │           │ Chunk & Vector DB │           │ Stateful RAG Chat │
│ Notion/Confluence │  ──────>  │ pgvector + BullMQ │  ──────>  │ Local OSS LLM     │
│ Connectors        │           │ Outbox Processing │           │ Grounded Citations│
└───────────────────┘           └───────────────────┘           └───────────────────┘
```

### Core MVP Constraints & Environment
- **Runtime & Deployment**: Docker Compose (`Node.js 20+ TypeScript`, `PostgreSQL 16 + pgvector`, `Redis 7 + BullMQ`, `TypeORM`, `Ollama`).
- **Architecture**: Modular Monolith with transactional outbox pattern to decouple ingestion, indexing, and chat orchestration.
- **Data Access Layer**: TypeORM with PostgreSQL connection pooling, migrations, and transactional query runners.

### Key Non-Goals (MVP Scope Boundaries)
- ❌ **No Microservices or Kubernetes**: No distributed gRPC or service meshes; single deployable Node.js container with internal modular boundaries.
- ❌ **No Autonomous Agents**: No multi-step agentic planning or autonomous write-back actions to external platforms.
- ❌ **No Kafka / Distributed Sagas**: BullMQ + Redis + PostgreSQL Outbox handles asynchronous work.
- ❌ **No Multi-Tenant Isolation**: Single organization internal workspace.

---

## 📚 Documentation Index

| Document | Focus & Key Contents |
| :--- | :--- |
| **[[architecture]]** | Modular monolith design, end-to-end request/event flows, component boundaries, and key technical decisions. |
| **[[data-model]]** | PostgreSQL DDL, TypeORM entity definitions, relational integrity, document versioning, `pgvector` indexing, and conversation state. |
| **[[ingestion-and-sync]]** | Connector contracts, pagination, incremental sync (cursors/hashes), Markdown normalization, and deletion tombstoning. |
| **[[jobs-and-reliability]]** | BullMQ queues, transactional outbox relays, idempotency keys, duplicate delivery guards, and crash recovery. |
| **[[retrieval-and-citations]]** | Hybrid vector/keyword retrieval, cross-chunk context reconstruction, prompt assembly, strict citation formatting, and fallback handling. |
| **[[security]]** | Connector credential isolation, prompt injection defenses, and local data privacy boundaries. |
| **[[observability-and-testing]]** | Correlation IDs, structured JSON logging, RAG triad metrics, synthetic eval dataset, and integration tests. |
| **[[implementation-plan]]** | Implementation schedule, shared TypeScript interfaces, dependency graph, acceptance criteria, and risk matrix. |
