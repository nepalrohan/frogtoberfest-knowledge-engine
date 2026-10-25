import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Document, EmbeddingOutbox } from '../../entities';
import { MarkdownNormalizer, NormalizerOptions } from './normalizer/markdown-normalizer';
import { IngestResponseDto } from './dto/ingest-response.dto';
import { DocumentSummaryDto } from './dto/document-summary.dto';
import { StructuredLogger } from '../../common/logger/structured-logger';
import { LogEvents } from '../../common/logger/log-events';
import { TraceContextPropagator } from '../../common/telemetry/trace-context.propagator';

export interface IngestDocumentInput {
  sourceType: string;
  sourceId: string;
  sourceUrl?: string;
  title: string;
  rawContent: string;
  sourceUpdatedAt?: Date;
  metadata?: Record<string, unknown>;
}

/* Coordinates document intake, normalization, deduplication, and atomic outbox emission */
@Injectable()
export class IngestionService {
  private readonly logger = new StructuredLogger(IngestionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly normalizer: MarkdownNormalizer,
  ) {}

  /* Normalizes document content and persists document and outbox event in an ACID transaction */
  async ingestDocument(input: IngestDocumentInput): Promise<IngestResponseDto> {
    const traceInfo = TraceContextPropagator.getActiveTraceInfo();
    this.logger.log('Starting document ingestion', {
      event: LogEvents.INGESTION_SYNC_STARTED,
      traceId: traceInfo.traceId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });

    const normOpts: NormalizerOptions = {
      title: input.title,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      sourceUpdatedAt: input.sourceUpdatedAt,
      metadata: input.metadata,
    };

    const normalized = this.normalizer.normalize(input.rawContent, normOpts);
    const traceCarrier = TraceContextPropagator.injectToCarrier({});

    const result = await this.dataSource.transaction(async (manager) => {
      const docRepo = manager.getRepository(Document);
      const outboxRepo = manager.getRepository(EmbeddingOutbox);

      let doc = await docRepo.findOne({
        where: { sourceType: input.sourceType, sourceId: input.sourceId },
      });

      if (doc) {
        if (doc.contentHash === normalized.contentHash) {
          /* Content is identical; skip outbox emission and update timestamp only */
          doc.sourceUpdatedAt = input.sourceUpdatedAt || new Date();
          await docRepo.save(doc);

          return {
            documentId: doc.id,
            sourceType: doc.sourceType,
            sourceId: doc.sourceId,
            title: doc.title,
            version: doc.version,
            syncStatus: doc.syncStatus,
            contentHash: doc.contentHash,
            isNewOrUpdated: false,
            outboxEnqueued: false,
          };
        }

        /* Content changed; increment version and transition status to pending_embedding */
        doc.title = normalized.title;
        doc.rawContent = input.rawContent;
        doc.normalizedContent = normalized.normalizedContent;
        doc.contentHash = normalized.contentHash;
        doc.version += 1;
        doc.syncStatus = 'pending_embedding';
        doc.metadata = { ...doc.metadata, ...normalized.metadata };
        doc.sourceUpdatedAt = input.sourceUpdatedAt || new Date();
        doc.deletedAt = undefined;
      } else {
        /* New document; initialize at version 1 with pending_embedding status */
        doc = docRepo.create({
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceUrl: input.sourceUrl,
          title: normalized.title,
          rawContent: input.rawContent,
          normalizedContent: normalized.normalizedContent,
          contentHash: normalized.contentHash,
          version: 1,
          syncStatus: 'pending_embedding',
          metadata: normalized.metadata,
          sourceUpdatedAt: input.sourceUpdatedAt || new Date(),
        });
      }

      const savedDoc = await docRepo.save(doc);

      /* Persist outbox event inside the same database transaction */
      const outboxRecord = outboxRepo.create({
        documentId: savedDoc.id,
        documentVersion: savedDoc.version,
        eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
        payload: {
          documentId: savedDoc.id,
          documentVersion: savedDoc.version,
          sourceType: savedDoc.sourceType,
          title: savedDoc.title,
          traceCarrier,
        },
        status: 'pending',
      });

      await outboxRepo.save(outboxRecord);

      return {
        documentId: savedDoc.id,
        sourceType: savedDoc.sourceType,
        sourceId: savedDoc.sourceId,
        title: savedDoc.title,
        version: savedDoc.version,
        syncStatus: savedDoc.syncStatus,
        contentHash: savedDoc.contentHash,
        isNewOrUpdated: true,
        outboxEnqueued: true,
      };
    });

    this.logger.log('Document ingestion completed successfully', {
      event: LogEvents.INGESTION_SYNC_COMPLETED,
      documentId: result.documentId,
      version: result.version,
      outboxEnqueued: result.outboxEnqueued,
    });

    return result;
  }

  /* Recent live documents with their indexing status, newest activity first */
  async listRecentDocuments(limit = 50): Promise<DocumentSummaryDto[]> {
    const documents = await this.dataSource.getRepository(Document).find({
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        title: true,
        version: true,
        syncStatus: true,
        contentHash: true,
        updatedAt: true,
      },
      where: { deletedAt: IsNull() },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    return documents.map((doc) => ({
      documentId: doc.id,
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      title: doc.title,
      version: doc.version,
      syncStatus: doc.syncStatus,
      contentHash: doc.contentHash,
      updatedAt: doc.updatedAt.toISOString(),
    }));
  }
}
