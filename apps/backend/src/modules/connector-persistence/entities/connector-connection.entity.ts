import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { ConnectorConnectionStatus } from '../interfaces/connector-connection.interface';
import { ConnectorCredentialEntity } from './connector-credential.entity';

/* Durable entity representing an external connector connection */
@Entity('connector_connections')
@Index('idx_connector_connection_provider_status', ['provider', 'status'])
@Index('idx_connector_connection_provider_active', ['provider'], {
  unique: true,
  where: "status IN ('CONNECTED', 'REAUTH_REQUIRED')",
})
export class ConnectorConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  provider: string;

  @Column({
    type: 'varchar',
    length: 30,
    default: ConnectorConnectionStatus.CONNECTED,
  })
  status: ConnectorConnectionStatus;

  @Column({ name: 'external_account_id', type: 'varchar', length: 255 })
  externalAccountId: string;

  @Column({
    name: 'external_account_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  externalAccountName: string | null;

  @Column({
    name: 'connected_by_user_id',
    type: 'varchar',
    length: 100,
    default: 'admin-user',
  })
  connectedByUserId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({
    name: 'connected_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  connectedAt: Date;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  @Column({ name: 'disconnected_at', type: 'timestamptz', nullable: true })
  disconnectedAt: Date | null;

  @OneToOne(
    () => ConnectorCredentialEntity,
    (credential) => credential.connection,
    { cascade: true },
  )
  credential?: ConnectorCredentialEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
