import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, JobsOptions, UnrecoverableError, Worker } from 'bullmq';
import { context } from '@opentelemetry/api';
import {
  ConnectorSyncItemRepository,
  ConnectorSyncItemStatus,
  ConnectorPersistenceService,
  ConnectorConnectionStatus,
} from '../../connector-persistence';
import type { KnowledgeSyncProcessor } from '../interfaces/knowledge-sync-processor.interface';
import {
  DOCUMENT_STORAGE_SERVICE,
  type IDocumentStorageService,
} from '../services/document-storage.service';
import {
  INGESTION_SYNC_DLQ_TOKEN,
  INGESTION_SYNC_QUEUE_NAME,
  type SyncDeadLetterPayload,
  type SyncResourceJobPayload,
} from '../../queue/queue.constants';
import { Processor } from '../../queue/processor.decorator';
import { AppConfigService } from '../../../config';
import { TraceContextPropagator } from '../../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../../common/logger';
import { ErrorClassifier } from '../../../common/resilience/error-classifier';
import { isAuthRejection, toError } from '../../../common/resilience/error-utils';

/* Multi-provider token: every registered KnowledgeSyncProcessor, looked up by its provider name */
export const KNOWLEDGE_SYNC_PROCESSORS = Symbol('KNOWLEDGE_SYNC_PROCESSORS');

/* Minimal port for the dead-letter queue; a BullMQ Queue satisfies it structurally */
export interface DeadLetterQueue {
  add(name: string, data: SyncDeadLetterPayload, opts?: JobsOptions): Promise<unknown>;
}

/* Failed job surface the dead-letter handler relies on */
type FailedSyncJob = Pick<Job<SyncResourceJobPayload>, 'id' | 'data' | 'attemptsMade' | 'opts' | 'remove'>;

