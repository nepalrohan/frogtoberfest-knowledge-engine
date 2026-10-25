import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import {
  ConnectorPersistenceService,
  ConnectorSyncItemEntity,
  ConnectorSyncItemStatus,
  ConnectorSyncOutboxEntity,
  ConnectorConnectionStatus,
  ConnectorAuthType,
  SYNC_QUEUE_PUBLISHER,
  SyncOutboxRelayService,
} from '../../src/modules/connector-persistence';
import type { ISyncQueuePublisher } from '../../src/modules/connector-persistence/interfaces/sync-outbox-relay.interface';
import { NotionSyncProcessor } from '../../src/modules/ingestion/connectors/notion/notion-sync.processor';
import { SyncResourceWorker } from '../../src/modules/ingestion/workers/sync-resource.worker';
import {
  DOCUMENT_STORAGE_SERVICE,
  DocumentStoragePlaceholderService,
} from '../../src/modules/ingestion/services/document-storage-placeholder.service';
import { ConnectionStorageService } from '../../src/modules/integrations/connection-storage.service';
import { TraceContextPropagator } from '../../src/common/telemetry';

/* Integration scenario tests covering durable sync, outbox relay, worker change detection, and resilience */
describe('Durable Connector Sync Scenarios (OpenSpec 6.2)', () => {
  let app: INestApplication;
  let persistenceService: ConnectorPersistenceService;
  let relayService: SyncOutboxRelayService;
  let worker: SyncResourceWorker;
  let docStorage: DocumentStoragePlaceholderService;
  let notionProcessor: NotionSyncProcessor;
  let storageService: ConnectionStorageService;
  let syncItemRepo: Repository<ConnectorSyncItemEntity>;
  let syncOutboxRepo: Repository<ConnectorSyncOutboxEntity>;

  const publishedJobs: Array<{ jobId: string; payload: Record<string, any> }> = [];

  const mockPublisher: ISyncQueuePublisher = {
    publishSyncJob: jest.fn().mockImplementation(async (job) => {
      publishedJobs.push(job);
      return `bullmq-job-${job.jobId}`;
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SYNC_QUEUE_PUBLISHER)
      .useValue(mockPublisher)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    persistenceService = app.get(ConnectorPersistenceService);
    relayService = app.get(SyncOutboxRelayService);
    worker = app.get(SyncResourceWorker);
    docStorage = app.get<DocumentStoragePlaceholderService>(
      DOCUMENT_STORAGE_SERVICE,
    );
    notionProcessor = app.get(NotionSyncProcessor);
    storageService = app.get(ConnectionStorageService);
    syncItemRepo = app.get<Repository<ConnectorSyncItemEntity>>(
      getRepositoryToken(ConnectorSyncItemEntity),
    );
    syncOutboxRepo = app.get<Repository<ConnectorSyncOutboxEntity>>(
      getRepositoryToken(ConnectorSyncOutboxEntity),
    );
  });

  beforeEach(async () => {
    await storageService.clearAll();
    await syncItemRepo.clear();
    await syncOutboxRepo.clear();
    docStorage.clear();
    publishedJobs.length = 0;
    relayService.setQueuePublisher(mockPublisher);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  /* Scenario 1: Initial selection persisting sync items and outbox records */
  it('Scenario 1: Initial selection atomically persists sync items and pending outbox records', async () => {
    const conn = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'ws-scenario-1',
      externalAccountName: 'Scenario 1 Workspace',
      connectedByUserId: 'admin-usr',
      authType: ConnectorAuthType.OAUTH2,
      credentialPayload: { accessToken: 'secret_scenario_1' },
    });

    const result = await persistenceService.saveSelectedPagesAndEnqueueSync(
      'notion',
      ['page-alpha', 'page-beta'],
    );

    expect(result.selectedCount).toBe(2);
    expect(result.selectedPageIds).toEqual(['page-alpha', 'page-beta']);

    /* Verify sync items */
    const syncItems = await syncItemRepo.find({
      where: { connectionId: conn.id },
      order: { externalResourceId: 'ASC' },
    });
    expect(syncItems).toHaveLength(2);
    expect(syncItems[0]!.externalResourceId).toBe('page-alpha');
    expect(syncItems[0]!.status).toBe(ConnectorSyncItemStatus.PENDING);
    expect(syncItems[0]!.attemptCount).toBe(0);
    expect(syncItems[1]!.externalResourceId).toBe('page-beta');
    expect(syncItems[1]!.status).toBe(ConnectorSyncItemStatus.PENDING);

    /* Verify outbox records */
    const outboxRecords = await syncOutboxRepo.find({
      where: { connectionId: conn.id },
      order: { externalResourceId: 'ASC' },
    });
    expect(outboxRecords).toHaveLength(2);
    expect(outboxRecords[0]!.externalResourceId).toBe('page-alpha');
    expect(outboxRecords[0]!.status).toBe('pending');
    expect(outboxRecords[1]!.externalResourceId).toBe('page-beta');
    expect(outboxRecords[1]!.status).toBe('pending');
  });

  /* Scenario 2: Outbox relay dispatching deterministic BullMQ jobs */
  it('Scenario 2: Outbox relay drains pending records to BullMQ with deterministic IDs and W3C trace context', async () => {
    const traceSpy = jest
      .spyOn(TraceContextPropagator, 'injectToCarrier')
      .mockImplementation((target: any = {}) => {
        target.traceparent =
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
        return target;
      });

    const conn = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'ws-scenario-2',
      externalAccountName: 'Scenario 2 Workspace',
      connectedByUserId: 'admin-usr',
      credentialPayload: { accessToken: 'secret_scenario_2' },
    });

    await persistenceService.saveSelectedPagesAndEnqueueSync('notion', [
      'page-relay-1',
    ]);

    const dispatchedCount = await relayService.pollAndPublish(10);
    expect(dispatchedCount).toBe(1);

    /* Verify queue publisher received deterministic job */
    expect(mockPublisher.publishSyncJob).toHaveBeenCalledTimes(1);
    const expectedJobId = `sync:${conn.id}:page-relay-1`;
    expect(publishedJobs[0]!.jobId).toBe(expectedJobId);
    expect(publishedJobs[0]!.payload.connectionId).toBe(conn.id);
    expect(publishedJobs[0]!.payload.externalResourceId).toBe('page-relay-1');
    expect(publishedJobs[0]!.payload.traceparent).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
    expect(publishedJobs[0]!.payload.outboxEventId).toBeDefined();

    /* Verify outbox status in DB */
    const outbox = await syncOutboxRepo.findOne({
      where: { connectionId: conn.id, externalResourceId: 'page-relay-1' },
    });
    expect(outbox?.status).toBe('published');
    expect(outbox?.publishedAt).toBeInstanceOf(Date);

    traceSpy.mockRestore();
  });

  /* Scenario 3: Unchanged content producing no-op sync without calling document storage */
  it('Scenario 3: Unchanged content results in NO_OP without calling document storage', async () => {
    const conn = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'ws-scenario-3',
      externalAccountName: 'Scenario 3 Workspace',
      connectedByUserId: 'admin-usr',
      credentialPayload: { accessToken: 'secret_scenario_3' },
    });

    await persistenceService.saveSelectedPagesAndEnqueueSync('notion', [
      'page-unchanged',
    ]);
    const syncItem = await syncItemRepo.findOneOrFail({
      where: { connectionId: conn.id, externalResourceId: 'page-unchanged' },
    });

    /* Mock notionProcessor.syncResource to return NO_OP */
    const syncSpy = jest
      .spyOn(notionProcessor, 'syncResource')
      .mockResolvedValueOnce({
        status: 'NO_OP',
        externalResourceId: 'page-unchanged',
        observedRevision: '2026-10-25T10:00:00.000Z',
        contentFingerprint: 'existing-hash-123',
      });

    const storageSpy = jest.spyOn(docStorage, 'saveDocument');

    await worker.processJobData({
      syncItemId: syncItem.id,
      connectionId: conn.id,
      provider: 'notion',
      externalResourceId: 'page-unchanged',
      resourceType: 'page',
    });

    expect(storageSpy).not.toHaveBeenCalled();

    const updatedItem = await syncItemRepo.findOneOrFail({
      where: { id: syncItem.id },
    });
    expect(updatedItem.status).toBe(ConnectorSyncItemStatus.COMPLETED);
    expect(updatedItem.lastSyncedAt).toBeInstanceOf(Date);
    expect(updatedItem.lastObservedRevision).toBe('2026-10-25T10:00:00.000Z');

    syncSpy.mockRestore();
  });

  /* Scenario 4: Modified content parsing into canonical Markdown and invoking document storage */
  it('Scenario 4: Modified content invokes document storage and updates stored fingerprint', async () => {
    const conn = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'ws-scenario-4',
      externalAccountName: 'Scenario 4 Workspace',
      connectedByUserId: 'admin-usr',
      credentialPayload: { accessToken: 'secret_scenario_4' },
    });

    await persistenceService.saveSelectedPagesAndEnqueueSync('notion', [
      'page-modified',
    ]);
    const syncItem = await syncItemRepo.findOneOrFail({
      where: { connectionId: conn.id, externalResourceId: 'page-modified' },
    });

    const syncSpy = jest
      .spyOn(notionProcessor, 'syncResource')
      .mockResolvedValueOnce({
        status: 'UPDATED',
        externalResourceId: 'page-modified',
        observedRevision: '2026-10-25T11:00:00.000Z',
        contentFingerprint: 'new-sha256-fingerprint',
        normalizedPayload: {
          sourceType: 'notion',
          sourceId: 'page-modified',
          sourceUrl: 'https://notion.so/page-modified',
          title: 'Modified Roadmap',
          normalizedContent: '# Modified Roadmap\nNew deliverables.',
          contentHash: 'new-sha256-fingerprint',
          sourceUpdatedAt: new Date('2026-10-25T11:00:00.000Z'),
          metadata: { parentHierarchy: [] },
        },
      });

    await worker.processJobData({
      syncItemId: syncItem.id,
      connectionId: conn.id,
      provider: 'notion',
      externalResourceId: 'page-modified',
      resourceType: 'page',
    });

    const storedDoc = docStorage.getDocument('notion', 'page-modified');
    expect(storedDoc).toBeDefined();
    expect(storedDoc?.payload.title).toBe('Modified Roadmap');
    expect(storedDoc?.payload.contentHash).toBe('new-sha256-fingerprint');

    const updatedItem = await syncItemRepo.findOneOrFail({
      where: { id: syncItem.id },
    });
    expect(updatedItem.status).toBe(ConnectorSyncItemStatus.COMPLETED);
    expect(updatedItem.lastProcessedFingerprint).toBe('new-sha256-fingerprint');
    expect(updatedItem.lastObservedRevision).toBe('2026-10-25T11:00:00.000Z');

    syncSpy.mockRestore();
  });

  /* Scenario 5: Deselection mid-flight preventing document storage invocation */
  it('Scenario 5: Deselection mid-flight discards processor result and protects document storage', async () => {
    const conn = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'ws-scenario-5',
      externalAccountName: 'Scenario 5 Workspace',
      connectedByUserId: 'admin-usr',
      credentialPayload: { accessToken: 'secret_scenario_5' },
    });

    await persistenceService.saveSelectedPagesAndEnqueueSync('notion', [
      'page-deselected',
    ]);
    const syncItem = await syncItemRepo.findOneOrFail({
      where: { connectionId: conn.id, externalResourceId: 'page-deselected' },
    });

    const storageSpy = jest.spyOn(docStorage, 'saveDocument');

    /* Deselect while processing */
    const syncSpy = jest
      .spyOn(notionProcessor, 'syncResource')
      .mockImplementation(async () => {
        /* Simulate concurrent user deselection */
        await syncItemRepo.update(syncItem.id, {
          status: ConnectorSyncItemStatus.DESELECTED,
        });
        return {
          status: 'UPDATED',
          externalResourceId: 'page-deselected',
          observedRevision: '2026-10-25T11:00:00.000Z',
          contentFingerprint: 'hash-deselected',
          normalizedPayload: {
            sourceType: 'notion',
            sourceId: 'page-deselected',
            sourceUrl: 'https://notion.so/page-deselected',
            title: 'Deselected Page',
            normalizedContent: 'Content',
            contentHash: 'hash-deselected',
            sourceUpdatedAt: new Date('2026-10-25T11:00:00.000Z'),
            metadata: { parentHierarchy: [] },
          },
        };
      });

    await worker.processJobData({
      syncItemId: syncItem.id,
      connectionId: conn.id,
      provider: 'notion',
      externalResourceId: 'page-deselected',
      resourceType: 'page',
    });

    expect(storageSpy).not.toHaveBeenCalled();

    const finalItem = await syncItemRepo.findOneOrFail({
      where: { id: syncItem.id },
    });
    expect(finalItem.status).toBe(ConnectorSyncItemStatus.DESELECTED);

    syncSpy.mockRestore();
  });

  /* Scenario 6: Confirmed provider 401 error updating connection status to REAUTH_REQUIRED */
  it('Scenario 6: Confirmed HTTP 401 error updates connection status to REAUTH_REQUIRED', async () => {
    const conn = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'ws-scenario-6',
      externalAccountName: 'Scenario 6 Workspace',
      connectedByUserId: 'admin-usr',
      credentialPayload: { accessToken: 'expired_or_revoked_token' },
    });

    await persistenceService.saveSelectedPagesAndEnqueueSync('notion', [
      'page-auth-fail',
    ]);
    const syncItem = await syncItemRepo.findOneOrFail({
      where: { connectionId: conn.id, externalResourceId: 'page-auth-fail' },
    });

    const authError: any = new Error('Notion token has been revoked or expired');
    authError.status = 401;

    const syncSpy = jest
      .spyOn(notionProcessor, 'syncResource')
      .mockRejectedValueOnce(authError);

    await worker.processJobData({
      syncItemId: syncItem.id,
      connectionId: conn.id,
      provider: 'notion',
      externalResourceId: 'page-auth-fail',
      resourceType: 'page',
    });

    /* Verify sync item failed */
    const failedItem = await syncItemRepo.findOneOrFail({
      where: { id: syncItem.id },
    });
    expect(failedItem.status).toBe(ConnectorSyncItemStatus.FAILED);
    expect(failedItem.lastError?.category).toBe('PERMANENT');

    /* Verify connection transitioned to REAUTH_REQUIRED */
    const connection = await persistenceService.getConnection('notion');
    expect(connection?.status).toBe(ConnectorConnectionStatus.REAUTH_REQUIRED);

    syncSpy.mockRestore();
  });
});
