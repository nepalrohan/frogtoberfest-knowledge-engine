import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { DocumentChunk } from './DocumentChunk.entity';

/* Canonical document entity storing raw, normalized content, versioning, and lifecycle states */
@Entity('document')
@Index(['sourceType', 'sourceId'])
@Index(['contentHash'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_type', type: 'varchar', length: 50 })
  sourceType: string;

  @Column({ name: 'source_id', type: 'varchar', length: 255 })
  sourceId: string;

  @Column({ name: 'source_url', type: 'varchar', length: 1024, nullable: true })
  sourceUrl?: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'raw_content', type: 'text', nullable: true })
  rawContent?: string;

  @Column({ name: 'normalized_content', type: 'text' })
  normalizedContent: string;

  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash: string;

  @Column({ name: 'version', type: 'integer', default: 1 })
  version: number;

  @Column({
    name: 'sync_status',
    type: 'varchar',
    length: 50,
    default: 'pending_embedding',
  })
  syncStatus: string;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ name: 'source_updated_at', type: 'timestamptz', nullable: true })
  sourceUpdatedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  @OneToMany(() => DocumentChunk, (chunk) => chunk.document)
  chunks?: DocumentChunk[];
}
