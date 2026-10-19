import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/* One retrievable chunk with the signals used to rank and gate it */
export interface ChunkCandidate {
  chunkId: string;
  documentId: string;
  documentVersion: number;
  documentTitle: string;
  sourceType: string;
  sourceUrl?: string;
  content: string;
  sectionHeaders: string[];
  /* 1 - cosine distance to the query vector, computed for every candidate */
  cosineSimilarity: number;
  vectorRank: number | null;
  keywordRank: number | null;
  rrfScore: number;
}

export interface HybridSearchOptions {
  /* Candidates taken from each of the vector and keyword sides before fusion */
  candidateK: number;
  signal?: AbortSignal;
}

/* Reciprocal Rank Fusion constant from docs/retrieval-and-citations.md */
const RRF_K = 60;

/* A chunk is searchable only if its document is live, fully indexed, and it belongs to the current version and model */
const SEARCHABLE = `
  d.deleted_at IS NULL
  AND d.sync_status = 'indexed'
  AND c.document_version = d.version
  AND c.embedding_model = $3`;

const HYBRID_SQL = `
  WITH query_terms AS (
    /* OR of the question's stemmed lexemes: natural questions rarely contain every word of a passage */
    SELECT (
      SELECT string_agg(quote_literal(lexeme), ' | ')
      FROM unnest(tsvector_to_array(to_tsvector('english', $2))) AS t(lexeme)
    )::tsquery AS query
  ),
  vector_matches AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY distance)::int AS vector_rank
    FROM (
      /* Order + limit directly on the distance so the HNSW index drives the scan */
      SELECT c.id, c.embedding <=> $1::vector AS distance
      FROM document_chunk c
      JOIN document d ON d.id = c.document_id
      WHERE ${SEARCHABLE}
      ORDER BY distance
      LIMIT $4
    ) nearest
  ),
  keyword_matches AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY rank DESC, id)::int AS keyword_rank
    FROM (
      SELECT c.id, ts_rank_cd(c.search_vector, q.query) AS rank
      FROM document_chunk c
      JOIN document d ON d.id = c.document_id
      CROSS JOIN query_terms q
      WHERE ${SEARCHABLE}
        AND q.query IS NOT NULL
        AND c.search_vector @@ q.query
      ORDER BY rank DESC
      LIMIT $4
    ) matched
  ),
  fused AS (
    SELECT
      COALESCE(v.id, k.id) AS id,
      v.vector_rank,
      k.keyword_rank,
      (COALESCE(1.0 / (${RRF_K} + v.vector_rank), 0) + COALESCE(1.0 / (${RRF_K} + k.keyword_rank), 0))::float8 AS rrf_score
    FROM vector_matches v
    FULL OUTER JOIN keyword_matches k ON k.id = v.id
  )
  SELECT
    c.id AS chunk_id,
    c.document_id,
    c.document_version,
    d.title AS document_title,
    d.source_type,
    d.source_url,
    c.content,
    c.metadata,
    (1 - (c.embedding <=> $1::vector))::float8 AS cosine_similarity,
    f.vector_rank,
    f.keyword_rank,
    f.rrf_score
  FROM fused f
  JOIN document_chunk c ON c.id = f.id
  JOIN document d ON d.id = c.document_id
  ORDER BY f.rrf_score DESC, cosine_similarity DESC`;

interface HybridRow {
  chunk_id: string;
  document_id: string;
  document_version: number;
  document_title: string;
  source_type: string;
  source_url: string | null;
  content: string;
  metadata: { sectionHeaders?: string[] } | null;
  cosine_similarity: number;
  vector_rank: number | null;
  keyword_rank: number | null;
  rrf_score: number;
}

/* Read-side contract for retrieving indexed chunks; the conversation module queries chunks only through this */
@Injectable()
export class VectorStoreService {
  constructor(private readonly dataSource: DataSource) {}

  /* Vector (cosine, HNSW) and keyword (full-text) search fused with Reciprocal Rank Fusion */
  async searchHybrid(
    query: string,
    queryVector: number[],
    embeddingModel: string,
    { candidateK, signal }: HybridSearchOptions,
  ): Promise<ChunkCandidate[]> {
    signal?.throwIfAborted();
    const rows: HybridRow[] = await this.dataSource.transaction(async (manager) => {
      /* Transaction-local HNSW tuning: wider beam, and keep scanning when filters drop rows (pgvector >= 0.8) */
      await manager.query(
        `SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
        [String(Math.max(100, candidateK * 2))],
      );
      return manager.query(HYBRID_SQL, [`[${queryVector.join(',')}]`, query, embeddingModel, candidateK]);
    });
    signal?.throwIfAborted();

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentVersion: row.document_version,
      documentTitle: row.document_title,
      sourceType: row.source_type,
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      content: row.content,
      sectionHeaders: row.metadata?.sectionHeaders ?? [],
      cosineSimilarity: row.cosine_similarity,
      vectorRank: row.vector_rank,
      keywordRank: row.keyword_rank,
      rrfScore: row.rrf_score,
    }));
  }
}