/* Background worker processing resource synchronization jobs from BullMQ */
@Processor(INGESTION_SYNC_QUEUE_NAME)
@Injectable()
export class SyncResourceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger(SyncResourceWorker.name);
  private readonly processors: Map<string, KnowledgeSyncProcessor>;
  private worker?: Worker<SyncResourceJobPayload>;

  constructor(
    private readonly syncItems: ConnectorSyncItemRepository,
    @Inject(KNOWLEDGE_SYNC_PROCESSORS)
    processors: KnowledgeSyncProcessor[],
    private readonly persistenceService: ConnectorPersistenceService,
    @Inject(DOCUMENT_STORAGE_SERVICE)
    private readonly docStorage: IDocumentStorageService,
    @Inject(INGESTION_SYNC_DLQ_TOKEN)
    private readonly deadLetters: DeadLetterQueue,
    private readonly config: AppConfigService,
  ) {
    this.processors = new Map(processors.map((processor) => [processor.provider, processor]));
  }

  onModuleInit(): void {
    const redis = this.config.redis;
    this.worker = new Worker<SyncResourceJobPayload>(
      INGESTION_SYNC_QUEUE_NAME,
      (job: Job<SyncResourceJobPayload>) => this.process(job),
      {
        connection: {
          host: redis.host,
          port: redis.port,
          password: redis.password,
          maxRetriesPerRequest: null,
        },
        concurrency: this.config.sync.workerConcurrency,
      },
    );

    this.worker.on('failed', (job, error) => {
      if (job) {
        void this.handleFailedJob(job, error);
      }
    });

    this.logger.log('SyncResourceWorker initialized and listening for jobs');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  /* BullMQ entry point; runs the job inside the trace context captured at selection time */
  process(job: Job<SyncResourceJobPayload>): Promise<void> {
    const traceCtx = TraceContextPropagator.extractFromCarrier(job.data);
    return context.with(traceCtx, () => this.processJobData(job.data));
  }

  /* Process execution logic decoupled for direct testing and job runs */
  async processJobData(data: SyncResourceJobPayload): Promise<void> {
    const { syncItemId, connectionId, provider, externalResourceId } = data;

    this.logger.info(LogEvents.INGESTION_SYNC_STARTED, {
      syncItemId,
      connectionId,
      provider,
      externalResourceId,
    });

    const syncItem = await this.syncItems.findById(syncItemId);
    if (!syncItem) {
      this.logger.warn('Sync item not found, skipping job', { syncItemId });
      return;
    }

    if (syncItem.status === ConnectorSyncItemStatus.DESELECTED) {
      this.logger.info('Resource deselected, aborting sync job', {
        syncItemId,
        externalResourceId,
      });
      return;
    }

    syncItem.status = ConnectorSyncItemStatus.SYNCING;
    syncItem.attemptCount += 1;
    await this.syncItems.save(syncItem);

    try {
      const processor = this.processors.get(provider);
      if (!processor) {
        throw new Error(`Unsupported sync provider: ${provider}`);
      }

      const result = await processor.syncResource({
        connectionId,
        externalResourceId,
        lastObservedRevision: syncItem.lastObservedRevision,
        lastProcessedFingerprint: syncItem.lastProcessedFingerprint,
      });

      if (result.status === 'FAILED') {
        throw result.error ?? new Error('Sync execution failed');
      }

      if (result.status === 'NO_OP') {
        /* Skips the update itself when the item was deselected mid-flight */
        await this.syncItems.markUnchanged(syncItemId, result.observedRevision);
        this.logger.info('No-op sync completed for unchanged resource', {
          syncItemId,
          externalResourceId,
        });
        return;
      }

      if (!result.normalizedPayload) {
        throw new Error('Sync processor reported UPDATED without a normalized payload');
      }

      /* Deselection, stale-revision and version checks happen atomically inside the storage transaction */
      const publication = await this.docStorage.publishSyncedDocument({
        syncItemId,
        payload: result.normalizedPayload,
        observedRevision: result.observedRevision,
        contentFingerprint: result.contentFingerprint,
      });

      this.logger.info(LogEvents.INGESTION_SYNC_COMPLETED, {
        syncItemId,
        externalResourceId,
        outcome: publication.outcome,
        documentId: publication.documentId,
        versionId: publication.version === undefined ? undefined : String(publication.version),
        contentFingerprint: result.contentFingerprint,
      });
    } catch (error: unknown) {
      await this.recordFailure(data, error);
    }
  }

  /* Persists the failure, then rethrows retryable errors for BullMQ backoff and stops retries for everything else */
  private async recordFailure(data: SyncResourceJobPayload, error: unknown): Promise<never> {
    const { syncItemId, connectionId, provider, externalResourceId } = data;
    const category = ErrorClassifier.classify(error);
    const failure = toError(error);
    const authRejected = isAuthRejection(error);

    const freshItem = await this.syncItems.findById(syncItemId);
    if (freshItem && freshItem.status !== ConnectorSyncItemStatus.DESELECTED) {
      freshItem.status = ConnectorSyncItemStatus.FAILED;
      freshItem.lastError = {
        message: failure.message,
        category,
        timestamp: new Date().toISOString(),
      };
      await this.syncItems.save(freshItem);
    }

    this.logger.logError(LogEvents.INGESTION_SYNC_FAILED, failure, {
      syncItemId,
      externalResourceId,
      errorType: category,
    });

    if (authRejected) {
      await this.persistenceService.updateStatus(provider, ConnectorConnectionStatus.REAUTH_REQUIRED);
      this.logger.warn('Connection transitioned to REAUTH_REQUIRED due to auth failure', {
        provider,
        connectionId,
      });
      throw new UnrecoverableError(failure.message);
    }

    if (ErrorClassifier.isRetryable(error)) {
      throw failure;
    }
    throw new UnrecoverableError(failure.message);
  }

  /* Moves a job that will never run again into the DLQ and removes it so its deterministic id can be reused */
  async handleFailedJob(job: FailedSyncJob, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinal = error instanceof UnrecoverableError || job.attemptsMade >= maxAttempts;
    if (!isFinal) {
      return;
    }

    const failedAt = new Date();
    const deadLetter: SyncDeadLetterPayload = {
      originalJobId: String(job.id),
      payload: job.data,
      errorMessage: error.message,
      errorCategory: error instanceof UnrecoverableError ? 'PERMANENT' : ErrorClassifier.classify(error),
      attemptsMade: job.attemptsMade,
      failedAt: failedAt.toISOString(),
      traceparent: job.data.traceparent,
      tracestate: job.data.tracestate,
    };

    try {
      /* BullMQ accepts colon ids only with exactly three segments, so key the entry by the sync item */
      await this.deadLetters.add('sync-dead-letter', deadLetter, {
        jobId: `dlq:${job.data.syncItemId}:${failedAt.getTime()}`,
      });
      await job.remove();
      this.logger.warnEvent(LogEvents.SYNC_JOB_DEAD_LETTERED, {
        jobId: deadLetter.originalJobId,
        syncItemId: job.data.syncItemId,
        errorType: deadLetter.errorCategory,
        attempt: job.attemptsMade,
      });
    } catch (dlqError: unknown) {
      /* The job stays in the failed set so nothing is lost; re-selection stays blocked until it is cleared */
      this.logger.logError(LogEvents.SYNC_JOB_DLQ_WRITE_FAILED, dlqError, {
        jobId: deadLetter.originalJobId,
        syncItemId: job.data.syncItemId,
      });
    }
  }
}
