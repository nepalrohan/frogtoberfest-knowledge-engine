import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncResourceWorker } from './sync-resource.worker';
import {
  ConnectorSyncItemEntity,
  ConnectorSyncItemStatus,
  ConnectorPersistenceService,
  ConnectorConnectionStatus,
} from '../../connector-persistence';
import { NotionSyncProcessor } from '../connectors/notion/notion-sync.processor';
import {
  DOCUMENT_STORAGE_SERVICE,
  IDocumentStorageService,
} from '../services/document-storage-placeholder.service';

describe('SyncResourceWorker', () => {
  let worker: SyncResourceWorker;
  let mockSyncItemRepo: Partial<Repository<ConnectorSyncItemEntity>>;
  let mockNotionProcessor: Partial<NotionSyncProcessor>;
  let mockPersistenceService: Partial<ConnectorPersistenceService>;
  let mockDocStorage: Partial<IDocumentStorageService>;

  beforeEach(async () => {
    mockSyncItemRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockNotionProcessor = {
      syncResource: jest.fn(),
    };

    mockPersistenceService = {
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    mockDocStorage = {
      saveDocument: jest.fn().mockResolvedValue({
        documentId: 'doc-1',
        version: 1,
        isNewVersion: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncResourceWorker,
        {
          provide: getRepositoryToken(ConnectorSyncItemEntity),
          useValue: mockSyncItemRepo,
        },
        { provide: NotionSyncProcessor, useValue: mockNotionProcessor },
        {
          provide: ConnectorPersistenceService,
          useValue: mockPersistenceService,
        },
        { provide: DOCUMENT_STORAGE_SERVICE, useValue: mockDocStorage },
      ],
    }).compile();

    worker = module.get<SyncResourceWorker>(SyncResourceWorker);
  });

  it('should abort immediately if resource is marked DESELECTED prior to processing', async () => {
    (mockSyncItemRepo.findOne as jest.Mock).mockResolvedValue({
      id: 'sync-item-1',
      status: ConnectorSyncItemStatus.DESELECTED,
    });

    await worker.processJobData({
      syncItemId: 'sync-item-1',
      connectionId: 'conn-1',
      provider: 'notion',
      externalResourceId: 'page-1',
      resourceType: 'page',
    });

    expect(mockNotionProcessor.syncResource).not.toHaveBeenCalled();
    expect(mockDocStorage.saveDocument).not.toHaveBeenCalled();
  });

  it('should process NO_OP sync without calling document storage', async () => {
    const item: Partial<ConnectorSyncItemEntity> = {
      id: 'sync-item-1',
      connectionId: 'conn-1',
      externalResourceId: 'page-1',
      status: ConnectorSyncItemStatus.PENDING,
      attemptCount: 0,
      lastObservedRevision: 'rev-1',
      lastProcessedFingerprint: 'hash-1',
    };

    (mockSyncItemRepo.findOne as jest.Mock).mockResolvedValue(item);
    (mockNotionProcessor.syncResource as jest.Mock).mockResolvedValue({
      status: 'NO_OP',
      externalResourceId: 'page-1',
      observedRevision: 'rev-1',
      contentFingerprint: 'hash-1',
    });

    await worker.processJobData({
      syncItemId: 'sync-item-1',
      connectionId: 'conn-1',
      provider: 'notion',
      externalResourceId: 'page-1',
      resourceType: 'page',
    });

    expect(mockDocStorage.saveDocument).not.toHaveBeenCalled();
    expect(item.status).toBe(ConnectorSyncItemStatus.COMPLETED);
    expect(item.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('should persist document to storage and update fingerprint when content is UPDATED', async () => {
    const item: Partial<ConnectorSyncItemEntity> = {
      id: 'sync-item-1',
      connectionId: 'conn-1',
      externalResourceId: 'page-1',
      status: ConnectorSyncItemStatus.PENDING,
      attemptCount: 0,
    };

    (mockSyncItemRepo.findOne as jest.Mock).mockResolvedValue(item);
    (mockNotionProcessor.syncResource as jest.Mock).mockResolvedValue({
      status: 'UPDATED',
      externalResourceId: 'page-1',
      observedRevision: 'rev-2',
      contentFingerprint: 'new-hash-2',
      normalizedPayload: {
        sourceType: 'notion',
        sourceId: 'page-1',
        title: 'Updated Page',
        contentHash: 'new-hash-2',
      },
    });

    await worker.processJobData({
      syncItemId: 'sync-item-1',
      connectionId: 'conn-1',
      provider: 'notion',
      externalResourceId: 'page-1',
      resourceType: 'page',
    });

    expect(mockDocStorage.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Updated Page',
        contentHash: 'new-hash-2',
      }),
    );
    expect(item.status).toBe(ConnectorSyncItemStatus.COMPLETED);
    expect(item.lastProcessedFingerprint).toBe('new-hash-2');
  });

  it('should discard results if resource is deselected mid-flight', async () => {
    const item: Partial<ConnectorSyncItemEntity> = {
      id: 'sync-item-1',
      status: ConnectorSyncItemStatus.PENDING,
      attemptCount: 0,
    };

    /* First findOne returns PENDING, second findOne (after processing) returns DESELECTED */
    (mockSyncItemRepo.findOne as jest.Mock)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({
        id: 'sync-item-1',
        status: ConnectorSyncItemStatus.DESELECTED,
      });

    (mockNotionProcessor.syncResource as jest.Mock).mockResolvedValue({
      status: 'UPDATED',
      externalResourceId: 'page-1',
      normalizedPayload: { title: 'Late Page' },
    });

    await worker.processJobData({
      syncItemId: 'sync-item-1',
      connectionId: 'conn-1',
      provider: 'notion',
      externalResourceId: 'page-1',
      resourceType: 'page',
    });

    expect(mockDocStorage.saveDocument).not.toHaveBeenCalled();
  });

  it('should transition connection to REAUTH_REQUIRED upon confirmed 401 error', async () => {
    const item: Partial<ConnectorSyncItemEntity> = {
      id: 'sync-item-1',
      status: ConnectorSyncItemStatus.PENDING,
      attemptCount: 0,
    };

    (mockSyncItemRepo.findOne as jest.Mock).mockResolvedValue(item);
    const authError: any = new Error('Unauthorized');
    authError.status = 401;
    (mockNotionProcessor.syncResource as jest.Mock).mockRejectedValue(authError);

    await worker.processJobData({
      syncItemId: 'sync-item-1',
      connectionId: 'conn-1',
      provider: 'notion',
      externalResourceId: 'page-1',
      resourceType: 'page',
    });

    expect(item.status).toBe(ConnectorSyncItemStatus.FAILED);
    expect(mockPersistenceService.updateStatus).toHaveBeenCalledWith(
      'notion',
      ConnectorConnectionStatus.REAUTH_REQUIRED,
    );
  });
});
