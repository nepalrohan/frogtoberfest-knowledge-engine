import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  ConnectorConnectionEntity,
  ConnectorCredentialEntity,
  ConnectorSyncItemEntity,
  ConnectorSyncItemStatus,
  ConnectorSyncOutboxEntity,
} from './entities';
import {
  ConnectorAuthType,
  ConnectorConnectionStatus,
  DecryptedCredentialPayload,
  SafeConnectorConnectionDto,
  SaveConnectionParams,
} from './interfaces/connector-connection.interface';
import { CredentialEncryptionService } from './credential-encryption.service';
import { TraceContextPropagator } from '../../common/telemetry';

/* Core persistence service managing durable connections, encrypted credentials, and multi-connector lifecycle */
@Injectable()
export class ConnectorPersistenceService {
  private readonly logger = new Logger(ConnectorPersistenceService.name);

  constructor(
    @InjectRepository(ConnectorConnectionEntity)
    private readonly connectionRepo: Repository<ConnectorConnectionEntity>,
    @InjectRepository(ConnectorCredentialEntity)
    private readonly credentialRepo: Repository<ConnectorCredentialEntity>,
    @InjectRepository(ConnectorSyncItemEntity)
    private readonly syncItemRepo: Repository<ConnectorSyncItemEntity>,
    @InjectRepository(ConnectorSyncOutboxEntity)
    private readonly outboxRepo: Repository<ConnectorSyncOutboxEntity>,
    private readonly encryptionService: CredentialEncryptionService,
    private readonly dataSource: DataSource,
  ) { }

  /* Maps an entity into a safe client-facing DTO without credential material */
  private toSafeDto(
    entity: ConnectorConnectionEntity,
  ): SafeConnectorConnectionDto {
    return {
      id: entity.id,
      provider: entity.provider,
      status: entity.status,
      externalAccountId: entity.externalAccountId,
      externalAccountName: entity.externalAccountName,
      connectedByUserId: entity.connectedByUserId,
      connectedAt: entity.connectedAt,
      lastVerifiedAt: entity.lastVerifiedAt,
      disconnectedAt: entity.disconnectedAt,
      metadata: entity.metadata ? { ...entity.metadata } : null,
    };
  }

