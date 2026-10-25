import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config';
import { OutboxRelay, type OutboxJob, type OutboxJobQueue } from '../../common/outbox/outbox-relay';
import type { IOutboxStore, OutboxRecord } from '../../common/outbox/outbox.types';
import {
  INGESTION_SYNC_QUEUE_TOKEN,
  type SyncResourceJobPayload,
} from '../queue/queue.constants';
import { ConnectorSyncOutboxRepository } from './repositories/connector-sync-outbox.repository';

export const SYNC_RESOURCE_JOB_NAME = 'sync-resource';

/* Deterministic BullMQ job id coalescing duplicate sync signals for one resource of one connection */
export function buildSyncJobId(connectionId: string, externalResourceId: string): string {
  return `sync:${connectionId}:${externalResourceId}`;
}

/* Background relay draining connector_sync_outbox into the ingestion sync queue */
@Injectable()
export class SyncOutboxRelayService extends OutboxRelay<SyncResourceJobPayload, SyncResourceJobPayload> {
  constructor(
    @Inject(ConnectorSyncOutboxRepository)
    outboxStore: IOutboxStore<SyncResourceJobPayload>,
    @Inject(INGESTION_SYNC_QUEUE_TOKEN)
    syncQueue: OutboxJobQueue<SyncResourceJobPayload>,
    config: AppConfigService,
  ) {
    super(outboxStore, syncQueue, config.outbox, {
      attempts: config.sync.jobAttempts,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      /* Final failures are moved to the DLQ and removed by the worker, which frees the deterministic id */
      removeOnFail: false,
    });
  }

  /* Trace context was injected into the payload at selection time and travels unchanged */
  protected toJob(record: OutboxRecord<SyncResourceJobPayload>): OutboxJob<SyncResourceJobPayload> {
    const { payload } = record;
    return {
      name: SYNC_RESOURCE_JOB_NAME,
      jobId: buildSyncJobId(payload.connectionId, payload.externalResourceId),
      data: { ...payload, outboxEventId: record.id },
    };
  }
}
