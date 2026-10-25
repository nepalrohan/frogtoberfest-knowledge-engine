import { Injectable, Optional, Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectorSyncItemEntity,
  ConnectorSyncItemStatus,
  ConnectorPersistenceService,
  ConnectorConnectionStatus,
} from '../../connector-persistence';
import { NotionSyncProcessor } from '../connectors/notion/notion-sync.processor';
import type { IDocumentStorageService } from '../services/document-storage-placeholder.service';
import {
  DOCUMENT_STORAGE_SERVICE,
  DocumentStoragePlaceholderService,
} from '../services/document-storage-placeholder.service';
import { TraceContextPropagator } from '../../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../../common/logger';
import { ErrorClassifier } from '../../../common/resilience/error-classifier';

export interface SyncResourceJobPayload {
  syncItemId: string;
  connectionId: string;
  provider: 'notion' | 'confluence';
  externalResourceId: string;
  resourceType: string;
  traceparent?: string;
  tracestate?: string;
  [key: string]: unknown;
}

/* Background worker processing resource synchronization jobs from BullMQ */
@Processor('ingestion-sync-queue')
@Injectable()
export class SyncResourceWorker extends WorkerHost {
  private readonly logger = new StructuredLogger('SyncResourceWorker');

  constructor(
    @InjectRepository(ConnectorSyncItemEntity)
    private readonly syncItemRepo: Repository<ConnectorSyncItemEntity>,
    private readonly notionProcessor: NotionSyncProcessor,
    private readonly persistenceService: ConnectorPersistenceService,
    @Optional()
    @Inject(DOCUMENT_STORAGE_SERVICE)
    private readonly docStorage: IDocumentStorageService = new DocumentStoragePlaceholderService(),
  ) {
    super();
  }

  /* Main BullMQ job execution handler */
  async process(job: Job<SyncResourceJobPayload>): Promise<any> {
    return this.processJobData(job.data);
  }

  /* Process execution logic decoupled for direct testing and job runs */
  async processJobData(data: SyncResourceJobPayload): Promise<void> {
    const { syncItemId, connectionId, provider, externalResourceId } = data;

    /* Extract trace context from job payload */
    const traceCtx = TraceContextPropagator.extractFromCarrier(data);

    this.logger.info(LogEvents.INGESTION_SYNC_STARTED, {
      syncItemId,
      connectionId,
      provider,
      externalResourceId,
    });

    /* 1. Fetch current sync item */
    const syncItem = await this.syncItemRepo.findOne({
      where: { id: syncItemId },
    });

    if (!syncItem) {
      this.logger.warn('Sync item not found, skipping job', { syncItemId });
      return;
    }

    /* 2. Check if deselected prior to processing */
    if (syncItem.status === ConnectorSyncItemStatus.DESELECTED) {
      this.logger.info('Resource deselected, aborting sync job', {
        syncItemId,
        externalResourceId,
      });
      return;
    }

    /* 3. Mark syncing status */
    syncItem.status = ConnectorSyncItemStatus.SYNCING;
    syncItem.attemptCount += 1;
    await this.syncItemRepo.save(syncItem);

    try {
      /* 4. Delegate to provider processor */
      let result;
      if (provider === 'notion') {
        result = await this.notionProcessor.syncResource({
          connectionId,
          externalResourceId,
          lastObservedRevision: syncItem.lastObservedRevision,
          lastProcessedFingerprint: syncItem.lastProcessedFingerprint,
        });
      } else {
        throw new Error(`Unsupported sync provider: ${provider}`);
      }

      /* 5. Check if deselected during in-flight processing */
      const freshItem = await this.syncItemRepo.findOne({
        where: { id: syncItemId },
      });

      if (!freshItem || freshItem.status === ConnectorSyncItemStatus.DESELECTED) {
        this.logger.info('Resource deselected during processing, discarding result', {
          syncItemId,
          externalResourceId,
        });
        return;
      }

      /* 6. Process result */
      if (result.status === 'NO_OP') {
        freshItem.status = ConnectorSyncItemStatus.COMPLETED;
        freshItem.lastSyncedAt = new Date();
        if (result.observedRevision) {
          freshItem.lastObservedRevision = result.observedRevision;
        }
        freshItem.lastError = null;
        await this.syncItemRepo.save(freshItem);

        this.logger.info('No-op sync completed for unchanged resource', {
          syncItemId,
          externalResourceId,
        });
        return;
      }

      if (result.status === 'UPDATED' && result.normalizedPayload) {
        /* Persist to document storage */
        await this.docStorage.saveDocument(result.normalizedPayload);

        freshItem.status = ConnectorSyncItemStatus.COMPLETED;
        freshItem.lastSyncedAt = new Date();
        if (result.observedRevision) {
          freshItem.lastObservedRevision = result.observedRevision;
        }
        if (result.contentFingerprint) {
          freshItem.lastProcessedFingerprint = result.contentFingerprint;
        }
        freshItem.lastError = null;
        await this.syncItemRepo.save(freshItem);

        this.logger.info('Updated document and completed sync', {
          syncItemId,
          externalResourceId,
          contentFingerprint: result.contentFingerprint,
        });
        return;
      }

      if (result.status === 'FAILED') {
        throw result.error || new Error('Sync execution failed');
      }
    } catch (error: any) {
      const category = ErrorClassifier.classify(error);
      const isAuthError =
        error?.status === 401 ||
        error?.statusCode === 401 ||
        String(error?.message || '').toLowerCase().includes('unauthorized') ||
        String(error?.message || '').toLowerCase().includes('invalid_grant');

      const freshItem = await this.syncItemRepo.findOne({
        where: { id: syncItemId },
      });

      if (freshItem) {
        freshItem.lastError = {
          message: error?.message || String(error),
          category,
          timestamp: new Date().toISOString(),
        };

        if (isAuthError) {
          freshItem.status = ConnectorSyncItemStatus.FAILED;
          await this.syncItemRepo.save(freshItem);

          /* Mark connection as requiring reauthorization */
          await this.persistenceService.updateStatus(
            provider,
            ConnectorConnectionStatus.REAUTH_REQUIRED,
          );
          this.logger.warn('Connection transitioned to REAUTH_REQUIRED due to auth failure', {
            provider,
            connectionId,
          });
          return;
        }

        freshItem.status = ConnectorSyncItemStatus.FAILED;
        await this.syncItemRepo.save(freshItem);
      }

      this.logger.error(LogEvents.INGESTION_SYNC_FAILED, error?.stack, {
        syncItemId,
        externalResourceId,
        category,
      });

      /* Re-throw retryable errors to trigger BullMQ backoff */
      if (ErrorClassifier.isRetryable(error)) {
        throw error;
      }
    }
  }
}
