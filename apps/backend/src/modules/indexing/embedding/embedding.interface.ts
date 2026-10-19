/* Injection token for swappable embedding provider */
export const EMBEDDING_PROVIDER_TOKEN = Symbol('EMBEDDING_PROVIDER_TOKEN');

/* Asymmetric retrieval models embed questions and passages differently */
export type EmbeddingInputType = 'query' | 'document';

/* Interface contract for swappable vector embedding providers */
export interface IEmbeddingProvider {
  /* Generates vector embeddings for a list of texts of the given input type */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;

  /* Returns vector dimension size (e.g. 768 or 384) */
  getDimension(): number;

  /* Returns readable provider identifier */
  getProviderName(): string;

  /* Returns the model identifier; stored per chunk so retrieval never mixes vector spaces */
  getModelName(): string;
}
