import type { ChunkCandidate } from '../../indexing/retrieval/vector-store.service';
import { selectContext, type ContextLimits } from './context-selector';

const limits: ContextLimits = {
  minSimilarity: 0.65,
  maxSources: 5,
  maxSourcesPerDocument: 2,
  contextTokenBudget: 2500,
};

/* Candidate in fused-rank order; `doc` names both the document id and title */
const candidate = (
  id: string,
  doc: string,
  cosine: number,
  content = `content of ${id}`,
): ChunkCandidate => ({
  chunkId: id,
  documentId: `doc-${doc}`,
  documentVersion: 1,
  documentTitle: `Doc ${doc}`,
  sourceType: 'text',
  content,
  sectionHeaders: [`Doc ${doc}`],
  cosineSimilarity: cosine,
  vectorRank: 1,
  keywordRank: null,
  rrfScore: 0.01,
});

describe('selectContext', () => {
  it('reports insufficient evidence when no candidate reaches the similarity threshold', () => {
    const result = selectContext(
      [candidate('a', 'A', 0.42), candidate('b', 'B', 0.3)],
      limits,
    );
    expect(result).toEqual({
      kind: 'insufficient_evidence',
      bestSimilarity: 0.42,
    });
  });

  it('reports insufficient evidence when there are no candidates', () => {
    expect(selectContext([], limits)).toEqual({
      kind: 'insufficient_evidence',
      bestSimilarity: 0,
    });
  });

  it('keeps at most two chunks per document and numbers sources in ranking order', () => {
    const ranked = [
      candidate('a1', 'A', 0.9),
      candidate('a2', 'A', 0.88),
      candidate('a3', 'A', 0.87),
      candidate('a4', 'A', 0.86),
      candidate('b1', 'B', 0.7),
      candidate('c1', 'C', 0.66),
    ];

    const result = selectContext(ranked, limits);

    expect(result.kind).toBe('selected');
    if (result.kind !== 'selected') return;
    expect(result.sources.map((s) => [s.index, s.chunkId])).toEqual([
      [1, 'a1'],
      [2, 'a2'],
      [3, 'b1'],
      [4, 'c1'],
    ]);
    expect(result.sources[0]).toEqual({
      index: 1,
      chunkId: 'a1',
      documentId: 'doc-A',
      documentVersion: 1,
      documentTitle: 'Doc A',
      sourceType: 'text',
      sectionHeaders: ['Doc A'],
      snippet: 'content of a1',
      score: 0.9,
      cited: false,
    });
  });

  it('drops a chunk whose text duplicates an already selected chunk', () => {
    const result = selectContext(
      [
        candidate('a', 'A', 0.9, 'Roll back  by redeploying.'),
        candidate('b', 'B', 0.8, 'roll back by\nredeploying.'),
      ],
      limits,
    );
    expect(
      result.kind === 'selected' && result.sources.map((s) => s.chunkId),
    ).toEqual(['a']);
  });

  it('stops before the selected text exceeds the token budget', () => {
    const big = 'x'.repeat(4000);
    const result = selectContext(
      [
        candidate('a', 'A', 0.9, big + 'a'),
        candidate('b', 'B', 0.9, big + 'b'),
        candidate('c', 'C', 0.9, big + 'c'),
      ],
      { ...limits, contextTokenBudget: 1100 },
    );
    expect(
      result.kind === 'selected' && result.sources.map((s) => s.chunkId),
    ).toEqual(['a', 'b']);
  });

  it('selects at most five sources', () => {
    const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((d) =>
      candidate(d, d, 0.8),
    );
    const result = selectContext(ranked, limits);
    expect(result.kind === 'selected' && result.sources.length).toBe(5);
  });
});
