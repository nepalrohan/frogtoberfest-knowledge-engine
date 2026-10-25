import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config';
import type { IReranker } from './reranker.interface';

interface TeiRerankResult {
  index: number;
  score: number;
}

/* Reranks with a Hugging Face Text Embeddings Inference server running a cross-encoder (e.g. bge-reranker) */
@Injectable()
export class TeiRerankerClient implements IReranker {
  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return this.config.reranker.url.length > 0;
  }

  async rerank(
    query: string,
    passages: string[],
    { signal }: { signal?: AbortSignal },
  ): Promise<number[]> {
    if (passages.length === 0) return [];
    const { url, timeoutMs } = this.config.reranker;
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`${url.replace(/\/$/, '')}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* truncate: long chunks are cut to the model's window instead of failing the request */
      body: JSON.stringify({ query, texts: passages, truncate: true }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      throw new Error(`Reranker responded with status ${res.status}`);
    }
    const results = (await res.json()) as TeiRerankResult[];
    const scores = passages.map(() => Number.NEGATIVE_INFINITY);
    for (const { index, score } of results) scores[index] = score;
    return scores;
  }
}
