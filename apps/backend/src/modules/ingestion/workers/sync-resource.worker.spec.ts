import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { KNOWLEDGE_SYNC_PROCESSORS, SyncResourceWorker } from './sync-resource.worker';
import {
  ConnectorSyncItemEntity,
  ConnectorSyncItemRepository,
  ConnectorSyncItemStatus,
  ConnectorPersistenceService,
  ConnectorConnectionStatus,
} from '../../connector-persistence';
import type { KnowledgeSyncProcessor, SyncExecutionResult } from '../interfaces/knowledge-sync-processor.interface';
import { DOCUMENT_STORAGE_SERVICE } from '../services/document-storage.service';
import type { NormalizedDocumentPayload } from '../types';
import { INGESTION_SYNC_DLQ_TOKEN, type SyncResourceJobPayload } from '../../queue/queue.constants';
import { AppConfigService } from '../../../config';

const workerInstances: Array<{ name: string; options: { concurrency: number }; on: jest.Mock; close: jest.Mock }> = [];

jest.mock('bullmq', () => {
  const actual = jest.requireActual('bullmq');
  return {
    ...actual,
    Worker: jest.fn().mockImplementation((name: string, _processor: unknown, options: { concurrency: number }) => {
      const instance = { name, options, on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
      workerInstances.push(instance);
      return instance;
    }),
  };
});

const JOB: SyncResourceJobPayload = {
  syncItemId: 'sync-item-1',
  connectionId: 'conn-1',
  provider: 'notion',
  externalResourceId: 'page-1',
  resourceType: 'page',
};

const NORMALIZED: NormalizedDocumentPayload = {
  sourceType: 'notion',
  sourceId: 'page-1',
  sourceUrl: 'https://notion.so/page-1',
  title: 'Updated Page',
  normalizedContent: '# Updated Page',
  contentHash: 'new-hash-2',
  sourceUpdatedAt: new Date('2026-10-25T00:00:00.000Z'),
  metadata: { parentHierarchy: [] },
};

const makeItem = (overrides: Partial<ConnectorSyncItemEntity> = {}): ConnectorSyncItemEntity => ({
  id: 'sync-item-1',
  connectionId: 'conn-1',
  externalResourceId: 'page-1',
  resourceType: 'page',
  status: ConnectorSyncItemStatus.PENDING,
  attemptCount: 0,
  nextAttemptAt: null,
  lastSyncedAt: null,
  lastObservedRevision: 'rev-1',
  lastProcessedFingerprint: 'hash-1',
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('SyncResourceWorker', () => {
  let worker: SyncResourceWorker;
  let items: Map<string, ConnectorSyncItemEntity>;
  let syncItems: {
    findById: jest.Mock;
    save: jest.Mock;
    markUnchanged: jest.Mock;
  };
  let processor: { provider: string; syncResource: jest.Mock<Promise<SyncExecutionResult>> };
  let persistence: { updateStatus: jest.Mock };
  let docStorage: { publishSyncedDocument: jest.Mock };
  let deadLetters: { add: jest.Mock };

  beforeEach(async () => {
    workerInstances.length = 0;
    items = new Map([['sync-item-1', makeItem()]]);
    syncItems = {
      findById: jest.fn(async (id: string) => items.get(id) ?? null),
      save: jest.fn(async (item: ConnectorSyncItemEntity) => {
        items.set(item.id, item);
        return item;
      }),
      markUnchanged: jest.fn().mockResolvedValue(undefined),
    };
    processor = { provider: 'notion', syncResource: jest.fn() };
    persistence = { updateStatus: jest.fn().mockResolvedValue(undefined) };
    docStorage = {
      publishSyncedDocument: jest.fn().mockResolvedValue({ outcome: 'PUBLISHED', documentId: 'doc-1', version: 1 }),
    };
    deadLetters = { add: jest.fn().mockResolvedValue({ id: 'dlq-job' }) };

    const processors: KnowledgeSyncProcessor[] = [processor];
    const moduleRef = await Test.createTestingModule({
      providers: [
        SyncResourceWorker,
        { provide: ConnectorSyncItemRepository, useValue: syncItems },
        { provide: KNOWLEDGE_SYNC_PROCESSORS, useValue: processors },
        { provide: ConnectorPersistenceService, useValue: persistence },
        { provide: DOCUMENT_STORAGE_SERVICE, useValue: docStorage },
        { provide: INGESTION_SYNC_DLQ_TOKEN, useValue: deadLetters },
        { provide: AppConfigService, useValue: new AppConfigService(new ConfigService()) },
      ],
    }).compile();

    worker = moduleRef.get(SyncResourceWorker);
  });

  describe('processJobData', () => {
    it('aborts before calling the provider when the resource was deselected', async () => {
      items.set('sync-item-1', makeItem({ status: ConnectorSyncItemStatus.DESELECTED }));

      await worker.processJobData(JOB);

      expect(processor.syncResource).not.toHaveBeenCalled();
      expect(docStorage.publishSyncedDocument).not.toHaveBeenCalled();
    });

    it('skips silently when the sync item no longer exists', async () => {
      items.clear();

      await expect(worker.processJobData(JOB)).resolves.toBeUndefined();
      expect(processor.syncResource).not.toHaveBeenCalled();
    });

    it('passes the last observed revision and fingerprint to the provider and marks the item syncing', async () => {
      processor.syncResource.mockResolvedValue({ status: 'NO_OP', externalResourceId: 'page-1', observedRevision: 'rev-1' });

      await worker.processJobData(JOB);

      expect(processor.syncResource).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        externalResourceId: 'page-1',
        lastObservedRevision: 'rev-1',
        lastProcessedFingerprint: 'hash-1',
      });
      expect(syncItems.save).toHaveBeenCalledWith(expect.objectContaining({ status: ConnectorSyncItemStatus.SYNCING, attemptCount: 1 }));
    });

    it('records a NO_OP without publishing a document', async () => {
      processor.syncResource.mockResolvedValue({ status: 'NO_OP', externalResourceId: 'page-1', observedRevision: 'rev-1' });

      await worker.processJobData(JOB);

      expect(syncItems.markUnchanged).toHaveBeenCalledWith('sync-item-1', 'rev-1');
      expect(docStorage.publishSyncedDocument).not.toHaveBeenCalled();
    });

    it('publishes UPDATED content with its revision and fingerprint', async () => {
      processor.syncResource.mockResolvedValue({
        status: 'UPDATED',
        externalResourceId: 'page-1',
        observedRevision: 'rev-2',
        contentFingerprint: 'new-hash-2',
        normalizedPayload: NORMALIZED,
      });

      await worker.processJobData(JOB);

      expect(docStorage.publishSyncedDocument).toHaveBeenCalledWith({
        syncItemId: 'sync-item-1',
        payload: NORMALIZED,
        observedRevision: 'rev-2',
        contentFingerprint: 'new-hash-2',
      });
    });

    it.each(['REJECTED_DESELECTED', 'REJECTED_STALE', 'UNCHANGED'])(
      'completes without error when storage reports %s',
      async (outcome) => {
        processor.syncResource.mockResolvedValue({ status: 'UPDATED', externalResourceId: 'page-1', normalizedPayload: NORMALIZED });
        docStorage.publishSyncedDocument.mockResolvedValue({ outcome });

        await expect(worker.processJobData(JOB)).resolves.toBeUndefined();
      },
    );

    it('rethrows transient provider failures for BullMQ backoff and records them on the item', async () => {
      const timeout = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      processor.syncResource.mockRejectedValue(timeout);

      await expect(worker.processJobData(JOB)).rejects.toBe(timeout);

      expect(items.get('sync-item-1')).toEqual(
        expect.objectContaining({
          status: ConnectorSyncItemStatus.FAILED,
          lastError: expect.objectContaining({ message: 'socket hang up', category: 'TRANSIENT' }),
        }),
      );
    });

    it('stops retries with UnrecoverableError for permanent failures', async () => {
      processor.syncResource.mockResolvedValue({
        status: 'FAILED',
        externalResourceId: 'page-1',
        error: Object.assign(new Error('Page not found'), { status: 404 }),
      });

      await expect(worker.processJobData(JOB)).rejects.toBeInstanceOf(UnrecoverableError);
      expect(items.get('sync-item-1')?.lastError?.category).toBe('PERMANENT');
    });

    it('marks the connection REAUTH_REQUIRED and stops retries on a confirmed 401', async () => {
      processor.syncResource.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));

      await expect(worker.processJobData(JOB)).rejects.toBeInstanceOf(UnrecoverableError);

      expect(items.get('sync-item-1')?.status).toBe(ConnectorSyncItemStatus.FAILED);
      expect(persistence.updateStatus).toHaveBeenCalledWith('notion', ConnectorConnectionStatus.REAUTH_REQUIRED);
    });

    it('fails permanently for a provider without a registered processor', async () => {
      await expect(worker.processJobData({ ...JOB, provider: 'confluence' })).rejects.toThrow(
        new UnrecoverableError('Unsupported sync provider: confluence'),
      );
    });

    it('fails permanently when UPDATED arrives without a normalized payload', async () => {
      processor.syncResource.mockResolvedValue({ status: 'UPDATED', externalResourceId: 'page-1' });

      await expect(worker.processJobData(JOB)).rejects.toBeInstanceOf(UnrecoverableError);
      expect(docStorage.publishSyncedDocument).not.toHaveBeenCalled();
    });

    it('does not overwrite a deselection recorded while the failing job was in flight', async () => {
      processor.syncResource.mockImplementation(async () => {
        items.set('sync-item-1', makeItem({ status: ConnectorSyncItemStatus.DESELECTED }));
        throw Object.assign(new Error('Bad request'), { status: 400 });
      });

      await expect(worker.processJobData(JOB)).rejects.toBeInstanceOf(UnrecoverableError);
      expect(items.get('sync-item-1')?.status).toBe(ConnectorSyncItemStatus.DESELECTED);
    });
  });

  describe('process', () => {
    beforeAll(() => {
      new NodeTracerProvider().register();
    });

    it('runs the job inside the trace context carried on the payload', async () => {
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      let observedTraceId: string | undefined;
      processor.syncResource.mockImplementation(async () => {
        observedTraceId = trace.getActiveSpan()?.spanContext().traceId;
        return { status: 'NO_OP', externalResourceId: 'page-1' };
      });

      await worker.process({ data: { ...JOB, traceparent } } as Job<SyncResourceJobPayload>);

      expect(observedTraceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });
  });

  describe('handleFailedJob', () => {
    const failedJob = (attemptsMade: number, attempts = 4) => ({
      id: 'sync:conn-1:page-1',
      data: { ...JOB, traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      attemptsMade,
      opts: { attempts },
      remove: jest.fn().mockResolvedValue(undefined),
    });

    it('leaves non-final failures to BullMQ retries', async () => {
      const job = failedJob(1);

      await worker.handleFailedJob(job, new Error('timeout'));

      expect(deadLetters.add).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
    });

    it('dead-letters a job that exhausted its attempts and frees its deterministic id', async () => {
      const job = failedJob(4);

      await worker.handleFailedJob(job, Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

      expect(deadLetters.add).toHaveBeenCalledWith(
        'sync-dead-letter',
        expect.objectContaining({
          originalJobId: 'sync:conn-1:page-1',
          payload: job.data,
          errorMessage: 'socket hang up',
          errorCategory: 'TRANSIENT',
          attemptsMade: 4,
          traceparent: job.data.traceparent,
        }),
        { jobId: expect.stringMatching(/^dlq:sync-item-1:\d+$/) },
      );
      expect(job.remove).toHaveBeenCalled();
    });

    it('dead-letters an unrecoverable failure on its first attempt as PERMANENT', async () => {
      const job = failedJob(1);

      await worker.handleFailedJob(job, new UnrecoverableError('Page not found'));

      expect(deadLetters.add).toHaveBeenCalledWith(
        'sync-dead-letter',
        expect.objectContaining({ errorCategory: 'PERMANENT' }),
        expect.anything(),
      );
      expect(job.remove).toHaveBeenCalled();
    });

    it('keeps the failed job when the dead-letter write fails', async () => {
      deadLetters.add.mockRejectedValue(new Error('Redis down'));
      const job = failedJob(4);

      await expect(worker.handleFailedJob(job, new Error('boom'))).resolves.toBeUndefined();
      expect(job.remove).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('starts a worker on the sync queue with configured concurrency and closes it on shutdown', async () => {
      worker.onModuleInit();

      expect(workerInstances).toHaveLength(1);
      expect(workerInstances[0]).toEqual(expect.objectContaining({ name: 'ingestion-sync-queue', options: expect.objectContaining({ concurrency: 2 }) }));
      expect(workerInstances[0]!.on).toHaveBeenCalledWith('failed', expect.any(Function));

      await worker.onModuleDestroy();
      expect(workerInstances[0]!.close).toHaveBeenCalled();
    });
  });
});
