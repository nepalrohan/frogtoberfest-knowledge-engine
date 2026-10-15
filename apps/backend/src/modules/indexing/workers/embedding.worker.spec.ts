import { EmbeddingWorker } from './embedding.worker';
import { Document, DocumentChunk } from '../../../entities';
import { Job } from 'bullmq';
import { EmbeddingJobPayload } from '../../queue/queue.constants';

describe('EmbeddingWorker (Phase 6)', () => {
  let worker: EmbeddingWorker;
  let mockDataSource: any;
  let mockEmbeddingProvider: any;
  let mockChunker: any;
  let mockConfig: any;

  let mockDocRepo: any;
  let mockChunkRepo: any;
  let mockQueryBuilder: any;
  let mockManager: any;

  beforeEach(() => {
    mockDocRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockChunkRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn().mockImplementation((dto) => ({ id: 'chunk-uuid', ...dto })),
      save: jest.fn().mockResolvedValue([]),
    };

    mockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === DocumentChunk) return mockChunkRepo;
        if (entity === Document) return mockDocRepo;
        return null;
      }),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };

    mockDataSource = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === Document) return mockDocRepo;
        if (entity === DocumentChunk) return mockChunkRepo;
        return null;
      }),
      transaction: jest.fn().mockImplementation(async (callback) => {
        return await callback(mockManager);
      }),
    };

    mockEmbeddingProvider = {
      embed: jest.fn(),
      getDimension: jest.fn().mockReturnValue(768),
      getProviderName: jest.fn().mockReturnValue('ollama'),
    };

    mockChunker = {
      chunk: jest.fn(),
    };

    mockConfig = {
      redis: { host: 'localhost', port: 6379 },
      embedding: { providerType: 'ollama' },
    };

    worker = new EmbeddingWorker(
      mockDataSource,
      mockEmbeddingProvider,
      mockChunker,
      mockConfig,
    );
  });

  /* Verifies standard successful chunking, embedding, and atomic chunk upsert */
  it('should process job, chunk document, generate embeddings, and mark document indexed', async () => {
    const mockDoc: Document = {
      id: 'doc-uuid-1',
      sourceType: 'upload',
      sourceId: 'file-1',
      title: 'Guide',
      normalizedContent: '# Guide\n\nContent here',
      contentHash: 'hash1',
      version: 1,
      syncStatus: 'pending_embedding',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDocRepo.findOne.mockResolvedValue(mockDoc);
    mockQueryBuilder.getOne.mockResolvedValue({ ...mockDoc });

    mockChunker.chunk.mockReturnValue([
      {
        content: '# Guide',
        chunkIndex: 0,
        tokenCount: 10,
        metadata: { sectionHeaders: ['Guide'], sectionTitle: 'Guide', tokenCount: 10 },
      },
      {
        content: 'Content here',
        chunkIndex: 1,
        tokenCount: 8,
        metadata: { sectionHeaders: ['Guide'], sectionTitle: 'Guide', tokenCount: 8 },
      },
    ]);

    mockEmbeddingProvider.embed.mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);

    const mockJob = {
      id: 'job-1',
      data: {
        documentId: 'doc-uuid-1',
        documentVersion: 1,
        sourceType: 'upload',
        title: 'Guide',
        traceCarrier: {},
      },
    } as unknown as Job<EmbeddingJobPayload>;

    await worker.process(mockJob);

    expect(mockDocRepo.findOne).toHaveBeenCalledWith({ where: { id: 'doc-uuid-1' } });
    expect(mockChunker.chunk).toHaveBeenCalledWith(mockDoc.normalizedContent);
    expect(mockEmbeddingProvider.embed).toHaveBeenCalledWith(['# Guide', 'Content here']);

    expect(mockChunkRepo.delete).toHaveBeenCalledWith({ documentId: 'doc-uuid-1' });
    expect(mockChunkRepo.save).toHaveBeenCalledTimes(1);
    expect(mockManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-uuid-1',
        syncStatus: 'indexed',
      }),
    );
  });

  /* Verifies Stale Job Guard prevents older jobs from overwriting newer document versions */
  it('should abort and skip processing when document in DB has newer version than job', async () => {
    const existingDoc: Document = {
      id: 'doc-uuid-2',
      sourceType: 'notion',
      sourceId: 'page-1',
      title: 'Outdated Page',
      normalizedContent: 'New version 2 content',
      contentHash: 'hash2',
      version: 2, // Already at v2!
      syncStatus: 'pending_embedding',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDocRepo.findOne.mockResolvedValue(existingDoc);

    const staleJob = {
      id: 'job-stale-v1',
      data: {
        documentId: 'doc-uuid-2',
        documentVersion: 1, // Stale job version 1!
        sourceType: 'notion',
        title: 'Outdated Page',
      },
    } as unknown as Job<EmbeddingJobPayload>;

    await worker.process(staleJob);

    /* Chunker, embedding provider, and delete should NEVER be called for stale jobs */
    expect(mockChunker.chunk).not.toHaveBeenCalled();
    expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
    expect(mockChunkRepo.delete).not.toHaveBeenCalled();
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });

  /* Verifies graceful skip when document was deleted before worker executes */
  it('should skip job if document no longer exists in database', async () => {
    mockDocRepo.findOne.mockResolvedValue(null);

    const mockJob = {
      id: 'job-deleted-doc',
      data: {
        documentId: 'doc-deleted-uuid',
        documentVersion: 1,
        sourceType: 'upload',
        title: 'Deleted Doc',
      },
    } as unknown as Job<EmbeddingJobPayload>;

    await worker.process(mockJob);

    expect(mockChunker.chunk).not.toHaveBeenCalled();
    expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
    expect(mockDataSource.transaction).not.toHaveBeenCalled();
  });

  /* Verifies error re-thrown when embedding provider fails so BullMQ can retry */
  it('should rethrow error when embedding provider fails', async () => {
    const mockDoc: Document = {
      id: 'doc-uuid-err',
      sourceType: 'upload',
      sourceId: 'file-err',
      title: 'Error Doc',
      normalizedContent: 'Error Content',
      contentHash: 'hasherr',
      version: 1,
      syncStatus: 'pending_embedding',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDocRepo.findOne.mockResolvedValue(mockDoc);
    mockChunker.chunk.mockReturnValue([
      { content: 'Error Content', chunkIndex: 0, tokenCount: 5, metadata: { sectionHeaders: [] } },
    ]);
    mockEmbeddingProvider.embed.mockRejectedValue(new Error('Ollama service unavailable'));

    const mockJob = {
      id: 'job-err',
      data: {
        documentId: 'doc-uuid-err',
        documentVersion: 1,
        sourceType: 'upload',
        title: 'Error Doc',
      },
    } as unknown as Job<EmbeddingJobPayload>;

    await expect(worker.process(mockJob)).rejects.toThrow('Ollama service unavailable');
    expect(mockChunkRepo.delete).not.toHaveBeenCalled();
  });
});
