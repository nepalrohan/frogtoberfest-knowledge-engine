import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ConnectorConnectionEntity } from './connector-connection.entity';
import type { SyncResourceJobPayload } from '../../queue/queue.constants';
import type { OutboxStatus } from '../../../common/outbox/outbox.types';

/* Durable entity storing transactional outbox events to guarantee reliable queue dispatch */
@Entity('connector_sync_outbox')
@Index('idx_connector_sync_outbox_pending', ['status', 'createdAt'])
/* Keeps relay claims cheap: only rows that can still be published are indexed */
@Index('idx_connector_sync_outbox_claimable', ['nextAttemptAt'], {
  where: `"status" IN ('pending', 'publishing')`,
})
export class ConnectorSyncOutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId: string;

  @ManyToOne(() => ConnectorConnectionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection?: ConnectorConnectionEntity;

  @Column({ name: 'external_resource_id', type: 'varchar', length: 255 })
  externalResourceId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50, default: 'SYNC_RESOURCE' })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: SyncResourceJobPayload;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: OutboxStatus;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
