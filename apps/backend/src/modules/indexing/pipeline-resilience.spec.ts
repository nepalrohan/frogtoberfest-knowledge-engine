import { IngestionService } from '../ingestion/ingestion.service';
import { MarkdownNormalizer } from '../ingestion/normalizer/markdown-normalizer';
import { OutboxRelayService } from './outbox.relay';
import { MarkdownChunker } from './chunker/markdown-chunker';
import { EmbeddingWorker } from './workers/embedding.worker';
import { Document, EmbeddingOutbox, DocumentChunk } from '../../entities';
import { Job } from 'bullmq';
import { EmbeddingJobPayload } from '../queue/queue.constants';

describe('Pipeline Resilience & Integration Suite (Phase 7)', () => {
  let normalizer: MarkdownNormalizer;
  let chunker: MarkdownChunker;
  let mockEmbeddingProvider: any;
  let mockQueue: any;
  let mockConfig: any;

  /* In-memory datastore representing PostgreSQL tables */
  let documentsStore: Map<string, Document>;
  let outboxStore: Map<string, EmbeddingOutbox>;
  let chunksStore: Map<string, DocumentChunk[]>;

  let mockDataSource: any;
  let ingestionService: IngestionService;
  let outboxRelayService: OutboxRelayService;
  let embeddingWorker: EmbeddingWorker;

  beforeEach(() => {
    documentsStore = new Map();
    outboxStore = new Map();
    chunksStore = new Map();

    normalizer = new MarkdownNormalizer();
    chunker = new MarkdownChunker();

    mockEmbeddingProvider = {
      embed: jest.fn().mockImplementation(async (texts: string[]) => {
        return texts.map(() => [0.123, 0.456, 0.789]);
      }),
      getDimension: jest.fn().mockReturnValue(3),
      getProviderName: jest.fn().mockReturnValue('ollama'),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'bullmq-job-uuid' }),
    };

    mockConfig = {
      redis: { host: 'localhost', port: 6379 },
      embedding: { providerType: 'ollama', dimension: 3 },
    };

    /* In-memory mock repositories simulating ACID TypeORM operations */
    const createMockManager = () => ({
      getRepository: (entity: any) => {
        if (entity === Document) {
          return {
            findOne: jest.fn().mockImplementation(async ({ where }: any) => {
              if (where.id) return documentsStore.get(where.id) || null;
              if (where.sourceType && where.sourceId) {
                return (
                  Array.from(documentsStore.values()).find(
                    (d) => d.sourceType === where.sourceType && d.sourceId === where.sourceId,
                  ) || null
                );
              }
              return null;
            }),
            create: jest.fn().mockImplementation((dto: any) => ({
              id: 'doc-uuid-1',
              createdAt: new Date(),
              updatedAt: new Date(),
              ...dto,
            })),
            save: jest.fn().mockImplementation(async (entity: Document) => {
              documentsStore.set(entity.id, { ...entity });
              return entity;
            }),
          };
        }
        if (entity === EmbeddingOutbox) {
          return {
            create: jest.fn().mockImplementation((dto: any) => ({
              id: `outbox-${Date.now()}`,
              createdAt: new Date(),
              retryCount: 0,
              ...dto,
            })),
            save: jest.fn().mockImplementation(async (entity: EmbeddingOutbox) => {
              outboxStore.set(entity.id, { ...entity });
              return entity;
            }),
          };
        }
        if (entity === DocumentChunk) {
          return {
            delete: jest.fn().mockImplementation(async ({ documentId }: any) => {
              chunksStore.delete(documentId);
              return { affected: 1 };
            }),
            create: jest.fn().mockImplementation((dto: any) => ({
              id: `chunk-${Math.random()}`,
              createdAt: new Date(),
              ...dto,
            })),
            save: jest.fn().mockImplementation(async (entities: DocumentChunk[]) => {
              if (entities.length > 0 && entities[0]) {
                const docId = entities[0].documentId;
                chunksStore.set(docId, [...entities]);
              }
              return entities;
            }),
          };
        }
        return null;
      },
      createQueryBuilder: (_entity: any, alias: string) => {
        if (alias === 'outbox') {
          return {
            setLock: jest.fn().mockReturnThis(),
            setOnLocked: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockImplementation(async () => {
              return Array.from(outboxStore.values()).filter((e) => e.status === 'pending');
            }),
          };
        }
        if (alias === 'doc') {
          return {
            setLock: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockImplementation(async () => {
              return Array.from(documentsStore.values())[0] || null;
            }),
          };
        }
        return {};
      },
      save: jest.fn().mockImplementation(async (entity: any) => {
        if (Array.isArray(entity)) {
          for (const item of entity) {
            if (item.documentId && item.eventType) {
              outboxStore.set(item.id, { ...item });
            }
          }
          return entity;
        }
        if (entity.documentId && entity.eventType) {
          outboxStore.set(entity.id, { ...entity });
        } else if (entity.title && entity.version !== undefined) {
          documentsStore.set(entity.id, { ...entity });
        }
        return entity;
      }),
    });

    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (callback: any) => {
        return await callback(createMockManager());
      }),
      getRepository: (entity: any) => createMockManager().getRepository(entity),
    };

    ingestionService = new IngestionService(mockDataSource, normalizer);
    outboxRelayService = new OutboxRelayService(mockDataSource, mockQueue);
    embeddingWorker = new EmbeddingWorker(
      mockDataSource,
      mockEmbeddingProvider,
      chunker,
      mockConfig,
    );
  });

  /* Scenario 1: Full vertical slice test from upload to vector persistence */
  it('should successfully execute the full pipeline from ingestion to outbox relay to vector indexing', async () => {
    // Step 1: Ingest document
    const ingestResult = await ingestionService.ingestDocument({
      sourceType: 'notion',
      sourceId: 'page-101',
      title: 'Production Runbook',
      rawContent: `# Production Runbook\n\n## Incident Management\n\nFollow standard escalation matrix.`,
    });

    expect(ingestResult.version).toBe(1);
    expect(ingestResult.syncStatus).toBe('pending_embedding');
    expect(ingestResult.outboxEnqueued).toBe(true);
    expect(outboxStore.size).toBe(1);

    // Step 2: Outbox relay poll and dispatch
    const publishedCount = await outboxRelayService.pollAndPublishOutbox(50);
    expect(publishedCount).toBe(1);

    const outboxItem = Array.from(outboxStore.values())[0];
    expect(outboxItem).toBeDefined();
    expect(outboxItem!.status).toBe('published');
    expect(outboxItem!.publishedAt).toBeInstanceOf(Date);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'embed-document',
      expect.objectContaining({
        documentId: ingestResult.documentId,
        documentVersion: 1,
      }),
      expect.objectContaining({
        jobId: `embed:${ingestResult.documentId}:1`,
        attempts: 4,
      }),
    );

    // Step 3: Worker processes embedding job
    const workerJob = {
      id: `embed:${ingestResult.documentId}:1`,
      data: {
        documentId: ingestResult.documentId,
        documentVersion: 1,
        sourceType: 'notion',
        title: 'Production Runbook',
      },
    } as unknown as Job<EmbeddingJobPayload>;

    await embeddingWorker.process(workerJob);

    // Verify document status updated to indexed
    const savedDoc = documentsStore.get(ingestResult.documentId);
    expect(savedDoc?.syncStatus).toBe('indexed');

    // Verify chunks and vectors persisted
    const savedChunks = chunksStore.get(ingestResult.documentId);
    expect(savedChunks).toBeDefined();
    expect(savedChunks!.length).toBeGreaterThan(0);
    expect(savedChunks![0]!.embedding).toContain('[0.123,0.456,0.789]');
    expect(savedChunks![0]!.metadata).toHaveProperty('sectionHeaders');
  });

  /* Scenario 2: Out-of-order version race condition test (verifying v1 aborts after v2) */
  it('should abort stale v1 job when database document is already at v2', async () => {
    // Prepare document at version 2
    const docId = 'doc-race-condition';
    const v2Doc: Document = {
      id: docId,
      sourceType: 'confluence',
      sourceId: 'conf-200',
      title: 'API Spec',
      normalizedContent: '# API Spec v2\n\nUpdated endpoints.',
      contentHash: 'hash-v2',
      version: 2,
      syncStatus: 'pending_embedding',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    documentsStore.set(docId, v2Doc);

    // Simulated v2 chunks already present
    chunksStore.set(docId, [
      {
        id: 'chunk-v2',
        documentId: docId,
        chunkIndex: 0,
        documentVersion: 2,
        content: 'v2 content',
        embedding: '[0.999]',
        tokenCount: 5,
        metadata: {},
        createdAt: new Date(),
      },
    ]);

    // Late arriving v1 job
    const staleJobV1 = {
      id: `embed:${docId}:1`,
      data: {
        documentId: docId,
        documentVersion: 1, // Stale!
        sourceType: 'confluence',
        title: 'API Spec',
      },
    } as unknown as Job<EmbeddingJobPayload>;

    await embeddingWorker.process(staleJobV1);

    // Verify v2 chunks were NOT overwritten
    const preservedChunks = chunksStore.get(docId);
    expect(preservedChunks).toBeDefined();
    expect(preservedChunks![0]!.documentVersion).toBe(2);
    expect(preservedChunks![0]!.content).toBe('v2 content');
    expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
  });

  /* Scenario 3: Deduplication test (identical content does not emit outbox event) */
  it('should skip outbox enqueue and preserve document version when content has not changed', async () => {
    const rawContent = '# Static Architecture\n\nNo modifications here.';

    // First ingestion
    const firstResult = await ingestionService.ingestDocument({
      sourceType: 'upload',
      sourceId: 'static-file',
      title: 'Static Architecture',
      rawContent,
    });
    expect(firstResult.version).toBe(1);
    expect(firstResult.outboxEnqueued).toBe(true);

    const initialOutboxSize = outboxStore.size;

    // Second ingestion with identical content
    const secondResult = await ingestionService.ingestDocument({
      sourceType: 'upload',
      sourceId: 'static-file',
      title: 'Static Architecture',
      rawContent,
    });

    expect(secondResult.version).toBe(1);
    expect(secondResult.isNewOrUpdated).toBe(false);
    expect(secondResult.outboxEnqueued).toBe(false);
    expect(outboxStore.size).toBe(initialOutboxSize);
  });
});
