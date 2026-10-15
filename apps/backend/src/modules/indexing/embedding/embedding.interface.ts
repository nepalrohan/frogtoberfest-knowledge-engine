/* Injection token for swappable embedding provider */
export const EMBEDDING_PROVIDER_TOKEN = Symbol('EMBEDDING_PROVIDER_TOKEN');

/* Interface contract for swappable vector embedding providers */
export interface IEmbeddingProvider {
  /* Generates vector embeddings for a list of text chunks */
  embed(texts: string[]): Promise<number[][]>;

  /* Returns vector dimension size (e.g. 768 or 384) */
  getDimension(): number;

  /* Returns readable provider identifier */
  getProviderName(): string;
}
