import { Injectable } from '@nestjs/common';
import { NormalizedDocumentPayload } from '../types';
import { StructuredLogger } from '../../../common/logger';

/* Contract for canonical document persistence and monotonic version management */
export interface IDocumentStorageService {
  saveDocument(
    payload: NormalizedDocumentPayload,
    expectedVersion?: number,
  ): Promise<{
    documentId: string;
    version: number;
    isNewVersion: boolean;
  }>;
}

export const DOCUMENT_STORAGE_SERVICE = 'DOCUMENT_STORAGE_SERVICE';

/* Placeholder implementation of document storage for the scoped sync workflow */
@Injectable()
export class DocumentStoragePlaceholderService implements IDocumentStorageService {
  private readonly logger = new StructuredLogger('DocumentStoragePlaceholderService');
  private readonly savedDocuments = new Map<
    string,
    { version: number; payload: NormalizedDocumentPayload }
  >();

  /* Accepts and records normalized document payloads in memory while logging details */
  async saveDocument(
    payload: NormalizedDocumentPayload,
    expectedVersion?: number,
  ): Promise<{ documentId: string; version: number; isNewVersion: boolean }> {
    const key = `${payload.sourceType}:${payload.sourceId}`;
    const existing = this.savedDocuments.get(key);

    const version = existing ? existing.version + 1 : 1;
    this.savedDocuments.set(key, { version, payload });

    this.logger.info('Persisted normalized document to placeholder storage', {
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
      title: payload.title,
      version,
      contentHash: payload.contentHash,
    });

    return {
      documentId: `doc-${payload.sourceId}`,
      version,
      isNewVersion: !existing,
    };
  }

  /* Helper method for testing state verification */
  getDocument(sourceType: string, sourceId: string) {
    return this.savedDocuments.get(`${sourceType}:${sourceId}`);
  }

  /* Clear stored documents for testing */
  clear() {
    this.savedDocuments.clear();
  }
}
