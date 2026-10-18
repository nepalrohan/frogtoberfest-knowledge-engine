import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { AppConfigService } from '../../config/configuration';
import { StructuredLogger } from '../../common/logger';

export interface NotionConnectionRecord {
  id: string;
  provider: 'notion';
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  credential_ref: string;
  connected_by: string;
  status: 'connected' | 'disconnected';
  created_at: Date;
  updated_at: Date;
}

export interface SaveConnectionInput {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  accessToken: string;
  connectedBy: string;
}

/* Service responsible for AES-256-GCM encryption of third-party credentials and managing single-tenant connection records */
@Injectable()
export class ConnectionStorageService {
  private readonly logger = new StructuredLogger('ConnectionStorageService');
  private connection: NotionConnectionRecord | null = null;

  constructor(private readonly configService: AppConfigService) {}

  /* Derives a consistent 32-byte key from the configured encryption secret */
  private getEncryptionKey(): Buffer {
    const secret = this.configService.encryptionSecret;
    return crypto.createHash('sha256').update(secret).digest();
  }

  /* Encrypts plaintext access tokens using AES-256-GCM with a random 12-byte IV */
  encryptToken(plainToken: string): string {
    const iv = crypto.randomBytes(12);
    const key = this.getEncryptionKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainToken, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    /* Format as iv.tag.ciphertext (hex-encoded) */
    return `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted.toString('hex')}`;
  }

  /* Decrypts an AES-256-GCM credential reference into the plaintext access token */
  decryptToken(encryptedRef: string): string {
    if (!encryptedRef) {
      throw new Error('Credential reference is empty');
    }

    /* Delimited by dot or colon */
    const parts = encryptedRef.includes('.')
      ? encryptedRef.split('.')
      : encryptedRef.split(':');

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error('Invalid credential reference format');
    }

    const ivHex = parts[0];
    const tagHex = parts[1];
    const cipherHex = parts[2];
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const encryptedText = Buffer.from(cipherHex, 'hex');
    const key = this.getEncryptionKey();

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /* Persists or updates the single-tenant Notion connection record with encrypted credentials */
  async saveConnection(input: SaveConnectionInput): Promise<NotionConnectionRecord> {
    const encryptedRef = this.encryptToken(input.accessToken);
    const now = new Date();

    if (this.connection && this.connection.provider === 'notion') {
      this.connection = {
        ...this.connection,
        workspace_id: input.workspaceId,
        workspace_name: input.workspaceName,
        workspace_icon: input.workspaceIcon,
        credential_ref: encryptedRef,
        connected_by: input.connectedBy,
        status: 'connected',
        updated_at: now,
      };

      this.logger.log('Updated existing Notion connection record', {
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        status: 'connected',
      });

      return { ...this.connection };
    }

    this.connection = {
      id: crypto.randomUUID(),
      provider: 'notion',
      workspace_id: input.workspaceId,
      workspace_name: input.workspaceName,
      workspace_icon: input.workspaceIcon,
      credential_ref: encryptedRef,
      connected_by: input.connectedBy,
      status: 'connected',
      created_at: now,
      updated_at: now,
    };

    this.logger.log('Created new Notion connection record', {
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      status: 'connected',
    });

    return { ...this.connection };
  }

  /* Retrieves the active connection record without decrypted credentials */
  async getConnection(
    provider: 'notion' = 'notion',
  ): Promise<NotionConnectionRecord | null> {
    if (!this.connection || this.connection.provider !== provider) {
      return null;
    }
    return { ...this.connection };
  }

  /* Retrieves and decrypts the access token for the active provider connection */
  async getDecryptedToken(
    provider: 'notion' = 'notion',
  ): Promise<string | null> {
    const conn = await this.getConnection(provider);
    if (!conn || conn.status !== 'connected' || !conn.credential_ref) {
      return null;
    }

    try {
      return this.decryptToken(conn.credential_ref);
    } catch (error) {
      this.logger.error('Failed to decrypt stored connection token', {
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /* Disconnects the active provider and marks status as disconnected */
  async disconnect(provider: 'notion' = 'notion'): Promise<void> {
    if (this.connection && this.connection.provider === provider) {
      this.connection = {
        ...this.connection,
        status: 'disconnected',
        credential_ref: '',
        updated_at: new Date(),
      };

      this.logger.log(`Disconnected ${provider} connection`, {
        provider,
        status: 'disconnected',
      });
    }
  }

  /* Clears the active connection record (primarily for tests) */
  async clearAll(): Promise<void> {
    this.connection = null;
  }
}
