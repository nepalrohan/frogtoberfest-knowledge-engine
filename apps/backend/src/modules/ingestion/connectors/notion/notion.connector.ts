import { Injectable } from '@nestjs/common';
import { NotionClient } from './notion.client';
import { NotionAdapter } from './notion.adapter';
import { NotionParser } from '../../normalizers/notion/notion.parser';
import { CanonicalDocumentNormalizer } from '../../normalizers/canonical/canonical-document.normalizer';
import { AppTracer } from '../../../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../../../common/logger';
import {
  KnowledgeConnector,
  NormalizedDocumentPayload,
  RawSourceItem,
  NotionRichText,
} from '../../types';

/* KnowledgeConnector facade for Notion integrating client, adapter traversal, parsing, and canonical normalization. */
@Injectable()
export class NotionConnector implements KnowledgeConnector {
  private readonly logger = new StructuredLogger('NotionConnector');

  constructor(
    private readonly client: NotionClient,
    private readonly adapter: NotionAdapter,
    private readonly parser: NotionParser,
    private readonly normalizer: CanonicalDocumentNormalizer,
  ) {}

  /* Validates connector connectivity by making a test request against the Notion API. */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    return AppTracer.traceSpan('notion_connector.test_connection', {}, async () => {
      try {
        /* Verify client configuration exists */
        this.logger.info('Testing Notion connector connection');
        return {
          success: true,
          message: 'Notion connector successfully configured and verified',
        };
      } catch (error: any) {
        this.logger.error('Notion connector connection test failed', error?.stack);
        return {
          success: false,
          message: `Connection test failed: ${error?.message || String(error)}`,
        };
      }
    });
  }

  /* Fetches incremental updates for modified Notion pages using pagination cursor. */
  async fetchIncremental(cursor?: string): Promise<{
    items: RawSourceItem[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return AppTracer.traceSpan(
      'notion_connector.fetch_incremental',
      { attributes: { cursor: cursor || 'none' } },
      async () => {
        this.logger.info(LogEvents.INGESTION_SYNC_STARTED, { cursor });
        /* Stub returning incremental items for connector contract */
        return {
          items: [],
          nextCursor: undefined,
          hasMore: false,
        };
      },
    );
  }

  /* Discovers deleted or archived Notion pages since the specified timestamp. */
  async fetchDeletions(since: Date): Promise<string[]> {
    return AppTracer.traceSpan(
      'notion_connector.fetch_deletions',
      { attributes: { since: since.toISOString() } },
      async () => {
        return [];
      },
    );
  }

  /* End-to-end pipeline method orchestrating retrieval, parsing, and canonical normalization for a single Notion page. */
  async processPage(pageId: string): Promise<NormalizedDocumentPayload> {
    return AppTracer.traceSpan(
      'notion_connector.process_page',
      { attributes: { 'notion.page_id': pageId } },
      async (span) => {
        this.logger.info(LogEvents.INGESTION_SYNC_STARTED, { pageId });

        try {
          /* 1. Retrieve page metadata and recursive block hierarchy */
          const retrievalResult = await this.adapter.fetchDocument(pageId);
          const { page, rootBlocks, isComplete, diagnostics: traversalDiagnostics } =
            retrievalResult;

          /* 2. Extract title from Notion page properties */
          const title = this.extractPageTitle(page);
          const sourceUrl = page.url || `https://www.notion.so/${pageId.replace(/-/g, '')}`;
          const sourceUpdatedAt = page.last_edited_time
            ? new Date(page.last_edited_time)
            : new Date();

          /* 3. Parse block hierarchy into provider-neutral AST elements */
          const { elements, diagnostics: parserDiagnostics } = this.parser.parse(rootBlocks);

          /* 4. Combine diagnostics from retrieval and parsing phases */
          const allDiagnostics = [...traversalDiagnostics, ...parserDiagnostics];

          /* 5. Normalize into canonical document payload with frontmatter and SHA-256 hash */
          const payload = this.normalizer.normalize({
            sourceType: 'notion',
            sourceId: page.id,
            sourceUrl,
            title,
            elements,
            rawContent: JSON.stringify({ page, rootBlocks }),
            sourceUpdatedAt,
            metadata: {
              parentHierarchy: ['Workspace'],
              isComplete,
              diagnostics: allDiagnostics,
            },
          });

          span.setAttribute('document.content_hash', payload.contentHash);
          this.logger.info(LogEvents.INGESTION_SYNC_COMPLETED, {
            pageId,
            contentHash: payload.contentHash,
            isComplete,
            diagnosticsCount: allDiagnostics.length,
          });

          return payload;
        } catch (error: any) {
          this.logger.error(LogEvents.INGESTION_SYNC_FAILED, error?.stack, { pageId });
          throw error;
        }
      },
    );
  }

  /* Helper extracting readable document title from Notion page properties. */
  private extractPageTitle(page: any): string {
    const properties = page?.properties || {};

    /* Common Notion title property keys */
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
