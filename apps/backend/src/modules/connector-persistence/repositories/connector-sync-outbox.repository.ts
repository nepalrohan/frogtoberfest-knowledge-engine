import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConnectorSyncOutboxEntity } from '../entities';
import type { SyncResourceJobPayload } from '../../queue/queue.constants';
import type { IOutboxStore, OutboxOutcome, OutboxRecord } from '../../../common/outbox/outbox.types';
import { claimOutboxRows, recordOutboxOutcomes, OutboxTableSpec } from '../../../common/outbox/outbox-sql';

const SYNC_OUTBOX_TABLE: OutboxTableSpec = {
  table: 'connector_sync_outbox',
  attemptColumn: 'attempt_count',
  errorColumn: 'last_error',
};

/* Data access for the connector sync outbox; doubles as the relay's outbox store */
@Injectable()
export class ConnectorSyncOutboxRepository implements IOutboxStore<SyncResourceJobPayload> {
  constructor(private readonly dataSource: DataSource) {}

  /* Records a pending sync event inside the caller's selection transaction */
  async enqueue(payload: SyncResourceJobPayload, manager: EntityManager): Promise<void> {
    const event = manager.create(ConnectorSyncOutboxEntity, {
      connectionId: payload.connectionId,
      externalResourceId: payload.externalResourceId,
      eventType: 'SYNC_RESOURCE',
      payload,
      status: 'pending',
      attemptCount: 0,
      createdAt: new Date(),
    });
    await manager.save(ConnectorSyncOutboxEntity, event);
  }

  claimBatch(batchSize: number, leaseMs: number): Promise<OutboxRecord<SyncResourceJobPayload>[]> {
    return claimOutboxRows<SyncResourceJobPayload>(this.dataSource, SYNC_OUTBOX_TABLE, batchSize, leaseMs);
  }

  recordOutcomes(outcomes: OutboxOutcome[]): Promise<void> {
    return recordOutboxOutcomes(this.dataSource, SYNC_OUTBOX_TABLE, outcomes);
  }
}
