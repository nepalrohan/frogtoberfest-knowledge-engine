import { Test, TestingModule } from '@nestjs/testing';
import { NotionClient } from './notion.client';
import { AppConfigService } from '../../../../config/configuration';
import pageSample from '../../../../../test/fixtures/notion/page-sample.json';
import blocksPage1 from '../../../../../test/fixtures/notion/blocks-page-1.json';
import blocksPage2 from '../../../../../test/fixtures/notion/blocks-page-2.json';
import nestedBlocks from '../../../../../test/fixtures/notion/nested-blocks.json';
import { NotionPageResponse, NotionBlockChildrenResponse } from '../../types';
import { NotionAdapter } from './notion.adapter';

describe('NotionAdapter', () => {
  let adapter: NotionAdapter;
  let mockClient: jest.Mocked<Partial<NotionClient>>;

  const mockConfigService = {
    notion: {
      apiKey: 'test-key',
      apiVersion: '2022-06-28',
      baseUrl: 'https://api.notion.com/v1',
      maxDepth: 5,
      maxRequests: 50,
    },
  };

  beforeEach(async () => {
    mockClient = {
      getPage: jest.fn(),
      getBlockChildren: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionAdapter,
        {
          provide: NotionClient,
          useValue: mockClient,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    adapter = module.get<NotionAdapter>(NotionAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should retrieve page metadata and paginated blocks recursively with completeness', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValueOnce(pageSample as NotionPageResponse);

    /* Page 1 of blocks has has_more: true */
    (mockClient.getBlockChildren as jest.Mock).mockImplementation(
      async (blockId: string, cursor?: string) => {
        if (blockId === '96d741cb-6d65-4f76-bc3c-396599b519cf' && !cursor) {
          return blocksPage1 as NotionBlockChildrenResponse;
        }
        if (blockId === '96d741cb-6d65-4f76-bc3c-396599b519cf' && cursor === 'cursor-page-2-token') {
          return blocksPage2 as NotionBlockChildrenResponse;
        }
        if (blockId === 'block-toggle-007') {
          return nestedBlocks as NotionBlockChildrenResponse;
        }
        return { object: 'list', results: [], next_cursor: null, has_more: false };
      },
    );

    const result = await adapter.fetchDocument('96d741cb-6d65-4f76-bc3c-396599b519cf');

    expect(result.page.id).toBe('96d741cb-6d65-4f76-bc3c-396599b519cf');
    expect(result.isComplete).toBe(true);
    expect(result.totalRequests).toBe(4); // 1 getPage + 2 getBlockChildren for page + 1 getBlockChildren for toggle
    expect(result.rootBlocks).toHaveLength(12); // 7 from page 1 + 5 from page 2

    /* Verify nested toggle block has its children attached */
    const toggleBlock = result.rootBlocks.find((b) => b.id === 'block-toggle-007');
    expect(toggleBlock).toBeDefined();
    expect(toggleBlock?.children).toHaveLength(2);
    expect(toggleBlock?.children?.[0]?.id).toBe('block-nested-p-013');
  });

  it('should enforce maxDepth safeguard and mark retrieval incomplete with diagnostic', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValueOnce(pageSample as NotionPageResponse);
    (mockClient.getBlockChildren as jest.Mock).mockResolvedValueOnce({
      object: 'list',
      results: [
        {
          id: 'depth-1',
          type: 'toggle',
          has_children: true,
          toggle: { rich_text: [] },
        },
      ],
      next_cursor: null,
      has_more: false,
    });

    /* Configure adapter with maxDepth: 0 (no recursive descent) */
    (adapter as any).maxDepth = 0;

    const result = await adapter.fetchDocument('96d741cb-6d65-4f76-bc3c-396599b519cf');

    expect(result.isComplete).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MAX_DEPTH_REACHED',
          level: 'warn',
          blockId: 'depth-1',
        }),
      ]),
    );
    expect(mockClient.getBlockChildren).toHaveBeenCalledTimes(1);
  });

  it('should enforce maxRequests budget safeguard and halt traversal', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValueOnce(pageSample as NotionPageResponse);
    (mockClient.getBlockChildren as jest.Mock).mockResolvedValueOnce({
      object: 'list',
      results: blocksPage1.results,
      next_cursor: 'cursor-2',
      has_more: true,
    });

    /* Configure adapter with maxRequests = 2 (1 getPage + 1 getBlockChildren exhausts budget) */
    (adapter as any).maxRequests = 2;

    const result = await adapter.fetchDocument('96d741cb-6d65-4f76-bc3c-396599b519cf');

    expect(result.isComplete).toBe(false);
    expect(result.totalRequests).toBe(2);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'REQUEST_BUDGET_EXCEEDED',
          level: 'warn',
        }),
      ]),
    );
    /* Did not fetch cursor-2 or toggle children */
    expect(mockClient.getBlockChildren).toHaveBeenCalledTimes(1);
  });

  it('should record diagnostic and mark incomplete on child branch fetch failure', async () => {
    (mockClient.getPage as jest.Mock).mockResolvedValueOnce(pageSample as NotionPageResponse);
    (mockClient.getBlockChildren as jest.Mock)
      .mockResolvedValueOnce({
        object: 'list',
        results: [
          {
            id: 'failing-toggle',
            type: 'toggle',
            has_children: true,
            toggle: { rich_text: [] },
          },
        ],
        next_cursor: null,
        has_more: false,
      })
      .mockRejectedValueOnce(new Error('Network drop on nested children'));

    const result = await adapter.fetchDocument('96d741cb-6d65-4f76-bc3c-396599b519cf');

    expect(result.isComplete).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CHILD_RETRIEVAL_FAILED',
          level: 'error',
          blockId: 'failing-toggle',
        }),
      ]),
    );
    /* Root block is still retained */
    expect(result.rootBlocks).toHaveLength(1);
    expect(result.rootBlocks[0]?.id).toBe('failing-toggle');
  });
});