  /* Retrieves the active connection record for a provider */
  async getConnection(
    provider: string,
  ): Promise<SafeConnectorConnectionDto | null> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: In([
          ConnectorConnectionStatus.CONNECTED,
          ConnectorConnectionStatus.REAUTH_REQUIRED,
        ]),
      },
      order: { connectedAt: 'DESC' },
    });

    if (!connection) {
      return null;
    }

    return this.toSafeDto(connection);
  }

  /* Lists all connector connections across all providers for multi-connector setups */
  async listConnections(): Promise<SafeConnectorConnectionDto[]> {
    const connections = await this.connectionRepo.find({
      order: { provider: 'ASC', connectedAt: 'DESC' },
    });

    return connections.map((conn) => this.toSafeDto(conn));
  }

  /* Retrieves and decrypts the access token for trusted provider communication */
  async getDecryptedToken(provider: string): Promise<string | null> {
    const payload = await this.getDecryptedPayload(provider);
    return payload ? payload.accessToken : null;
  }

  /* Retrieves and decrypts the full credential payload for trusted callers */
  async getDecryptedPayload(
    provider: string,
  ): Promise<DecryptedCredentialPayload | null> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: ConnectorConnectionStatus.CONNECTED,
      },
      relations: { credential: true },
      order: { connectedAt: 'DESC' },
    });

    if (!connection || !connection.credential?.encryptedPayload) {
      return null;
    }

    try {
      return this.encryptionService.decryptPayload<DecryptedCredentialPayload>(
        connection.credential.encryptedPayload,
        connection.credential.encryptionKeyVersion,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrypt credentials for provider ${provider}`,
      );
      return null;
    }
  }

  /* Atomically persists or updates connection metadata and encrypted credentials */
  async saveConnection(
    params: SaveConnectionParams,
  ): Promise<SafeConnectorConnectionDto> {
    const {
      provider,
      externalAccountId,
      externalAccountName,
      connectedByUserId = 'admin-user',
      authType = ConnectorAuthType.OAUTH2,
      credentialPayload,
      metadata = {},
      expiresAt = null,
    } = params;

    /* Encrypt credential payload before opening the database transaction */
    const { payload: encryptedPayload, keyVersion } =
      this.encryptionService.encryptPayload(credentialPayload);

    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      /* Find existing active connection for this provider */
      let connection = await manager.findOne(ConnectorConnectionEntity, {
        where: {
          provider,
          status: In([
            ConnectorConnectionStatus.CONNECTED,
            ConnectorConnectionStatus.REAUTH_REQUIRED,
          ]),
        },
        relations: { credential: true },
      });

      if (connection) {
        /* Preserve existing metadata properties while merging new ones */
        const mergedMetadata = {
          ...(connection.metadata || {}),
          ...metadata,
        };

        connection.externalAccountId = externalAccountId;
        connection.externalAccountName =
          externalAccountName ?? connection.externalAccountName;
        connection.connectedByUserId = connectedByUserId;
        connection.status = ConnectorConnectionStatus.CONNECTED;
        connection.metadata = mergedMetadata;
        connection.connectedAt = now;
        connection.disconnectedAt = null;
        connection.updatedAt = now;

        await manager.save(ConnectorConnectionEntity, connection);

        /* Update or create credential */
        if (connection.credential) {
          connection.credential.authType = authType;
          connection.credential.encryptedPayload = encryptedPayload;
          connection.credential.encryptionKeyVersion = keyVersion;
          connection.credential.expiresAt = expiresAt;
          connection.credential.updatedAt = now;
          await manager.save(
            ConnectorCredentialEntity,
            connection.credential,
          );
        } else {
          const newCredential = manager.create(ConnectorCredentialEntity, {
            connectionId: connection.id,
            authType,
            encryptedPayload,
            encryptionKeyVersion: keyVersion,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          });
          await manager.save(ConnectorCredentialEntity, newCredential);
        }

        this.logger.log(`Updated active connection for provider ${provider}`);
        return this.toSafeDto(connection);
      }

      /* Create new connection */
      const newConnection = manager.create(ConnectorConnectionEntity, {
        provider,
        status: ConnectorConnectionStatus.CONNECTED,
        externalAccountId,
        externalAccountName: externalAccountName ?? null,
        connectedByUserId,
        metadata,
        connectedAt: now,
        lastVerifiedAt: null,
        disconnectedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const savedConnection = await manager.save(
        ConnectorConnectionEntity,
        newConnection,
      );

      /* Create credential linked to connection */
      const newCredential = manager.create(ConnectorCredentialEntity, {
        connectionId: savedConnection.id,
        authType,
        encryptedPayload,
        encryptionKeyVersion: keyVersion,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      await manager.save(ConnectorCredentialEntity, newCredential);

      this.logger.log(`Created new connection for provider ${provider}`);
      return this.toSafeDto(savedConnection);
    });
  }

  /* Updates connection status (e.g. to REAUTH_REQUIRED upon 401) */
  async updateStatus(
    provider: string,
    status: ConnectorConnectionStatus,
  ): Promise<void> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: In([
          ConnectorConnectionStatus.CONNECTED,
          ConnectorConnectionStatus.REAUTH_REQUIRED,
        ]),
      },
    });

    if (connection) {
      connection.status = status;
      connection.updatedAt = new Date();
      await this.connectionRepo.save(connection);
      this.logger.log(`Updated connection status for ${provider} to ${status}`);
    }
  }

  /* Records successful provider verification timestamp */
  async recordVerification(provider: string): Promise<void> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: ConnectorConnectionStatus.CONNECTED,
      },
    });

    if (connection) {
      connection.lastVerifiedAt = new Date();
      connection.updatedAt = new Date();
      await this.connectionRepo.save(connection);
    }
  }

  /* Atomically saves selected page IDs, updates sync tracking items, marks deselected items, and registers outbox records */
  async saveSelectedPagesAndEnqueueSync(
    provider: string,
    pageIds: string[],
    resourceType = 'page',
  ): Promise<{ syncJobId: string; selectedCount: number; selectedPageIds: string[] }> {
    const uniquePages = Array.from(new Set(pageIds));

    return this.dataSource.transaction(async (manager) => {
      const connection = await manager.findOne(ConnectorConnectionEntity, {
        where: {
          provider,
          status: ConnectorConnectionStatus.CONNECTED,
        },
      });

      if (!connection) {
        throw new NotFoundException(
          `Cannot save pages: active connection for ${provider} does not exist`,
        );
      }

      const now = new Date();
      const currentMetadata = connection.metadata || {};
      connection.metadata = {
        ...currentMetadata,
        selectedPageIds: uniquePages,
      };
      connection.updatedAt = now;
      await manager.save(ConnectorConnectionEntity, connection);

      /* Load existing sync items for this connection */
      const existingItems = await manager.find(ConnectorSyncItemEntity, {
        where: { connectionId: connection.id },
      });
      const existingMap = new Map(existingItems.map((item) => [item.externalResourceId, item]));

      const syncJobId = `sync-batch-${connection.id}-${Date.now()}`;

      /* Upsert sync items and create outbox events */
      for (const pageId of uniquePages) {
        let item = existingMap.get(pageId);
        if (item) {
          item.status = ConnectorSyncItemStatus.PENDING;
          item.attemptCount = 0;
          item.nextAttemptAt = now;
          item.updatedAt = now;
          await manager.save(ConnectorSyncItemEntity, item);
        } else {
          item = manager.create(ConnectorSyncItemEntity, {
            connectionId: connection.id,
            externalResourceId: pageId,
            resourceType,
            status: ConnectorSyncItemStatus.PENDING,
            attemptCount: 0,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          });
          item = await manager.save(ConnectorSyncItemEntity, item);
        }

        /* Record transactional outbox event with trace context propagation */
        const outboxPayload: Record<string, any> = {
          syncItemId: item.id,
          connectionId: connection.id,
          provider,
          externalResourceId: pageId,
          resourceType,
        };
        TraceContextPropagator.injectToCarrier(outboxPayload);

        const outboxEvent = manager.create(ConnectorSyncOutboxEntity, {
          connectionId: connection.id,
          externalResourceId: pageId,
          eventType: 'SYNC_RESOURCE',
          payload: outboxPayload,
          status: 'pending',
          attemptCount: 0,
          createdAt: now,
        });
        await manager.save(ConnectorSyncOutboxEntity, outboxEvent);
      }

      /* Mark unselected resources as DESELECTED */
      const selectedSet = new Set(uniquePages);
      for (const item of existingItems) {
        if (!selectedSet.has(item.externalResourceId) && item.status !== ConnectorSyncItemStatus.DESELECTED) {
          item.status = ConnectorSyncItemStatus.DESELECTED;
          item.updatedAt = now;
          await manager.save(ConnectorSyncItemEntity, item);
        }
      }

      this.logger.log(`Enqueued sync for ${uniquePages.length} pages under connection ${connection.id}`);
      return {
        syncJobId,
        selectedCount: uniquePages.length,
        selectedPageIds: uniquePages,
      };
    });
  }

  /* Stores selected page IDs inside connection metadata */
  async saveSelectedPages(
    provider: string,
    pageIds: string[],
  ): Promise<string[]> {
    const result = await this.saveSelectedPagesAndEnqueueSync(provider, pageIds);
    return result.selectedPageIds;
  }

  /* Retrieves tracking items for a given provider connection */
  async getSyncItems(provider: string): Promise<ConnectorSyncItemEntity[]> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: ConnectorConnectionStatus.CONNECTED,
      },
    });

    if (!connection) {
      return [];
    }

    return this.syncItemRepo.find({
      where: { connectionId: connection.id },
      order: { createdAt: 'ASC' },
    });
  }

  /* Retrieves selected page IDs from connection metadata */
  async getSelectedPages(provider: string): Promise<string[]> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: ConnectorConnectionStatus.CONNECTED,
      },
    });

    if (!connection || !connection.metadata?.selectedPageIds) {
      return [];
    }

    return Array.isArray(connection.metadata.selectedPageIds)
      ? connection.metadata.selectedPageIds
      : [];
  }

  /* Idempotently disconnects a provider and clears credential material */
  async disconnect(provider: string): Promise<void> {
    const connection = await this.connectionRepo.findOne({
      where: {
        provider,
        status: In([
          ConnectorConnectionStatus.CONNECTED,
          ConnectorConnectionStatus.REAUTH_REQUIRED,
        ]),
      },
      relations: { credential: true },
    });

    if (!connection) {
      /* Idempotent: already disconnected or does not exist */
      return;
    }

    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      connection.status = ConnectorConnectionStatus.DISCONNECTED;
      connection.disconnectedAt = now;
      connection.updatedAt = now;

      await manager.save(ConnectorConnectionEntity, connection);

      if (connection.credential) {
        /* Invalidate credentials permanently */
        connection.credential.encryptedPayload = '';
        connection.credential.updatedAt = now;
        await manager.save(
          ConnectorCredentialEntity,
          connection.credential,
        );
      }
    });

    this.logger.log(`Idempotently disconnected provider ${provider}`);
  }
}
