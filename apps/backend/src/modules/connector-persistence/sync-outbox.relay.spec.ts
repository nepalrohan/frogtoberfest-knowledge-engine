import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../config';
import type { IOutboxStore, OutboxOutcome, OutboxRecord } from '../../common/outbox/outbox.types';
import type { SyncResourceJobPayload } from '../queue/queue.constants';
import { SyncOutboxRelayService, buildSyncJobId } from './sync-outbox.relay';

/* Single-batch store returning prepared records and capturing recorded outcomes */
class FakeSyncOutboxStore implements IOutboxStore<SyncResourceJobPayload> {
  recorded: OutboxOutcome[] = [];

  constructor(private records: OutboxRecord<SyncResourceJobPayload>[]) {}

  async claimBatch(): Promise<OutboxRecord<SyncResourceJobPayload>[]> {
    const claimed = this.records;
    this.records = [];
    return claimed;
  }

  async recordOutcomes(outcomes: OutboxOutcome[]): Promise<void> {
    this.recorded.push(...outcomes);
  }
}

const payload: SyncResourceJobPayload = {
  syncItemId: 'item-1',
  connectionId: 'conn-1',
  provider: 'notion',
  externalResourceId: 'page-1',
  resourceType: 'page',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  tracestate: 'vendor=value',
};

describe('SyncOutboxRelayService', () => {
  const config = new AppConfigService(new ConfigService());

  it('publishes sync-resource jobs with the deterministic connection/resource id and preserved trace context', async () => {
    const store = new FakeSyncOutboxStore([{ id: 'outbox-1', payload, attemptCount: 0 }]);
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
    const relay = new SyncOutboxRelayService(store, queue, config);

    await expect(relay.drainOnce()).resolves.toBe(1);

    expect(queue.add).toHaveBeenCalledWith(
      'sync-resource',
      { ...payload, outboxEventId: 'outbox-1' },
      expect.objectContaining({
        jobId: 'sync:conn-1:page-1',
        attempts: config.sync.jobAttempts,
        removeOnFail: false,
      }),
    );
    expect(store.recorded).toEqual([expect.objectContaining({ id: 'outbox-1', status: 'published' })]);
  });

  it('keeps a row pending for retry when Redis is unreachable', async () => {
    const store = new FakeSyncOutboxStore([{ id: 'outbox-2', payload, attemptCount: 0 }]);
    const queue = {
      add: jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    };
    const relay = new SyncOutboxRelayService(store, queue, config);

    await relay.drainOnce();

    expect(store.recorded).toEqual([
      expect.objectContaining({ id: 'outbox-2', status: 'pending', attemptCount: 1, lastError: 'connect ECONNREFUSED' }),
    ]);
  });

  it('builds job ids that differ per connection for the same resource', () => {
    expect(buildSyncJobId('conn-a', 'page-1')).not.toBe(buildSyncJobId('conn-b', 'page-1'));
  });
});
