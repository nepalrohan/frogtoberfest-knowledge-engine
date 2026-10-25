import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { AppConfigService } from '../../config/configuration';
import { StructuredLogger } from '../../common/logger';
import {
  ConnectorPersistenceService,
  CredentialEncryptionService,
  ConnectorConnectionStatus,
} from '../connector-persistence';

export interface NotionConnectionRecord {
  id: string;
  provider: 'notion';
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  credential_ref: string;
  connected_by: string;
  status: 'connected' | 'disconnected';
  selected_page_ids: string[];
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

/* Service responsible for AES-256-GCM encryption and delegating to durable connector persistence */
@Injectable()
export class ConnectionStorageService {
  private readonly logger = new StructuredLogger('ConnectionStorageService');
  private connection: NotionConnectionRecord | null = null;

  constructor(
    private readonly configService: AppConfigService,
    @Optional()
    private readonly persistenceService?: ConnectorPersistenceService,
    @Optional()
    private readonly encryptionService?: CredentialEncryptionService,
  ) { }

  /* Derives a consistent 32-byte key from the configured encryption secret */
  private getEncryptionKey(): Buffer {
    const secret = this.configService.encryptionSecret;
    return crypto.createHash('sha256').update(secret).digest();
  }

  /* Encrypts plaintext access tokens using AES-256-GCM with a random 12-byte IV */
  encryptToken(plainToken: string): string {
    if (this.encryptionService) {
      return this.encryptionService.encrypt(plainToken).payload;
    }

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

    if (this.encryptionService) {
      return this.encryptionService.decrypt(encryptedRef);
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
  async saveConnection(
    input: SaveConnectionInput,
  ): Promise<NotionConnectionRecord> {
    const encryptedRef = this.encryptToken(input.accessToken);
    const now = new Date();

    if (this.persistenceService) {
      const existingPages = this.connection?.selected_page_ids || [];
      const safeConn = await this.persistenceService.saveConnection({
        provider: 'notion',
        externalAccountId: input.workspaceId,
        externalAccountName: input.workspaceName,
        connectedByUserId: input.connectedBy,
        credentialPayload: { accessToken: input.accessToken },
        metadata: {
          workspaceIcon: input.workspaceIcon,
          selectedPageIds: existingPages,
          encryptedRef,
        },
      });

      this.connection = {
        id: safeConn.id,
        provider: 'notion',
        workspace_id: safeConn.externalAccountId,
        workspace_name: safeConn.externalAccountName || '',
        workspace_icon: (safeConn.metadata as any)?.workspaceIcon || null,
        credential_ref: encryptedRef,
        connected_by: safeConn.connectedByUserId,
        status:
          safeConn.status === ConnectorConnectionStatus.CONNECTED
            ? 'connected'
            : 'disconnected',
        selected_page_ids:
          (safeConn.metadata as any)?.selectedPageIds || existingPages,
        created_at: safeConn.connectedAt,
        updated_at: safeConn.connectedAt,
      };

      return { ...this.connection };
    }

    /* In-memory fallback */
    if (this.connection && this.connection.provider === 'notion') {
      this.connection = {
        ...this.connection,
        workspace_id: input.workspaceId,
        workspace_name: input.workspaceName,
        workspace_icon: input.workspaceIcon,
        credential_ref: encryptedRef,
        connected_by: input.connectedBy,
        status: 'connected',
        selected_page_ids: this.connection.selected_page_ids ?? [],
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
      selected_page_ids: [],
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

  /* Saves the user-selected Notion page IDs to sync */
  async saveSelectedPages(
    provider: 'notion' = 'notion',
    pageIds: string[],
  ): Promise<string[]> {
    if (this.persistenceService) {
      const pages = await this.persistenceService.saveSelectedPages(
        provider,
        pageIds,
      );
      if (this.connection) {
        this.connection.selected_page_ids = pages;
        this.connection.updated_at = new Date();
      }
      return pages;
    }

    if (!this.connection || this.connection.provider !== provider) {
      throw new Error(`Cannot save pages: ${provider} connection does not exist`);
    }

    this.connection = {
      ...this.connection,
      selected_page_ids: Array.from(new Set(pageIds)),
      updated_at: new Date(),
    };

    this.logger.log('Updated selected pages for integration', {
      provider,
      selectedCount: this.connection.selected_page_ids.length,
    });

    return [...this.connection.selected_page_ids];
  }

  /* Retrieves the user-selected page IDs for the active integration */
  async getSelectedPages(provider: 'notion' = 'notion'): Promise<string[]> {
    if (this.persistenceService) {
      return this.persistenceService.getSelectedPages(provider);
    }

    if (
      !this.connection ||
      this.connection.provider !== provider ||
      this.connection.status !== 'connected'
    ) {
      return [];
    }
    return [...(this.connection.selected_page_ids ?? [])];
  }

  /* Retrieves the active connection record without decrypted credentials */
  async getConnection(
    provider: 'notion' = 'notion',
  ): Promise<NotionConnectionRecord | null> {
    if (this.persistenceService) {
      const safeConn = await this.persistenceService.getConnection(provider);
      if (!safeConn) {
        return null;
      }

      return {
        id: safeConn.id,
        provider: 'notion',
        workspace_id: safeConn.externalAccountId,
        workspace_name: safeConn.externalAccountName || '',
        workspace_icon: (safeConn.metadata as any)?.workspaceIcon || null,
        credential_ref:
          this.connection?.credential_ref ||
          (safeConn.metadata as any)?.encryptedRef ||
          this.encryptToken('persisted_token'),
        connected_by: safeConn.connectedByUserId,
        status:
          safeConn.status === ConnectorConnectionStatus.CONNECTED
            ? 'connected'
            : 'disconnected',
        selected_page_ids:
          (safeConn.metadata as any)?.selectedPageIds || [],
        created_at: safeConn.connectedAt,
        updated_at: safeConn.connectedAt,
      };
    }

    if (!this.connection || this.connection.provider !== provider) {
      return null;
    }
    return { ...this.connection };
  }

  /* Retrieves and decrypts the access token for the active provider connection */
  async getDecryptedToken(
    provider: 'notion' = 'notion',
  ): Promise<string | null> {
    if (this.persistenceService) {
      const token = await this.persistenceService.getDecryptedToken(provider);
      if (token) {
        return token;
      }
    }

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
    if (this.persistenceService) {
      await this.persistenceService.disconnect(provider);
    }

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
    if (typeof (global as any).__clearMockEntityStores === 'function') {
      (global as any).__clearMockEntityStores();
    }
  }
}
