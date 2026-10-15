import { OutboxRelayService } from './outbox.relay';
import { EmbeddingOutbox } from '../../entities';

describe('OutboxRelayService (Phase 3)', () => {
  let service: OutboxRelayService;

  let mockQueue: {
    add: jest.Mock;
  };

  let mockQueryBuilder: {
    setLock: jest.Mock;
    setOnLocked: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
  };

  let mockManager: {
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
  };

  let mockDataSource: {
    transaction: jest.Mock;
  };

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'bullmq-job-1' }),
    };

    mockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      save: jest.fn().mockResolvedValue(true),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (callback) => {
        return await callback(mockManager);
      }),
    };

    service = new OutboxRelayService(mockDataSource as any, mockQueue as any);
  });

  /* Verifies zero publishes when outbox table has no pending entries */
  it('should return 0 and skip queue dispatch when no pending events exist', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([]);

    const publishedCount = await service.pollAndPublishOutbox(50);

    expect(publishedCount).toBe(0);
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockManager.save).not.toHaveBeenCalled();
  });

  /* Verifies pessimistic row locking and deterministic BullMQ job ID dispatch */
  it('should lock pending rows, enqueue to BullMQ with deterministic ID, and mark published', async () => {
    const mockEvent: EmbeddingOutbox = {
      id: 'outbox-uuid-1',
      documentId: 'doc-uuid-1',
      documentVersion: 1,
      eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
      payload: {
        documentId: 'doc-uuid-1',
        documentVersion: 1,
        sourceType: 'upload',
        title: 'System Design',
      },
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
    };

    mockQueryBuilder.getMany.mockResolvedValue([mockEvent]);

    const publishedCount = await service.pollAndPublishOutbox(50);

    expect(publishedCount).toBe(1);
    expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(mockQueryBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'embed-document',
      mockEvent.payload,
      expect.objectContaining({
        jobId: 'embed:doc-uuid-1:1',
        attempts: 4,
      }),
    );

    expect(mockEvent.status).toBe('published');
    expect(mockEvent.publishedAt).toBeInstanceOf(Date);
    expect(mockManager.save).toHaveBeenCalledWith([mockEvent]);
  });

  /* Verifies error handling when BullMQ publish fails */
  it('should record error and increment retry count when queue publish throws', async () => {
    const mockEvent: EmbeddingOutbox = {
      id: 'outbox-uuid-2',
      documentId: 'doc-uuid-2',
      documentVersion: 2,
      eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
      payload: {
        documentId: 'doc-uuid-2',
        documentVersion: 2,
        sourceType: 'text',
        title: 'Error Doc',
      },
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
    };

    mockQueryBuilder.getMany.mockResolvedValue([mockEvent]);
    mockQueue.add.mockRejectedValue(new Error('Redis connection lost'));

    const count = await service.pollAndPublishOutbox(50);

    expect(count).toBe(1);
    expect(mockEvent.retryCount).toBe(1);
    expect(mockEvent.errorMessage).toBe('Redis connection lost');
    expect(mockManager.save).toHaveBeenCalledWith([mockEvent]);
  });

  /* Verifies concurrent processing via p-limit and Promise.allSettled with mixed outcomes */
  it('should dispatch multiple events concurrently using Promise.allSettled and handle mixed results', async () => {
    const successEvent: EmbeddingOutbox = {
      id: 'outbox-1',
      documentId: 'doc-1',
      documentVersion: 1,
      eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
      payload: { documentId: 'doc-1', documentVersion: 1, sourceType: 'upload', title: 'Doc 1' },
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
    };

    const failEvent: EmbeddingOutbox = {
      id: 'outbox-2',
      documentId: 'doc-2',
      documentVersion: 1,
      eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
      payload: { documentId: 'doc-2', documentVersion: 1, sourceType: 'upload', title: 'Doc 2' },
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
    };

    mockQueryBuilder.getMany.mockResolvedValue([successEvent, failEvent]);
    mockQueue.add.mockImplementation(async (_jobName, payload) => {
      if (payload.documentId === 'doc-2') {
        throw new Error('Redis timeout');
      }
      return { id: 'job-1' };
    });

    const count = await service.pollAndPublishOutbox(50);

    expect(count).toBe(2);
    expect(successEvent.status).toBe('published');
    expect(successEvent.publishedAt).toBeInstanceOf(Date);
    expect(failEvent.status).toBe('pending');
    expect(failEvent.retryCount).toBe(1);
    expect(failEvent.errorMessage).toBe('Redis timeout');
    expect(mockManager.save).toHaveBeenCalledWith([successEvent, failEvent]);
  });
});
