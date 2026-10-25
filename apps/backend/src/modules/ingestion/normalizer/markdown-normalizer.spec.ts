import { MarkdownNormalizer } from './markdown-normalizer';

describe('MarkdownNormalizer (Phase 2)', () => {
  let normalizer: MarkdownNormalizer;

  beforeEach(() => {
    normalizer = new MarkdownNormalizer();
  });

  /* Verifies markdown cleaning, heading injection, and frontmatter synthesis */
  it('should normalize raw content and inject standardized frontmatter', () => {
    const raw = '## Introduction \r\n\r\n\r\nThis is a test paragraph.   \r\n';
    const result = normalizer.normalize(raw, {
      title: 'Guide to Knowledge Base',
      sourceType: 'upload',
      sourceId: 'doc-001',
      sourceUrl: 'https://internal.wiki/doc-001',
      sourceUpdatedAt: new Date('2026-10-12T00:00:00.000Z'),
    });

    expect(result.normalizedContent).toContain('---');
    expect(result.normalizedContent).toContain('title: "Guide to Knowledge Base"');
    expect(result.normalizedContent).toContain('source: "upload"');
    expect(result.normalizedContent).toContain('# Guide to Knowledge Base');
    expect(result.normalizedContent).toContain('## Introduction');
    expect(result.normalizedContent).toContain('This is a test paragraph.');
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  /* Verifies deterministic SHA-256 hash calculation for identical inputs */
  it('should produce identical content hash for identical inputs', () => {
    const raw = 'Sample immutable document';
    const opts = {
      title: 'Same Title',
      sourceType: 'text',
      sourceId: 'static-id',
      sourceUpdatedAt: new Date('2026-10-12T12:00:00.000Z'),
    };

    const res1 = normalizer.normalize(raw, opts);
    const res2 = normalizer.normalize(raw, opts);

    expect(res1.contentHash).toBe(res2.contentHash);
  });
});
