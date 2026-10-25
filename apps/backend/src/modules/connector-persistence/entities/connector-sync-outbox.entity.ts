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

/* Durable entity storing transactional outbox events to guarantee reliable queue dispatch */
@Entity('connector_sync_outbox')
@Index('idx_connector_sync_outbox_pending', ['status', 'createdAt'])
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
  payload: Record<string, any>;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'published' | 'failed';

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
