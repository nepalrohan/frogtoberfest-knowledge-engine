import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Document } from './Document.entity';

/* Stores chunked document segments and vector embeddings */
@Entity('document_chunk')
@Index(['documentId', 'documentVersion'])
@Index(['documentId', 'chunkIndex'])
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

  /* Vector embedding formatted as array string, e.g. '[0.012, -0.045, ...]' */
  @Column({ name: 'embedding', type: 'text' })
  embedding: string;

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
