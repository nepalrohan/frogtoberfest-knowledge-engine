import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Document } from '../../../entities';
import { DocumentRepository } from '../repositories/document.repository';
import { EmbeddingOutboxRepository } from '../repositories/embedding-outbox.repository';
import { TraceContextPropagator } from '../../../common/telemetry';

/* Normalized content to store as the next version of a source resource */
export interface DocumentVersionInput {
  sourceType: string;
  sourceId: string;
  sourceUrl?: string;
  title: string;
  rawContent?: string;
  normalizedContent: string;
  contentHash: string;
  sourceUpdatedAt?: Date;
  metadata?: Record<string, unknown>;
}

export type DocumentVersionOutcome = 'CREATED' | 'UPDATED' | 'UNCHANGED';

export interface DocumentVersionResult {
  outcome: DocumentVersionOutcome;
  document: Document;
}

/* Applies the monotonic version rules shared by direct ingestion and connector sync */
@Injectable()
export class DocumentVersioningService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly embeddingOutbox: EmbeddingOutboxRepository,
  ) {}

  /* Must run inside the caller's transaction: locks the source row, writes the version, and enqueues embedding atomically */
  async applyVersion(input: DocumentVersionInput, manager: EntityManager): Promise<DocumentVersionResult> {
    const existing = await this.documents.findBySourceForUpdate(input.sourceType, input.sourceId, manager);
    const sourceUpdatedAt = input.sourceUpdatedAt ?? new Date();

    if (existing && existing.contentHash === input.contentHash) {
      /* Identical content: keep the version and skip re-indexing */
      existing.sourceUpdatedAt = sourceUpdatedAt;
      const document = await this.documents.save(existing, manager);
      return { outcome: 'UNCHANGED', document };
    }

    let candidate: Document;
    if (existing) {
      existing.title = input.title;
      existing.sourceUrl = input.sourceUrl ?? existing.sourceUrl;
      existing.rawContent = input.rawContent;
      existing.normalizedContent = input.normalizedContent;
      existing.contentHash = input.contentHash;
      existing.version += 1;
      existing.syncStatus = 'pending_embedding';
      existing.metadata = { ...existing.metadata, ...input.metadata };
      existing.sourceUpdatedAt = sourceUpdatedAt;
      existing.deletedAt = undefined;
      candidate = existing;
    } else {
      candidate = this.documents.create(
        {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceUrl: input.sourceUrl,
          title: input.title,
          rawContent: input.rawContent,
          normalizedContent: input.normalizedContent,
          contentHash: input.contentHash,
          version: 1,
          syncStatus: 'pending_embedding',
          metadata: input.metadata ?? {},
          sourceUpdatedAt,
        },
        manager,
      );
    }

    const document = await this.documents.save(candidate, manager);
    await this.embeddingOutbox.enqueue(
      {
        documentId: document.id,
        documentVersion: document.version,
        sourceType: document.sourceType,
        title: document.title,
        traceCarrier: TraceContextPropagator.injectToCarrier({}),
      },
      manager,
    );

    return { outcome: existing ? 'UPDATED' : 'CREATED', document };
  }
}
