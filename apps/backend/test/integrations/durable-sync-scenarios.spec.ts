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
  ConnectorAuthType,
} from '../../src/modules/connector-persistence';
import { ConnectionStorageService } from '../../src/modules/integrations/connection-storage.service';

/* Integration scenarios for durable selection; relay, worker and storage behaviour are covered by their own specs */
describe('Durable Connector Sync Scenarios (OpenSpec 6.2)', () => {
  let app: INestApplication;
  let persistenceService: ConnectorPersistenceService;
  let storageService: ConnectionStorageService;
  let syncItemRepo: Repository<ConnectorSyncItemEntity>;
  let syncOutboxRepo: Repository<ConnectorSyncOutboxEntity>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    persistenceService = app.get(ConnectorPersistenceService);
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
});
