import { MarkdownChunker } from './markdown-chunker';

describe('MarkdownChunker (Phase 4)', () => {
  let chunker: MarkdownChunker;

  beforeEach(() => {
    chunker = new MarkdownChunker();
  });

  /* Verifies empty or whitespace text returns empty array */
  it('should return an empty array for empty or whitespace content', () => {
    expect(chunker.chunk('')).toEqual([]);
    expect(chunker.chunk('   \n\n  ')).toEqual([]);
  });

  /* Verifies basic chunking with token count and sequential index */
  it('should chunk simple markdown and provide sequential chunkIndex and tokenCount', () => {
    const markdown = `# Architecture Overview\n\nThe Knowledge Engine is an internal RAG assistant.`;
    const chunks = chunker.chunk(markdown, { maxChunkSize: 500 });

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
    expect(chunks[0]!.metadata.sectionHeaders).toEqual(['Architecture Overview']);
    expect(chunks[0]!.metadata.sectionTitle).toBe('Architecture Overview');
    expect(chunks[0]!.content).toContain('Architecture Overview');
  });

  /* Verifies hierarchical header breadcrumbs (# -> ## -> ###) */
  it('should track nested header hierarchy in metadata', () => {
    const markdown = `
# Engineering Guide
General engineering principles.

## Database
Database patterns.

### Connection Pooling
Configure maximum connections in TypeORM.
`;

    const chunks = chunker.chunk(markdown, { maxChunkSize: 500 });

    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const poolChunk = chunks.find((c) => c.content.includes('Connection Pooling'));
    expect(poolChunk).toBeDefined();
    expect(poolChunk?.metadata.sectionHeaders).toEqual([
      'Engineering Guide',
      'Database',
      'Connection Pooling',
    ]);
    expect(poolChunk?.metadata.sectionTitle).toBe('Connection Pooling');
  });

  /* Verifies fenced code blocks are preserved intact */
  it('should preserve fenced code blocks without splitting them', () => {
    const markdown = `
# Redis Setup

Here is how to configure BullMQ:

\`\`\`typescript
const queue = new Queue('embedding-queue', {
  connection: { host: 'localhost', port: 6379 },
});
\`\`\`

More explanations after the code block.
`;

    const chunks = chunker.chunk(markdown, { maxChunkSize: 600 });
    const codeChunk = chunks.find((c) => c.content.includes('```typescript'));

    expect(codeChunk).toBeDefined();
    expect(codeChunk?.content).toContain('```typescript');
    expect(codeChunk?.content).toContain('const queue = new Queue');
    expect(codeChunk?.content).toContain('```');
  });

  /* Verifies headers inside code blocks are not treated as markdown headings */
  it('should ignore markdown headings inside code blocks', () => {
    const markdown = `
# Main Title

\`\`\`bash
# This is a comment inside bash script
echo "Hello World"
\`\`\`
`;

    const chunks = chunker.chunk(markdown);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.metadata.sectionHeaders).toEqual(['Main Title']);
  });

  /* Verifies splitting oversized sections with overlap */
  it('should split long text into multiple chunks with overlap', () => {
    const longParagraph = 'Paragraph text sentence number one. '.repeat(40);
    const markdown = `# Long Document\n\n${longParagraph}`;

    const chunks = chunker.chunk(markdown, { maxChunkSize: 300, chunkOverlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
      expect(chunks[i]!.metadata.sectionHeaders).toEqual(['Long Document']);
    }
  });
});
