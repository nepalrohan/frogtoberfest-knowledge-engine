import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ConnectorConnectionEntity } from './connector-connection.entity';
import type { ErrorCategory } from '../../../common/resilience/error-classifier';

/* Lifecycle states for tracked external resources */
export enum ConnectorSyncItemStatus {
  PENDING = 'PENDING',
  SYNCING = 'SYNCING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DESELECTED = 'DESELECTED',
}

/* Last failure recorded against a sync item */
export interface SyncItemError {
  message: string;
  category: ErrorCategory;
  timestamp: string;
}

/* Durable entity tracking the synchronization state of a single selected external resource */
@Entity('connector_sync_items')
@Index('idx_connector_sync_items_connection_resource', ['connectionId', 'externalResourceId'], {
  unique: true,
})
@Index('idx_connector_sync_items_status_next_attempt', ['status', 'nextAttemptAt'])
export class ConnectorSyncItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId: string;

  @ManyToOne(() => ConnectorConnectionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection?: ConnectorConnectionEntity;

  @Column({ name: 'external_resource_id', type: 'varchar', length: 255 })
  externalResourceId: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 50, default: 'page' })
  resourceType: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: ConnectorSyncItemStatus.PENDING,
  })
  status: ConnectorSyncItemStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({
    name: 'last_observed_revision',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  lastObservedRevision: string | null;

  @Column({
    name: 'last_processed_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastProcessedFingerprint: string | null;

  @Column({ name: 'last_error', type: 'jsonb', nullable: true })
  lastError: SyncItemError | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
