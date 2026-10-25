import { OutboxRelay, type OutboxJob, type OutboxJobQueue, type OutboxRelayOptions } from './outbox-relay';
import type { IOutboxStore, OutboxOutcome, OutboxRecord } from './outbox.types';

interface TestPayload {
  key: string;
}

const OPTIONS: OutboxRelayOptions = {
  pollIntervalMs: 1000,
  batchSize: 50,
  concurrency: 2,
  maxAttempts: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 3000,
  claimLeaseMs: 30000,
};

/* In-memory store capturing what the relay claims and records */
class FakeStore implements IOutboxStore<TestPayload> {
  records: OutboxRecord<TestPayload>[] = [];
  recorded: OutboxOutcome[][] = [];
  claimCalls: Array<{ batchSize: number; leaseMs: number }> = [];

  async claimBatch(batchSize: number, leaseMs: number): Promise<OutboxRecord<TestPayload>[]> {
    this.claimCalls.push({ batchSize, leaseMs });
    const claimed = this.records.slice(0, batchSize);
    this.records = this.records.slice(batchSize);
    return claimed;
  }

  async recordOutcomes(outcomes: OutboxOutcome[]): Promise<void> {
    this.recorded.push(outcomes);
  }
}

class TestRelay extends OutboxRelay<TestPayload, TestPayload> {
  constructor(store: FakeStore, queue: OutboxJobQueue<TestPayload>, options: OutboxRelayOptions = OPTIONS) {
    super(store, queue, options, { attempts: 4 });
  }

  protected toJob(record: OutboxRecord<TestPayload>): OutboxJob<TestPayload> {
    return { name: 'test-job', jobId: `test:${record.payload.key}`, data: record.payload };
  }
}

const record = (id: string, attemptCount = 0): OutboxRecord<TestPayload> => ({
  id,
  payload: { key: id },
  attemptCount,
});

const transientError = (): Error => Object.assign(new Error('Redis timeout'), { code: 'ETIMEDOUT' });
const permanentError = (): Error => Object.assign(new Error('Bad payload'), { status: 400 });

describe('OutboxRelay', () => {
  let store: FakeStore;
  let queue: { add: jest.Mock };
  let relay: TestRelay;

  beforeEach(() => {
    store = new FakeStore();
    queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
    relay = new TestRelay(store, queue);
  });

  afterEach(() => {
    relay.onModuleDestroy();
    jest.useRealTimers();
  });

  it('returns 0 and records nothing when no rows are claimable', async () => {
    await expect(relay.drainOnce()).resolves.toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
    expect(store.recorded).toHaveLength(0);
  });

  it('claims with the configured batch size and lease, publishes with a deterministic job id, and marks published', async () => {
    store.records = [record('a')];

    await expect(relay.drainOnce()).resolves.toBe(1);

    expect(store.claimCalls).toEqual([{ batchSize: 50, leaseMs: 30000 }]);
    expect(queue.add).toHaveBeenCalledWith('test-job', { key: 'a' }, { attempts: 4, jobId: 'test:a' });
    expect(store.recorded).toEqual([
      [expect.objectContaining({ id: 'a', status: 'published', attemptCount: 0, lastError: null, publishedAt: expect.any(Date) })],
    ]);
  });

  it('records every outcome of a mixed batch in a single write and keeps publishing after a failure', async () => {
    store.records = [record('ok-1'), record('bad'), record('ok-2')];
    queue.add.mockImplementation(async (_name: string, data: TestPayload) => {
      if (data.key === 'bad') throw transientError();
      return { id: data.key };
    });

    await relay.drainOnce();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(store.recorded).toHaveLength(1);
    const statuses = Object.fromEntries(store.recorded[0]!.map((o) => [o.id, o.status]));
    expect(statuses).toEqual({ 'ok-1': 'published', bad: 'pending', 'ok-2': 'published' });
  });

  it('never has more publishes in flight than the concurrency limit', async () => {
    store.records = Array.from({ length: 6 }, (_, i) => record(`r${i}`));
    let inFlight = 0;
    let peak = 0;
    queue.add.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });

    await relay.drainOnce();

    expect(peak).toBe(2);
  });

  it('returns a transient failure to pending with exponential backoff', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-25T00:00:00.000Z') });
    store.records = [record('first', 0), record('second', 1)];
    queue.add.mockRejectedValue(transientError());

    await relay.drainOnce();

    const [first, second] = store.recorded[0]!;
    expect(first).toEqual(
      expect.objectContaining({
        status: 'pending',
        attemptCount: 1,
        lastError: 'Redis timeout',
        nextAttemptAt: new Date('2026-10-25T00:00:01.000Z'),
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({ status: 'pending', attemptCount: 2, nextAttemptAt: new Date('2026-10-25T00:00:02.000Z') }),
    );
  });

  it('caps the backoff delay at the configured maximum', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-25T00:00:00.000Z') });
    relay = new TestRelay(store, queue, { ...OPTIONS, maxAttempts: 10 });
    store.records = [record('slow', 5)];
    queue.add.mockRejectedValue(transientError());

    await relay.drainOnce();

    expect(store.recorded[0]![0]!.nextAttemptAt).toEqual(new Date('2026-10-25T00:00:03.000Z'));
  });

  it('dead-letters a permanent failure immediately', async () => {
    store.records = [record('perm')];
    queue.add.mockRejectedValue(permanentError());

    await relay.drainOnce();

    expect(store.recorded[0]![0]).toEqual(
      expect.objectContaining({ status: 'dead_lettered', attemptCount: 1, lastError: 'Bad payload', nextAttemptAt: null }),
    );
  });

  it('dead-letters a transient failure once attempts are exhausted', async () => {
    store.records = [record('tired', 2)];
    queue.add.mockRejectedValue(transientError());

    await relay.drainOnce();

    expect(store.recorded[0]![0]).toEqual(expect.objectContaining({ status: 'dead_lettered', attemptCount: 3 }));
  });

  it('skips a polling tick while the previous cycle is still running', async () => {
    let release: () => void = () => undefined;
    store.records = [record('a')];
    queue.add.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

    const firstTick = relay.handlePollingTick();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(relay.handlePollingTick()).resolves.toBe(0);

    release();
    await expect(firstTick).resolves.toBe(1);
    expect(store.claimCalls).toHaveLength(1);
  });

  it('swallows and logs store failures so the poller keeps running', async () => {
    jest.spyOn(store, 'claimBatch').mockRejectedValue(new Error('db down'));

    await expect(relay.handlePollingTick()).resolves.toBe(0);
  });

  it('polls on the configured interval after init and stops on destroy', async () => {
    jest.useFakeTimers();
    const tick = jest.spyOn(relay, 'handlePollingTick').mockResolvedValue(0);

    relay.onModuleInit();
    jest.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(2);

    relay.onModuleDestroy();
    jest.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
