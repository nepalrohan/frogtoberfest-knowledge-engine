import { DataSource } from 'typeorm';
import { Document, DocumentChunk, EMBEDDING_VECTOR_DIMENSION } from '../../../entities';
import { VectorStoreService } from './vector-store.service';
import { describeWithDatabase, openTestDataSource, truncate } from '../../../../test/support/test-database';

/* Unit vector along one axis, optionally blended with a second axis */
const axis = (i: number, j?: number): number[] => {
  const v = Array<number>(EMBEDDING_VECTOR_DIMENSION).fill(0);
  if (j === undefined) {
    v[i] = 1;
  } else {
    v[i] = Math.SQRT1_2;
    v[j] = Math.SQRT1_2;
  }
  return v;
};

describeWithDatabase('VectorStoreService.searchHybrid (real pgvector)', () => {
  let dataSource: DataSource;
  let store: VectorStoreService;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    store = new VectorStoreService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await truncate(dataSource, ['document', 'document_chunk']);
  });

  /* Inserts a document at `version` with one chunk per entry */
  const seed = async (
    title: string,
    chunks: { content: string; vector: number[]; version?: number; model?: string }[],
    doc: Partial<Document> = {},
  ): Promise<Document> => {
    const saved = await dataSource.getRepository(Document).save({
      sourceType: 'text',
      sourceId: title,
      title,
      sourceUrl: `https://docs.example.com/${encodeURIComponent(title)}`,
      normalizedContent: title,
      contentHash: title,
      version: 2,
      syncStatus: 'indexed',
      metadata: {},
      ...doc,
    });
    await dataSource.getRepository(DocumentChunk).save(
      chunks.map((c, i) => ({
        documentId: saved.id,
        chunkIndex: i,
        documentVersion: c.version ?? saved.version,
        content: c.content,
        embedding: c.vector,
        embeddingModel: c.model ?? 'nomic-embed-text',
        tokenCount: 10,
        metadata: { sectionHeaders: [title, `Section ${i}`] },
      })),
    );
    return saved;
  };

  it('ranks by fused vector and keyword rank and reports cosine similarity with document details', async () => {
    const guide = await seed('Deployment Guide', [
      { content: 'Redeploy the previous release tag to roll back.', vector: axis(0) },
      { content: 'Unrelated onboarding text.', vector: axis(0, 1) },
    ]);

    const results = await store.searchHybrid('how to roll back', axis(0), 'nomic-embed-text', { candidateK: 20 });

    expect(results.map((r) => r.content)).toEqual([
      'Redeploy the previous release tag to roll back.',
      'Unrelated onboarding text.',
    ]);
    expect(results[0]).toEqual({
      chunkId: expect.any(String),
      documentId: guide.id,
      documentVersion: 2,
      documentTitle: 'Deployment Guide',
      sourceType: 'text',
      sourceUrl: 'https://docs.example.com/Deployment%20Guide',
      content: 'Redeploy the previous release tag to roll back.',
      sectionHeaders: ['Deployment Guide', 'Section 0'],
      cosineSimilarity: expect.closeTo(1, 5),
      vectorRank: 1,
      keywordRank: 1,
      rrfScore: expect.closeTo(2 / 61, 6),
    });
    expect(results[1]?.cosineSimilarity).toBeCloseTo(Math.SQRT1_2, 5);
    expect(results[1]?.keywordRank).toBeNull();
  });

  it('finds a chunk by an exact identifier even when its vector is unrelated', async () => {
    await seed('Error Codes', [{ content: 'ERR_4521 means the ledger lock timed out.', vector: axis(7) }]);
    await seed('Other', [{ content: 'Something semantically close.', vector: axis(0) }]);

    const results = await store.searchHybrid('what is ERR_4521', axis(0), 'nomic-embed-text', { candidateK: 1 });

    const hit = results.find((r) => r.content.startsWith('ERR_4521'));
    expect(hit).toMatchObject({ keywordRank: 1, vectorRank: null, cosineSimilarity: expect.closeTo(0, 5) });
  });

  it('excludes deleted, unindexed, outdated and other-model chunks', async () => {
    await seed('Live', [{ content: 'live chunk', vector: axis(0) }]);
    await seed('Deleted', [{ content: 'deleted chunk', vector: axis(0) }], { deletedAt: new Date() });
    await seed('Pending', [{ content: 'pending chunk', vector: axis(0) }], { syncStatus: 'pending_embedding' });
    await seed('Stale', [{ content: 'stale chunk', vector: axis(0), version: 1 }]);
    await seed('OtherModel', [{ content: 'other model chunk', vector: axis(0), model: 'bge-small-en' }]);

    const results = await store.searchHybrid('chunk', axis(0), 'nomic-embed-text', { candidateK: 20 });

    expect(results.map((r) => r.content)).toEqual(['live chunk']);
  });

  it('returns vector matches when the question has only stopwords', async () => {
    await seed('Live', [{ content: 'live chunk', vector: axis(0) }]);
    const results = await store.searchHybrid('how do I', axis(0), 'nomic-embed-text', { candidateK: 20 });
    expect(results.map((r) => r.keywordRank)).toEqual([null]);
  });
});
