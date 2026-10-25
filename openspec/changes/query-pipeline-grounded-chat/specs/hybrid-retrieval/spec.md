## Purpose

Finds the most relevant indexed document chunks for a question by combining semantic vector search with keyword search, and decides whether the knowledge base holds enough evidence to answer.

## ADDED Requirements

### Requirement: Question embedding with the indexing model
The system SHALL embed the question as a query (not a document) using the same embedding model that produced the stored chunk vectors.

#### Scenario: Query prefix applied
- **WHEN** the configured model is `nomic-embed-text`
- **THEN** the question is embedded with the `search_query:` task prefix

### Requirement: Only current, live, same-model chunks are searchable
Retrieval SHALL consider only chunks whose document is not deleted, whose document `sync_status` is `indexed`, whose `document_version` equals the document's current version, and whose `embedding_model` equals the active embedding model.

#### Scenario: Deleted document is never retrieved
- **WHEN** a document is tombstoned
- **THEN** none of its chunks appear in retrieval results

#### Scenario: Chunks from another embedding model are ignored
- **WHEN** some chunks were embedded by a different model than the one now configured
- **THEN** those chunks are excluded from vector and keyword results

### Requirement: Hybrid ranking with Reciprocal Rank Fusion
The system SHALL take the top 20 candidates by cosine similarity and the top 20 by full-text rank, merge them by chunk, and order them by Reciprocal Rank Fusion score `1/(60 + vector_rank) + 1/(60 + keyword_rank)`, where a missing rank contributes 0.

#### Scenario: Exact identifier found by keyword search
- **WHEN** a question contains an exact error code that appears verbatim in one chunk but is semantically distant
- **THEN** that chunk appears in the fused candidates

### Requirement: Relevance gate and insufficient evidence
The system SHALL treat the knowledge base as lacking evidence when no candidate has cosine similarity of at least 0.65, and SHALL then skip generation and refuse with reason `insufficient_evidence`.

#### Scenario: Unrelated question
- **WHEN** a question's best candidate has cosine similarity 0.42
- **THEN** no language model call is made and the answer is refused with reason `insufficient_evidence`

### Requirement: Context selection within budget
The system SHALL select up to 5 chunks for the prompt from the fused ranking, keep at most 2 chunks from any one document, drop chunks whose text duplicates an already selected chunk, and stop before the selected text exceeds the configured context token budget. Selected chunks SHALL be numbered from 1 in ranking order as Source 1..N.

#### Scenario: One document dominates the ranking
- **WHEN** the top 6 candidates all come from the same document
- **THEN** at most 2 of them are selected and the remaining slots go to other documents

### Requirement: Retrieval observability
Each retrieval SHALL log the number of candidates, the selected chunk ids and the best similarity, using the retrieval completed or no-evidence log events, and SHALL report candidate count in the run details.

#### Scenario: No-evidence retrieval is logged
- **WHEN** the relevance gate rejects all candidates
- **THEN** a retrieval no-evidence log entry with the trace id and best similarity is written
