import { Injectable } from '@nestjs/common';
import { NotionClient } from './notion.client';
import { NotionAdapter } from './notion.adapter';
import { NotionParser } from '../../normalizers/notion/notion.parser';
import { CanonicalDocumentNormalizer } from '../../normalizers/canonical/canonical-document.normalizer';
import {
  KnowledgeSyncProcessor,
  SyncResourceParams,
  SyncExecutionResult,
} from '../../interfaces/knowledge-sync-processor.interface';
import { NotionRichText } from '../../types';
import { AppTracer } from '../../../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../../../common/logger';

/* Notion connector sync processor executing two-tier change detection and canonical normalization */
@Injectable()
export class NotionSyncProcessor implements KnowledgeSyncProcessor {
  readonly provider = 'notion';
  private readonly logger = new StructuredLogger('NotionSyncProcessor');

  constructor(
    private readonly client: NotionClient,
    private readonly adapter: NotionAdapter,
    private readonly parser: NotionParser,
    private readonly normalizer: CanonicalDocumentNormalizer,
  ) {}

  /* Executes resource synchronization with two-tier change detection */
  async syncResource(params: SyncResourceParams): Promise<SyncExecutionResult> {
    const { connectionId, externalResourceId, lastObservedRevision, lastProcessedFingerprint } =
      params;

    return AppTracer.traceSpan(
      'notion_sync_processor.sync_resource',
      {
        attributes: {
          'connector.connection_id': connectionId,
          'notion.page_id': externalResourceId,
        },
      },
      async (span) => {
        this.logger.info(LogEvents.INGESTION_SYNC_STARTED, {
          connectionId,
          pageId: externalResourceId,
        });

        try {
          /* Tier 1: Check page metadata for revision timestamp */
          const page = await this.client.getPage(externalResourceId);
          const currentRevision = page.last_edited_time || null;

          /* If revision timestamp is identical and fingerprint is known, skip full tree fetch */
          if (
            currentRevision &&
            lastObservedRevision &&
            currentRevision === lastObservedRevision &&
            lastProcessedFingerprint
          ) {
            this.logger.info('Tier-1 change detection: revision unchanged, skipping full traversal', {
              pageId: externalResourceId,
              revision: currentRevision,
            });

            return {
              status: 'NO_OP',
              externalResourceId,
              observedRevision: currentRevision,
              contentFingerprint: lastProcessedFingerprint,
              normalizedPayload: null,
            };
          }

          /* Tier 2: Fetch full block tree and normalize */
          const retrievalResult = await this.adapter.fetchDocument(externalResourceId);
          const { rootBlocks, isComplete, diagnostics: traversalDiagnostics } = retrievalResult;

          const title = this.extractPageTitle(page);
          const sourceUrl =
            page.url || `https://www.notion.so/${externalResourceId.replace(/-/g, '')}`;
          const sourceUpdatedAt = page.last_edited_time
            ? new Date(page.last_edited_time)
            : new Date();

          const { elements, diagnostics: parserDiagnostics } = this.parser.parse(rootBlocks);
          const allDiagnostics = [...traversalDiagnostics, ...parserDiagnostics];

          const payload = this.normalizer.normalize({
            sourceType: 'notion',
            sourceId: page.id,
            sourceUrl,
            title,
            elements,
            rawContent: JSON.stringify({ page, rootBlocks }),
            sourceUpdatedAt,
            metadata: {
              connectionId,
              parentHierarchy: ['Workspace'],
              isComplete,
              diagnostics: allDiagnostics,
            },
          });

          span.setAttribute('document.content_hash', payload.contentHash);

          /* Content hash equality comparison */
          if (
            lastProcessedFingerprint &&
            payload.contentHash === lastProcessedFingerprint
          ) {
            this.logger.info('Tier-2 change detection: normalized content hash unchanged (NO_OP)', {
              pageId: externalResourceId,
              contentHash: payload.contentHash,
            });

            return {
              status: 'NO_OP',
              externalResourceId,
              observedRevision: currentRevision,
              contentFingerprint: payload.contentHash,
              normalizedPayload: payload,
            };
          }

          this.logger.info(LogEvents.INGESTION_SYNC_COMPLETED, {
            pageId: externalResourceId,
            contentHash: payload.contentHash,
            isComplete,
          });

          return {
            status: 'UPDATED',
            externalResourceId,
            observedRevision: currentRevision,
            contentFingerprint: payload.contentHash,
            normalizedPayload: payload,
          };
        } catch (error: any) {
          this.logger.error(LogEvents.INGESTION_SYNC_FAILED, error?.stack, {
            pageId: externalResourceId,
          });
          return {
            status: 'FAILED',
            externalResourceId,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
    );
  }

  /* Helper extracting readable document title from Notion page properties */
  private extractPageTitle(page: any): string {
    const properties = page?.properties || {};

    for (const key of ['title', 'Title', 'Name', 'name']) {
      const prop = properties[key];
      if (prop && prop.type === 'title' && Array.isArray(prop.title)) {
        const titleText = prop.title
          .map((t: NotionRichText) => t.plain_text || t.text?.content || '')
          .join('')
          .trim();
        if (titleText) {
          return titleText;
        }
      }
    }

    return 'Untitled Notion Document';
  }
}
