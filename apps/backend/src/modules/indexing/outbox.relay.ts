import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import pLimit from 'p-limit';
import { EmbeddingOutbox } from '../../entities';
import {
  EMBEDDING_QUEUE_TOKEN,
  EmbeddingJobPayload,
} from '../queue/queue.constants';
import { StructuredLogger } from '../../common/logger/structured-logger';
import { LogEvents } from '../../common/logger/log-events';
import { ErrorClassifier } from '../../common/resilience/error-classifier';

/* Periodic relay service polling pending outbox events and publishing them to BullMQ */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger(OutboxRelayService.name);
  private readonly concurrencyLimit = 10;
  private timer?: NodeJS.Timeout;
  private isPolling = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(EMBEDDING_QUEUE_TOKEN)
    private readonly embeddingQueue: Queue<EmbeddingJobPayload>,
  ) {}

  onModuleInit() {
    /* Starts background polling loop every 1000ms */
    this.logger.log('Outbox relay background poller initialized');
    this.timer = setInterval(() => {
      this.handlePollingTick().catch((err) => {
        const category = ErrorClassifier.classify(err);
        this.logger.error(`Unexpected error during outbox poller tick: ${err?.message}`, err?.stack, {
          event: LogEvents.OUTBOX_PUBLISH_FAILED,
          errorType: category,
          errorMessage: err?.message,
        });
      });
    }, 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /* Internal concurrency guard preventing overlapping poller executions */
  async handlePollingTick(): Promise<number> {
    if (this.isPolling) {
      return 0;
    }
    this.isPolling = true;
    try {
      return await this.pollAndPublishOutbox(50);
    } finally {
      this.isPolling = false;
    }
  }

  /* Reads pending outbox entries, dispatches jobs with bounded concurrency via p-limit and Promise.allSettled outside DB transactions, then persists results */
  async pollAndPublishOutbox(batchSize = 50): Promise<number> {
    /* Step 1: Fetch pending outbox records using SKIP LOCKED in a brief transaction */
    const pendingEvents = await this.dataSource.transaction(async (manager) => {
      return await manager
        .createQueryBuilder(EmbeddingOutbox, 'outbox')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('outbox.status = :status', { status: 'pending' })
        .orderBy('outbox.created_at', 'ASC')
        .take(batchSize)
        .getMany();
    });

    if (!pendingEvents || pendingEvents.length === 0) {
      return 0;
    }

    /* Step 2: Concurrency-controlled BullMQ dispatch outside DB transaction using p-limit and Promise.allSettled */
    const limit = pLimit(this.concurrencyLimit);
    const publishPromises = pendingEvents.map((event) =>
      limit(async () => {
        const payload = event.payload as unknown as EmbeddingJobPayload;
        const bullMqJobId = `embed:${payload.documentId}:${payload.documentVersion}`;

        try {
          await this.embeddingQueue.add('embed-document', payload, {
            jobId: bullMqJobId,
            attempts: 4,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          });

          event.status = 'published';
          event.publishedAt = new Date();
          return { event, success: true };
        } catch (publishErr: any) {
          const category = ErrorClassifier.classify(publishErr);
          event.retryCount += 1;
          event.errorMessage = publishErr?.message;

          this.logger.error('Failed to publish outbox event to BullMQ', publishErr?.stack, {
            event: LogEvents.OUTBOX_PUBLISH_FAILED,
            jobId: bullMqJobId,
            documentId: payload.documentId,
            versionId: String(payload.documentVersion),
            errorType: category,
            attempt: event.retryCount,
          });

          if (category === 'PERMANENT') {
            event.status = 'failed';
          }
          return { event, success: false, error: publishErr };
        }
      }),
    );

    await Promise.allSettled(publishPromises);

    /* Step 3: Persist updated outbox statuses in a fast atomic transaction using bulk save */
    await this.dataSource.transaction(async (manager) => {
      await manager.save(pendingEvents);
    });

    return pendingEvents.length;
  }
}
