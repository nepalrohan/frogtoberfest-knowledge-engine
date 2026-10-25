import * as crypto from 'crypto';
import { NotionConnector } from '../../src/modules/ingestion/connectors/notion/notion.connector';
import { NotionAdapter } from '../../src/modules/ingestion/connectors/notion/notion.adapter';
import { NotionClient } from '../../src/modules/ingestion/connectors/notion/notion.client';
import { NotionParser } from '../../src/modules/ingestion/normalizers/notion/notion.parser';
import { CanonicalDocumentNormalizer } from '../../src/modules/ingestion/normalizers/canonical/canonical-document.normalizer';
import { AppConfigService } from '../../src/config/configuration';

import pageSample from '../fixtures/notion/page-sample.json';
import blocksPage1 from '../fixtures/notion/blocks-page-1.json';
import blocksPage2 from '../fixtures/notion/blocks-page-2.json';
import nestedBlocks from '../fixtures/notion/nested-blocks.json';

describe('NotionConnector (End-to-End Contract)', () => {
  let connector: NotionConnector;
  let mockClient: jest.Mocked<Partial<NotionClient>>;

  const mockConfigService = {
    notion: {
      apiKey: 'test-secret-key',
      apiVersion: '2022-06-28',
      baseUrl: 'https://api.notion.com/v1',
      maxDepth: 5,
      maxRequests: 50,
    },
  } as unknown as AppConfigService;

  beforeEach(() => {
    mockClient = {
      getPage: jest.fn().mockResolvedValue(pageSample),
      getBlockChildren: jest.fn().mockImplementation(async (blockId: string, cursor?: string) => {
        if (blockId === '96d741cb-6d65-4f76-bc3c-396599b519cf' && !cursor) {
          return blocksPage1;
        }
        if (blockId === '96d741cb-6d65-4f76-bc3c-396599b519cf' && cursor === 'cursor-page-2-token') {
          return blocksPage2;
        }
        if (blockId === 'block-toggle-007') {
          return nestedBlocks;
        }
        return { object: 'list', results: [], next_cursor: null, has_more: false };
      }),
    };

    const adapter = new NotionAdapter(mockClient as NotionClient, mockConfigService);
    const parser = new NotionParser();
    const normalizer = new CanonicalDocumentNormalizer();

    connector = new NotionConnector(
      mockClient as NotionClient,
      adapter,
      parser,
      normalizer,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should normalize raw Notion fixtures into a canonical document payload conforming to the storage schema', async () => {
    const payload = await connector.processPage('96d741cb-6d65-4f76-bc3c-396599b519cf');

    // 1. Verify Canonical Document Identity & Metadata
    expect(payload.sourceType).toBe('notion');
    expect(payload.sourceId).toBe('96d741cb-6d65-4f76-bc3c-396599b519cf');
    expect(payload.title).toBe('Engineering Handbook');
    expect(payload.sourceUrl).toBe(
      'https://www.notion.so/Engineering-Handbook-96d741cb6d654f76bc3c396599b519cf',
    );
    expect(payload.sourceUpdatedAt).toEqual(new Date('2026-10-10T14:30:00.000Z'));
    expect(payload.metadata.parentHierarchy).toEqual(['Workspace']);
    expect(payload.metadata.isComplete).toBe(true);

    // 2. Verify Diagnostic Recording for Unsupported and Malformed Blocks
    expect(payload.metadata.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSUPPORTED_BLOCK_TYPE',
          level: 'warn',
          blockId: 'block-unsupported-011',
          blockType: 'image',
        }),
        expect.objectContaining({
          code: 'MALFORMED_BLOCK',
          level: 'error',
          blockId: 'block-malformed-012',
          blockType: 'heading_1',
        }),
      ]),
    );

    // 3. Verify Normalized GFM Markdown Structure
    const content = payload.normalizedContent;

    /* Frontmatter */
    expect(content).toContain('---');
    expect(content).toContain('title: "Engineering Handbook"');
    expect(content).toContain('source: "notion"');
    expect(content).toContain('updated_at: "2026-10-10T14:30:00.000Z"');

    /* Heading 1 */
    expect(content).toContain('# Introduction & Architecture');

    /* Paragraph with inline link */
    expect(content).toContain(
      'Welcome to the knowledge engine. Read the [architecture docs](https://github.com/my-project/docs) for more details.',
    );

    /* Heading 2 */
    expect(content).toContain('## Core Principles');

    /* Lists */
    expect(content).toContain('- Quality over quantity');
    expect(content).toContain('1. Step 1: Clone repo');

    /* Tasks (to-do) */
    expect(content).toContain('- [x] Verify local database connection');
    expect(content).toContain('- [ ] Run integration tests');

    /* Toggle container with nested children */
    expect(content).toContain('<details><summary>Advanced Configuration</summary>');
    expect(content).toContain('These are settings inside the toggle container.');
    expect(content).toContain('- Nested item 1');

    /* Heading 3 from page 2 */
    expect(content).toContain('### Troubleshooting Guide');

    // 4. Verify SHA-256 Content Hash Invariant
    const expectedHash = crypto
      .createHash('sha256')
      .update(payload.normalizedContent)
      .digest('hex');
    expect(payload.contentHash).toBe(expectedHash);
  });

  it('should satisfy KnowledgeConnector interface connection test and incremental methods', async () => {
    const connectionTest = await connector.testConnection();
    expect(connectionTest.success).toBe(true);

    const incremental = await connector.fetchIncremental();
    expect(incremental).toHaveProperty('items');
    expect(Array.isArray(incremental.items)).toBe(true);

    const deletions = await connector.fetchDeletions(new Date());
    expect(Array.isArray(deletions)).toBe(true);
  });
});
