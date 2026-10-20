import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ConnectorAuthType } from '../interfaces/connector-connection.interface';
import { ConnectorConnectionEntity } from './connector-connection.entity';

/* Durable entity storing encrypted authentication credentials */
@Entity('connector_credentials')
export class ConnectorCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_connector_credentials_connection_id', { unique: true })
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId: string;

  @OneToOne(
    () => ConnectorConnectionEntity,
    (connection) => connection.credential,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'connection_id' })
  connection?: ConnectorConnectionEntity;

  @Column({
    name: 'auth_type',
    type: 'varchar',
    length: 30,
    default: ConnectorAuthType.OAUTH2,
  })
  authType: ConnectorAuthType;

  @Column({ name: 'encrypted_payload', type: 'text' })
  encryptedPayload: string;

  @Column({ name: 'encryption_key_version', type: 'integer', default: 1 })
  encryptionKeyVersion: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
