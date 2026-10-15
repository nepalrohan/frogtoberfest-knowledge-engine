import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/* Tracks lifecycle, cursor progress, and metrics for asynchronous document ingestion jobs */
@Entity('ingestion_job')
@Index(['sourceType', 'status'])
export class IngestionJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_type', type: 'varchar', length: 50 })
  sourceType: string;

  @Column({
    name: 'trigger_type',
    type: 'varchar',
    length: 50,
    default: 'manual',
  })
  triggerType: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  status: string;

  @Column({ name: 'cursor_state', type: 'text', nullable: true })
  cursorState?: string;

  @Column({ name: 'items_discovered', type: 'integer', default: 0 })
  itemsDiscovered: number;

  @Column({ name: 'items_processed', type: 'integer', default: 0 })
  itemsProcessed: number;

  @Column({ name: 'items_failed', type: 'integer', default: 0 })
  itemsFailed: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
