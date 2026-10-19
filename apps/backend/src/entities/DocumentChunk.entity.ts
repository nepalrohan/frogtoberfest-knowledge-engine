import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  type IndexOptions,
} from 'typeorm';
import { Document } from './Document.entity';

/* Vector column width; must equal the configured embedding model's output dimension */
export const EMBEDDING_VECTOR_DIMENSION = 768;

/* Stores chunked document segments and vector embeddings */
@Entity('document_chunk')
@Index(['documentId', 'documentVersion'])
@Index(['documentId', 'chunkIndex'])
/* HNSW cosine index is created by migration; synchronize:false stops TypeORM from dropping it.
   TypeORM honours the flag at runtime but omits it from IndexOptions typings, hence the cast. */
@Index('idx_chunk_embedding_hnsw', ['embedding'], {
  synchronize: false,
} as IndexOptions)
export class DocumentChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'chunk_index', type: 'integer' })
  chunkIndex: number;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion: number;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({
    name: 'embedding',
    type: 'vector',
    length: EMBEDDING_VECTOR_DIMENSION,
  })
  embedding: number[];

  /* Model that produced the vector; retrieval only compares vectors from the same model */
  @Column({ name: 'embedding_model', type: 'varchar', length: 128 })
  embeddingModel: string;

  /* Full-text search vector maintained by PostgreSQL for hybrid keyword retrieval */
  @Index('idx_chunk_search_vector', { type: 'gin' })
  @Column({
    name: 'search_vector',
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: `to_tsvector('english', "content")`,
    select: false,
    insert: false,
    update: false,
  })
  searchVector?: string;

  @Column({ name: 'token_count', type: 'integer', default: 0 })
  tokenCount: number;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Document, (doc) => doc.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document?: Document;
}
