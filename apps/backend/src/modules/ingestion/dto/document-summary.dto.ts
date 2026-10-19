/* Current state of one ingested document for the ingestion feed */
export class DocumentSummaryDto {
  documentId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  version: number;
  /* pending_embedding until the embedding worker finishes, then indexed */
  syncStatus: string;
  contentHash: string;
  updatedAt: string;
}
