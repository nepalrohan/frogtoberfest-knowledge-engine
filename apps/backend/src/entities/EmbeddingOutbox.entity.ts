import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/* Transactional outbox table storing document embedding events for reliable BullMQ relay */
@Entity('embedding_outbox')
@Index(['status', 'createdAt'])
@Index(['documentId', 'documentVersion'])
export class EmbeddingOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'document_version', type: 'integer' })
  documentVersion: number;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 100,
    default: 'DOCUMENT_READY_FOR_EMBEDDING',
  })
  eventType: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  status: string;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
