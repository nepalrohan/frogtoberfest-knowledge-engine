import { Injectable, Optional, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { ConnectorSyncOutboxEntity } from './entities/connector-sync-outbox.entity';
import type {
  ISyncOutboxRelay,
  ISyncQueuePublisher,
} from './interfaces/sync-outbox-relay.interface';
import { TraceContextPropagator } from '../../common/telemetry';
import { StructuredLogger } from '../../common/logger';

export const INGESTION_SYNC_QUEUE = 'ingestion-sync-queue';
export const SYNC_QUEUE_PUBLISHER = 'SYNC_QUEUE_PUBLISHER';

/* Reusable poller relay draining connector_sync_outbox into BullMQ using row locks and deterministic deduplication */
@Injectable()
export class SyncOutboxRelayService implements ISyncOutboxRelay {
  private readonly logger = new StructuredLogger('SyncOutboxRelayService');

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(SYNC_QUEUE_PUBLISHER)
    private readonly customPublisher?: ISyncQueuePublisher,
    @Optional()
    @Inject(INGESTION_SYNC_QUEUE)
    private readonly ingestionQueue?: Queue,
  ) {}

  /* Configures or overrides the queue publisher instance */
  setQueuePublisher(publisher: ISyncQueuePublisher): void {
    (this as any).customPublisher = publisher;
  }

  /* Drains pending outbox records into BullMQ with row-level locks and deterministic deduplication */
  async pollAndPublish(batchSize = 50): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const pendingEvents = await manager
        .createQueryBuilder(ConnectorSyncOutboxEntity, 'outbox')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('outbox.status = :status', { status: 'pending' })
        .orderBy('outbox.createdAt', 'ASC')
        .take(batchSize)
        .getMany();

      if (pendingEvents.length === 0) {
        return 0;
      }

      for (const event of pendingEvents) {
        const deterministicJobId = `sync:${event.connectionId}:${event.externalResourceId}`;

        /* Inject W3C trace context into payload */
        const jobPayload: Record<string, any> = {
          ...(event.payload || {}),
          outboxEventId: event.id,
        };
        TraceContextPropagator.injectToCarrier(jobPayload);

        try {
          if (this.customPublisher) {
            await this.customPublisher.publishSyncJob({
              jobId: deterministicJobId,
              payload: jobPayload,
              attempts: 4,
            });
          } else if (this.ingestionQueue) {
            await this.ingestionQueue.add('sync-resource', jobPayload, {
              jobId: deterministicJobId,
              attempts: 4,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
              removeOnComplete: true,
              removeOnFail: false,
            });
          }

          event.status = 'published';
          event.publishedAt = new Date();
          await manager.save(ConnectorSyncOutboxEntity, event);
        } catch (error: any) {
          event.attemptCount += 1;
          if (event.attemptCount >= 5) {
            event.status = 'failed';
          }
          await manager.save(ConnectorSyncOutboxEntity, event);
          this.logger.error('Failed to publish outbox event to queue', error?.stack, {
            outboxId: event.id,
            jobId: deterministicJobId,
          });
        }
      }

      return pendingEvents.length;
    });
  }
}
