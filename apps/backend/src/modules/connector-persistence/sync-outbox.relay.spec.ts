import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SyncOutboxRelayService, INGESTION_SYNC_QUEUE, SYNC_QUEUE_PUBLISHER } from './sync-outbox.relay';
import { ConnectorSyncOutboxEntity } from './entities/connector-sync-outbox.entity';
import { ISyncQueuePublisher } from './interfaces/sync-outbox-relay.interface';

describe('SyncOutboxRelayService', () => {
  let service: SyncOutboxRelayService;
  let mockDataSource: Partial<DataSource>;
  let mockPublisher: ISyncQueuePublisher;
  let mockQueryBuilder: any;
  let mockEntityManager: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    mockEntityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      save: jest.fn().mockImplementation((entityClass, entity) => Promise.resolve(entity)),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => cb(mockEntityManager)),
    };

    mockPublisher = {
      publishSyncJob: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncOutboxRelayService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: SYNC_QUEUE_PUBLISHER, useValue: mockPublisher },
      ],
    }).compile();

    service = module.get<SyncOutboxRelayService>(SyncOutboxRelayService);
  });

  it('should return 0 when no pending outbox records exist', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([]);

    const count = await service.pollAndPublish(10);
    expect(count).toBe(0);
    expect(mockPublisher.publishSyncJob).not.toHaveBeenCalled();
  });

  it('should publish pending events with deterministic job ID and inject trace context', async () => {
    const mockEvent: Partial<ConnectorSyncOutboxEntity> = {
      id: 'outbox-1',
      connectionId: 'conn-1',
      externalResourceId: 'page-abc',
      eventType: 'SYNC_RESOURCE',
      payload: { provider: 'notion', pageId: 'page-abc' },
      status: 'pending',
      attemptCount: 0,
      createdAt: new Date(),
    };

    mockQueryBuilder.getMany.mockResolvedValue([mockEvent]);

    const count = await service.pollAndPublish(10);
    expect(count).toBe(1);

    expect(mockPublisher.publishSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'sync:conn-1:page-abc',
        payload: expect.objectContaining({
          provider: 'notion',
          pageId: 'page-abc',
          outboxEventId: 'outbox-1',
        }),
      }),
    );

    expect(mockEvent.status).toBe('published');
    expect(mockEvent.publishedAt).toBeInstanceOf(Date);
    expect(mockEntityManager.save).toHaveBeenCalledWith(ConnectorSyncOutboxEntity, mockEvent);
  });

  it('should increment attempt count when publishing fails and mark failed after 5 attempts', async () => {
    const mockEvent: Partial<ConnectorSyncOutboxEntity> = {
      id: 'outbox-fail',
      connectionId: 'conn-1',
      externalResourceId: 'page-xyz',
      payload: {},
      status: 'pending',
      attemptCount: 4,
      createdAt: new Date(),
    };

    mockQueryBuilder.getMany.mockResolvedValue([mockEvent]);
    (mockPublisher.publishSyncJob as jest.Mock).mockRejectedValueOnce(new Error('Redis connection down'));

    const count = await service.pollAndPublish(10);
    expect(count).toBe(1);
    expect(mockEvent.attemptCount).toBe(5);
    expect(mockEvent.status).toBe('failed');
    expect(mockEntityManager.save).toHaveBeenCalledWith(ConnectorSyncOutboxEntity, mockEvent);
  });
});
