import type { AxiosInstance } from 'axios';

export interface IngestResponse {
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

/* Current state of one ingested document; syncStatus moves from pending_embedding to indexed */
export interface DocumentSummary {
  documentId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  version: number;
  syncStatus: string;
  contentHash: string;
  updatedAt: string;
}

export interface FeedKnowledgePayload {
  title: string;
  content: string;
  sourceId?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestionApi {
  upload(file: File | Blob, filename?: string): Promise<IngestResponse>;
  feedKnowledge(payload: FeedKnowledgePayload): Promise<IngestResponse>;
  listDocuments(): Promise<DocumentSummary[]>;
}

/* Factory creating the Ingestion API client methods */
export function createIngestionApi(http: AxiosInstance): IngestionApi {
  return {
    async upload(file: File | Blob, filename?: string): Promise<IngestResponse> {
      const formData = new FormData();
      if (filename) {
        formData.append('file', file, filename);
      } else {
        formData.append('file', file);
      }

      const response = await http.post<IngestResponse>('/api/v1/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },

    async listDocuments(): Promise<DocumentSummary[]> {
      const response = await http.get<DocumentSummary[]>('/api/v1/documents');
      return response.data;
    },

    async feedKnowledge(payload: FeedKnowledgePayload): Promise<IngestResponse> {
      const response = await http.post<IngestResponse>(
        '/api/v1/feed-knowledge',
        payload,
      );
      return response.data;
    },
  };
}
