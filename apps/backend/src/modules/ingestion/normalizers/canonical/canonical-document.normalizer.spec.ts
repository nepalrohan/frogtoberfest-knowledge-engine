import * as crypto from 'crypto';
import { NeutralElement } from '../../types';
import { CanonicalDocumentNormalizer } from './canonical-document.normalizer';

describe('CanonicalDocumentNormalizer', () => {
  let normalizer: CanonicalDocumentNormalizer;

  beforeEach(() => {
    normalizer = new CanonicalDocumentNormalizer();
  });

  it('should generate valid GFM Markdown with YAML frontmatter header and compute SHA-256 hash', () => {
    const elements: NeutralElement[] = [
      {
        type: 'heading',
        level: 1,
        text: 'Engineering Handbook',
        links: [],
      },
      {
        type: 'paragraph',
        text: 'Welcome to the knowledge engine. Read the architecture docs for more details.',
        links: [{ text: 'architecture docs', url: 'https://github.com/my-project/docs' }],
      },
      {
        type: 'list_item',
        ordered: false,
        text: 'Quality over quantity',
        links: [],
      },
      {
        type: 'list_item',
        ordered: true,
        text: 'Step 1: Clone repo',
        links: [],
      },
      {
        type: 'task',
        text: 'Verify local database connection',
        checked: true,
        links: [],
      },
      {
        type: 'container',
        label: 'Advanced Configuration',
        links: [],
        children: [
          {
            type: 'paragraph',
            text: 'These are settings inside the toggle container.',
            links: [],
          },
        ],
      },
    ];

    const updatedAt = new Date('2026-10-10T14:30:00.000Z');

    const result = normalizer.normalize({
      sourceType: 'notion',
      sourceId: '96d741cb-6d65-4f76-bc3c-396599b519cf',
      sourceUrl: 'https://www.notion.so/Engineering-Handbook-96d741cb6d654f76bc3c396599b519cf',
      title: 'Engineering Handbook',
      elements,
      rawContent: JSON.stringify({ raw: true }),
      sourceUpdatedAt: updatedAt,
      metadata: {
        parentHierarchy: ['Workspace', 'Engineering'],
        isComplete: true,
      },
    });

    // 1. Verify top-level contract fields
    expect(result.sourceType).toBe('notion');
    expect(result.sourceId).toBe('96d741cb-6d65-4f76-bc3c-396599b519cf');
    expect(result.sourceUrl).toBe(
      'https://www.notion.so/Engineering-Handbook-96d741cb6d654f76bc3c396599b519cf',
    );
    expect(result.title).toBe('Engineering Handbook');
    expect(result.sourceUpdatedAt).toEqual(updatedAt);
    expect(result.metadata.parentHierarchy).toEqual(['Workspace', 'Engineering']);
    expect(result.metadata.isComplete).toBe(true);

    // 2. Verify Frontmatter Header
    expect(result.normalizedContent).toContain('---');
    expect(result.normalizedContent).toContain('title: "Engineering Handbook"');
    expect(result.normalizedContent).toContain('source: "notion"');
    expect(result.normalizedContent).toContain('updated_at: "2026-10-10T14:30:00.000Z"');

    // 3. Verify Markdown Content Formatting
    expect(result.normalizedContent).toContain('# Engineering Handbook');
    expect(result.normalizedContent).toContain(
      '[architecture docs](https://github.com/my-project/docs)',
    );
    expect(result.normalizedContent).toContain('- Quality over quantity');
    expect(result.normalizedContent).toContain('1. Step 1: Clone repo');
    expect(result.normalizedContent).toContain('- [x] Verify local database connection');
    expect(result.normalizedContent).toContain('<details><summary>Advanced Configuration</summary>');

    // 4. Verify SHA-256 Content Hash
    const expectedHash = crypto
      .createHash('sha256')
      .update(result.normalizedContent)
      .digest('hex');
    expect(result.contentHash).toBe(expectedHash);
  });

  it('should throw validation error when required fields are missing', () => {
    expect(() =>
      normalizer.normalize({
        sourceType: 'notion',
        sourceId: '',
        sourceUrl: 'https://notion.so/page',
        title: 'Title',
        elements: [],
        sourceUpdatedAt: new Date(),
      }),
    ).toThrow(/Validation failed: missing required field 'sourceId'/);

    expect(() =>
      normalizer.normalize({
        sourceType: 'notion',
        sourceId: 'id-123',
        sourceUrl: 'https://notion.so/page',
        title: '',
        elements: [],
        sourceUpdatedAt: new Date(),
      }),
    ).toThrow(/Validation failed: missing required field 'title'/);
  });
});
