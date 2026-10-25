import { Test, TestingModule } from '@nestjs/testing';
import { NotionSyncProcessor } from './notion-sync.processor';
import { NotionClient } from './notion.client';
import { NotionAdapter } from './notion.adapter';
import { NotionParser } from '../../normalizers/notion/notion.parser';
import { CanonicalDocumentNormalizer } from '../../normalizers/canonical/canonical-document.normalizer';

describe('NotionSyncProcessor', () => {
  let processor: NotionSyncProcessor;
  let mockClient: Partial<NotionClient>;
  let mockAdapter: Partial<NotionAdapter>;
  let mockParser: Partial<NotionParser>;
  let mockNormalizer: Partial<CanonicalDocumentNormalizer>;

  beforeEach(async () => {
    mockClient = {
      getPage: jest.fn(),
    };

    mockAdapter = {
      fetchDocument: jest.fn(),
    };

    mockParser = {
      parse: jest.fn().mockReturnValue({ elements: [], diagnostics: [] }),
    };

    mockNormalizer = {
      normalize: jest.fn().mockReturnValue({
        sourceType: 'notion',
        sourceId: 'page-1',
        sourceUrl: 'https://notion.so/page-1',
        title: 'Test Title',
        normalizedContent: '# Test Title\n\nContent',
        contentHash: 'hash-abc-123',
        sourceUpdatedAt: new Date(),
        metadata: {},
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionSyncProcessor,
        { provide: NotionClient, useValue: mockClient },
        { provide: NotionAdapter, useValue: mockAdapter },
        { provide: NotionParser, useValue: mockParser },
        { provide: CanonicalDocumentNormalizer, useValue: mockNormalizer },
      ],
    }).compile();

    processor = module.get<NotionSyncProcessor>(NotionSyncProcessor);
  });

  it('Tier-1 change detection: should return NO_OP without full tree traversal when revision matches', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValue({
      id: 'page-1',
      last_edited_time: '2026-10-25T12:00:00.000Z',
    });

    const result = await processor.syncResource({
      connectionId: 'conn-1',
      externalResourceId: 'page-1',
      lastObservedRevision: '2026-10-25T12:00:00.000Z',
      lastProcessedFingerprint: 'existing-hash-123',
    });

    expect(result.status).toBe('NO_OP');
    expect(result.observedRevision).toBe('2026-10-25T12:00:00.000Z');
    expect(result.contentFingerprint).toBe('existing-hash-123');
    expect(mockAdapter.fetchDocument).not.toHaveBeenCalled();
  });

  it('Tier-2 change detection: should return NO_OP when revision differs but normalized hash matches', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValue({
      id: 'page-1',
      last_edited_time: '2026-10-25T13:00:00.000Z',
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'Test Title' }],
        },
      },
    });

    (mockAdapter.fetchDocument as jest.Mock).mockResolvedValue({
      page: { id: 'page-1' },
      rootBlocks: [],
      isComplete: true,
      diagnostics: [],
    });

    (mockNormalizer.normalize as jest.Mock).mockReturnValue({
      sourceType: 'notion',
      sourceId: 'page-1',
      sourceUrl: 'https://notion.so/page-1',
      title: 'Test Title',
      normalizedContent: '# Test Title\n\nContent',
      contentHash: 'identical-hash-456',
      sourceUpdatedAt: new Date(),
      metadata: {},
    });

    const result = await processor.syncResource({
      connectionId: 'conn-1',
      externalResourceId: 'page-1',
      lastObservedRevision: '2026-10-25T12:00:00.000Z',
      lastProcessedFingerprint: 'identical-hash-456',
    });

    expect(result.status).toBe('NO_OP');
    expect(result.observedRevision).toBe('2026-10-25T13:00:00.000Z');
    expect(result.contentFingerprint).toBe('identical-hash-456');
    expect(mockAdapter.fetchDocument).toHaveBeenCalledWith('page-1');
  });

  it('should return UPDATED when content has meaningfully changed', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValue({
      id: 'page-1',
      last_edited_time: '2026-10-25T14:00:00.000Z',
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: 'Updated Title' }],
        },
      },
    });

    (mockAdapter.fetchDocument as jest.Mock).mockResolvedValue({
      page: { id: 'page-1' },
      rootBlocks: [{ id: 'b1', type: 'paragraph' }],
      isComplete: true,
      diagnostics: [],
    });

    (mockNormalizer.normalize as jest.Mock).mockReturnValue({
      sourceType: 'notion',
      sourceId: 'page-1',
      sourceUrl: 'https://notion.so/page-1',
      title: 'Updated Title',
      normalizedContent: '# Updated Title\n\nNew Content',
      contentHash: 'brand-new-hash-789',
      sourceUpdatedAt: new Date(),
      metadata: {},
    });

    const result = await processor.syncResource({
      connectionId: 'conn-1',
      externalResourceId: 'page-1',
      lastObservedRevision: '2026-10-25T12:00:00.000Z',
      lastProcessedFingerprint: 'old-hash-123',
    });

    expect(result.status).toBe('UPDATED');
    expect(result.observedRevision).toBe('2026-10-25T14:00:00.000Z');
    expect(result.contentFingerprint).toBe('brand-new-hash-789');
    expect(result.normalizedPayload?.title).toBe('Updated Title');
  });

  it('should return FAILED when client throws', async () => {
    (mockClient.getPage as jest.Mock).mockRejectedValue(new Error('Rate limit exceeded 429'));

    const result = await processor.syncResource({
      connectionId: 'conn-1',
      externalResourceId: 'page-1',
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toContain('Rate limit exceeded 429');
  });
});
