import { Injectable } from '@nestjs/common';
import type { NormalizedDocumentPayload } from '../types';
import { TransactionRunner } from '../../../database/transaction-runner';
import { DocumentRepository } from '../../documents/repositories/document.repository';
import { DocumentVersioningService } from '../../documents/services/document-versioning.service';
import { retryOnUniqueViolation } from '../../documents/services/unique-violation-retry';
import {
  ConnectorSyncItemRepository,
  ConnectorSyncItemStatus,
} from '../../connector-persistence';
import { StructuredLogger, LogEvents } from '../../../common/logger';

/* Normalized sync output to publish as the canonical document of a tracked resource */
export interface PublishSyncedDocumentInput {
  syncItemId: string;
  payload: NormalizedDocumentPayload;
  observedRevision?: string | null;
  contentFingerprint?: string | null;
}

export type SyncedDocumentOutcome = 'PUBLISHED' | 'UNCHANGED' | 'REJECTED_DESELECTED' | 'REJECTED_STALE';

export interface SyncedDocumentPublication {
  outcome: SyncedDocumentOutcome;
  documentId?: string;
  version?: number;
}

/* Contract for publishing connector sync output as canonical, versioned documents */
export interface IDocumentStorageService {
  publishSyncedDocument(input: PublishSyncedDocumentInput): Promise<SyncedDocumentPublication>;
}

export const DOCUMENT_STORAGE_SERVICE = Symbol('DOCUMENT_STORAGE_SERVICE');

/* Durable document storage: deselection check, version write, embedding outbox and sync item completion in one transaction */
@Injectable()
export class DocumentStorageService implements IDocumentStorageService {
  private readonly logger = new StructuredLogger(DocumentStorageService.name);

  constructor(
    private readonly transactions: TransactionRunner,
    private readonly syncItems: ConnectorSyncItemRepository,
    private readonly documents: DocumentRepository,
    private readonly versioning: DocumentVersioningService,
  ) {}

  async publishSyncedDocument(input: PublishSyncedDocumentInput): Promise<SyncedDocumentPublication> {
    const publication = await retryOnUniqueViolation(() =>
      this.transactions.run(async (manager): Promise<SyncedDocumentPublication> => {
        /* Locking the item serializes this publish with a concurrent deselection of the same row */
        const item = await this.syncItems.lockById(input.syncItemId, manager);
        if (!item || item.status === ConnectorSyncItemStatus.DESELECTED) {
          return { outcome: 'REJECTED_DESELECTED' };
        }

        const { payload } = input;
        const current = await this.documents.findBySourceForUpdate(payload.sourceType, payload.sourceId, manager);
        if (current?.sourceUpdatedAt && current.sourceUpdatedAt > payload.sourceUpdatedAt) {
          /* A newer revision is already published; keep it and only close out this run */
          item.status = ConnectorSyncItemStatus.COMPLETED;
          item.lastSyncedAt = new Date();
          await this.syncItems.save(item, manager);
          return { outcome: 'REJECTED_STALE', documentId: current.id, version: current.version };
        }

        const { outcome, document } = await this.versioning.applyVersion(
          {
            sourceType: payload.sourceType,
            sourceId: payload.sourceId,
            sourceUrl: payload.sourceUrl,
            title: payload.title,
            rawContent: payload.rawContent,
            normalizedContent: payload.normalizedContent,
            contentHash: payload.contentHash,
            sourceUpdatedAt: payload.sourceUpdatedAt,
            metadata: payload.metadata,
          },
          manager,
        );

        item.status = ConnectorSyncItemStatus.COMPLETED;
        item.lastSyncedAt = new Date();
        item.lastError = null;
        if (input.observedRevision) {
          item.lastObservedRevision = input.observedRevision;
        }
        if (input.contentFingerprint) {
          item.lastProcessedFingerprint = input.contentFingerprint;
        }
        await this.syncItems.save(item, manager);

        return {
          outcome: outcome === 'UNCHANGED' ? 'UNCHANGED' : 'PUBLISHED',
          documentId: document.id,
          version: document.version,
        };
      }),
    );

    if (publication.outcome === 'PUBLISHED') {
      this.logger.logEvent(LogEvents.DOCUMENT_VERSION_PUBLISHED, {
        documentId: publication.documentId,
        versionId: String(publication.version),
        syncItemId: input.syncItemId,
      });
    } else if (publication.outcome !== 'UNCHANGED') {
      this.logger.warnEvent(LogEvents.DOCUMENT_PUBLICATION_REJECTED, {
        syncItemId: input.syncItemId,
        stage: publication.outcome,
        documentId: publication.documentId,
      });
    }
    return publication;
  }
}
