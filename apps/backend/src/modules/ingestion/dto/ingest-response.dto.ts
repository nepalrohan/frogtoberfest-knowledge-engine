/* Standard response DTO for document ingestion endpoints */
export class IngestResponseDto {
  documentId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  version: number;
  syncStatus: string;
  contentHash: string;
  isNewOrUpdated: boolean;
  outboxEnqueued: boolean;
}
