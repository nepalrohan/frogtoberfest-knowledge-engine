/* Injection token for the optional cross-encoder reranker */
export const RERANKER = Symbol('RERANKER');

/* Scores how well each passage answers the query; higher is better */
export interface IReranker {
  /* False when no reranking service is configured; the turn then keeps the fused order */
  readonly enabled: boolean;
  /* One score per passage, in input order */
  rerank(
    query: string,
    passages: string[],
    options: { signal?: AbortSignal },
  ): Promise<number[]>;
}
