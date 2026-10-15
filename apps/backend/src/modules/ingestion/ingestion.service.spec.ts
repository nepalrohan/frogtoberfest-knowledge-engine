import { IngestionService } from './ingestion.service';
import { MarkdownNormalizer } from './normalizer/markdown-normalizer';
import { Document, EmbeddingOutbox } from '../../entities';

describe('IngestionService (Phase 2)', () => {
  let service: IngestionService;
  let normalizer: MarkdownNormalizer;

  let mockDocRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  let mockOutboxRepo: {
    create: jest.Mock;
    save: jest.Mock;
  };

  let mockDataSource: {
    transaction: jest.Mock;
  };

  beforeEach(() => {
    normalizer = new MarkdownNormalizer();

    mockDocRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ id: 'new-doc-uuid', ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: entity.id || 'saved-doc-uuid', ...entity })),
    };

    mockOutboxRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: 'outbox-uuid', ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'saved-outbox-uuid', ...entity })),
    };

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (callback) => {
        const mockManager = {
          getRepository: (entity: any) => {
            if (entity === Document) return mockDocRepo;
            if (entity === EmbeddingOutbox) return mockOutboxRepo;
            throw new Error(`Unexpected entity in test: ${entity.name}`);
          },
        };
        return await callback(mockManager);
      }),
    };

    service = new IngestionService(mockDataSource as any, normalizer);
  });

  /* Verifies new document creation and atomic outbox emission */
  it('should create a new document with version 1 and write a pending outbox row', async () => {
    mockDocRepo.findOne.mockResolvedValue(null);

    const result = await service.ingestDocument({
      sourceType: 'upload',
      sourceId: 'file-123',
      title: 'Guide',
      rawContent: 'Sample content',
    });

    expect(result.version).toBe(1);
    expect(result.isNewOrUpdated).toBe(true);
    expect(result.outboxEnqueued).toBe(true);

    expect(mockDocRepo.create).toHaveBeenCalled();
    expect(mockOutboxRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersion: 1,
        eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
        status: 'pending',
      }),
    );
  });

  /* Verifies content modification causes version increment and new outbox event */
  it('should increment version to 2 and emit outbox event when content changes', async () => {
    const existingDoc: Document = {
      id: 'doc-existing-id',
      sourceType: 'upload',
      sourceId: 'file-123',
      title: 'Guide',
      normalizedContent: 'Old content',
      contentHash: 'oldhash123',
      version: 1,
      syncStatus: 'indexed',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDocRepo.findOne.mockResolvedValue(existingDoc);

    const result = await service.ingestDocument({
      sourceType: 'upload',
      sourceId: 'file-123',
      title: 'Guide',
      rawContent: 'Brand new modified content',
    });

    expect(result.version).toBe(2);
    expect(result.isNewOrUpdated).toBe(true);
    expect(result.outboxEnqueued).toBe(true);
    expect(mockOutboxRepo.save).toHaveBeenCalled();
  });

  /* Verifies deduplication: unchanged content skips outbox enqueue */
  it('should skip outbox enqueue when content hash is identical to existing document', async () => {
    const rawContent = 'Identical content';
    const norm = normalizer.normalize(rawContent, {
      title: 'Guide',
      sourceType: 'upload',
      sourceId: 'file-123',
    });

    const existingDoc: Document = {
      id: 'doc-existing-id',
      sourceType: 'upload',
      sourceId: 'file-123',
      title: 'Guide',
      normalizedContent: norm.normalizedContent,
      contentHash: norm.contentHash,
      version: 1,
      syncStatus: 'indexed',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockDocRepo.findOne.mockResolvedValue(existingDoc);

    const result = await service.ingestDocument({
      sourceType: 'upload',
      sourceId: 'file-123',
      title: 'Guide',
      rawContent,
    });

    expect(result.version).toBe(1);
    expect(result.isNewOrUpdated).toBe(false);
    expect(result.outboxEnqueued).toBe(false);
    expect(mockOutboxRepo.save).not.toHaveBeenCalled();
  });
});
