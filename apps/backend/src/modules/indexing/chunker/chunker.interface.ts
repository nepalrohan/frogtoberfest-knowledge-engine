/* Chunk metadata retaining section hierarchy and token count */
export interface ChunkMetadata {
  sectionHeaders: string[];
  sectionTitle?: string;
  tokenCount: number;
  [key: string]: unknown;
}

/* Individual chunk result returned by chunking engine */
export interface DocumentChunkResult {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  metadata: ChunkMetadata;
}

/* Configuration options for chunk splitting */
export interface ChunkOptions {
  maxChunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
}

/* Interface contract for document chunkers */
export interface IChunker {
  chunk(content: string, options?: ChunkOptions): DocumentChunkResult[];
}
