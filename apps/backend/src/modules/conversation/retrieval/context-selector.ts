import { TokenCounter } from '../../indexing/chunker/token-counter';
import type { ChunkCandidate } from '../../indexing/retrieval/vector-store.service';
import type { ChatSource } from '../chat.types';

export interface ContextLimits {
  minSimilarity: number;
  maxSources: number;
  maxSourcesPerDocument: number;
  contextTokenBudget: number;
}

export type ContextSelection =
  | { kind: 'insufficient_evidence'; bestSimilarity: number }
  | {
      kind: 'selected';
      bestSimilarity: number;
      sources: ChatSource[];
      contextTokens: number;
    };

/* Case- and whitespace-insensitive text identity for duplicate detection */
const normalize = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/* Gates on relevance, then picks diverse, non-duplicate chunks in rank order within the token budget */
export function selectContext(
  candidates: ChunkCandidate[],
  limits: ContextLimits,
): ContextSelection {
  const bestSimilarity = candidates.reduce(
    (best, c) => Math.max(best, c.cosineSimilarity),
    0,
  );
  if (bestSimilarity < limits.minSimilarity) {
    return { kind: 'insufficient_evidence', bestSimilarity };
  }

  const selected: ChunkCandidate[] = [];
  const perDocument = new Map<string, number>();
  const seenText = new Set<string>();
  let contextTokens = 0;

  for (const candidate of candidates) {
    if (selected.length >= limits.maxSources) break;
    if (
      (perDocument.get(candidate.documentId) ?? 0) >=
      limits.maxSourcesPerDocument
    )
      continue;
    const text = normalize(candidate.content);
    if (seenText.has(text)) continue;

    const tokens = TokenCounter.countTokens(candidate.content);
    /* The top chunk is always kept so an oversized first hit cannot empty the context */
    if (
      selected.length > 0 &&
      contextTokens + tokens > limits.contextTokenBudget
    )
      break;

    selected.push(candidate);
    perDocument.set(
      candidate.documentId,
      (perDocument.get(candidate.documentId) ?? 0) + 1,
    );
    seenText.add(text);
    contextTokens += tokens;
  }

  const sources: ChatSource[] = selected.map((c, i) => ({
    index: i + 1,
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentVersion: c.documentVersion,
    documentTitle: c.documentTitle,
    sourceType: c.sourceType,
    ...(c.sourceUrl ? { sourceUrl: c.sourceUrl } : {}),
    sectionHeaders: c.sectionHeaders,
    snippet: c.content,
    score: c.cosineSimilarity,
    cited: false,
  }));
  return { kind: 'selected', bestSimilarity, sources, contextTokens };
}
