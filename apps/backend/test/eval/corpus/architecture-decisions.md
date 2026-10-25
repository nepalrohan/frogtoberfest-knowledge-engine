# Architecture Decision Records

## ADR-007: pgvector instead of a dedicated vector database
We store embeddings in PostgreSQL with the pgvector extension rather than running a separate vector database.
Reasons: chunks, documents and vectors stay in one transactional store, so a document update and its vectors can
never disagree; the team already operates PostgreSQL; and at our scale (under five million chunks) an HNSW index
answers queries in a few milliseconds. We will revisit if the corpus grows past twenty million chunks.

## ADR-009: Transactional outbox for indexing
Document writes insert an outbox row in the same transaction. A poller publishes rows to BullMQ, so a crash between
the write and the enqueue cannot lose an indexing job.
