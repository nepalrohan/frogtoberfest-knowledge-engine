import { Injectable } from '@nestjs/common';
import { NotionClient } from './notion.client';
import { AppConfigService } from '../../../../config/configuration';
import { AppTracer } from '../../../../common/telemetry';
import { StructuredLogger } from '../../../../common/logger';
import {
  DiagnosticMessage,
  NotionBlockWithChildren,
  NotionPageResponse,
  NotionRetrievalResult,
} from '../../types';

/* Traversal adapter reconstructing Notion page and block trees with depth and budget boundaries. */
@Injectable()
export class NotionAdapter {
  private readonly logger = new StructuredLogger('NotionAdapter');
  private maxDepth: number;
  private maxRequests: number;

  constructor(
    private readonly client: NotionClient,
    private readonly configService: AppConfigService,
  ) {
    const config = this.configService.notion;
    this.maxDepth = config?.maxDepth ?? 5;
    this.maxRequests = config?.maxRequests ?? 50;
  }

  /* Fetches full page metadata and recursively retrieves all child blocks within configured limits. */
  async fetchDocument(pageId: string): Promise<NotionRetrievalResult> {
    return AppTracer.traceSpan(
      'notion.adapter_traversal',
      {
        attributes: {
          'notion.page_id': pageId,
          'notion.max_depth': this.maxDepth,
          'notion.max_requests': this.maxRequests,
        },
      },
      async () => {
        let requestCount = 0;
        let isComplete = true;
        const diagnostics: DiagnosticMessage[] = [];

        /* Step 1: Fetch page metadata */
        if (requestCount >= this.maxRequests) {
          diagnostics.push({
            code: 'REQUEST_BUDGET_EXCEEDED',
            level: 'warn',
            message: `Request budget of ${this.maxRequests} exceeded before page fetch`,
            timestamp: new Date().toISOString(),
          });
          return {
            page: { id: pageId, object: 'page' } as NotionPageResponse,
            rootBlocks: [],
            isComplete: false,
            totalRequests: requestCount,
            diagnostics,
          };
        }

        requestCount++;
        const page = await this.client.getPage(pageId);

        /* Step 2: Fetch top-level blocks with pagination */
        const rootBlocks = await this.fetchBlockCollection(
          pageId,
          () => requestCount,
          (val) => {
            requestCount = val;
          },
          () => isComplete,
          (val) => {
            isComplete = val;
          },
          diagnostics,
        );

        /* Step 3: Recursively retrieve children for blocks with children */
        for (const block of rootBlocks) {
          if (block.has_children) {
            await this.traverseChildren(
              block,
              1,
              () => requestCount,
              (val) => {
                requestCount = val;
              },
              () => isComplete,
              (val) => {
                isComplete = val;
              },
              diagnostics,
            );
          }
        }

        return {
          page,
          rootBlocks,
          isComplete,
          totalRequests: requestCount,
          diagnostics,
        };
      },
    );
  }

  /* Retrieves all blocks for a given parent ID, exhausting pagination cursors within request budget. */
  private async fetchBlockCollection(
    parentId: string,
    getRequestCount: () => number,
    setRequestCount: (val: number) => void,
    getIsComplete: () => boolean,
    setIsComplete: (val: boolean) => void,
    diagnostics: DiagnosticMessage[],
  ): Promise<NotionBlockWithChildren[]> {
    const blocks: NotionBlockWithChildren[] = [];
    let cursor: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      if (getRequestCount() >= this.maxRequests) {
        diagnostics.push({
          code: 'REQUEST_BUDGET_EXCEEDED',
          level: 'warn',
          message: `Request budget of ${this.maxRequests} reached during block pagination for parent ${parentId}`,
          timestamp: new Date().toISOString(),
        });
        setIsComplete(false);
        break;
      }

      setRequestCount(getRequestCount() + 1);
      const response = await this.client.getBlockChildren(parentId, cursor);

      for (const block of response.results) {
        blocks.push({
          ...block,
          children: undefined,
        });
      }

      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;
    }

    return blocks;
  }

  /* Recursively traverses children for a block while enforcing maxDepth and maxRequests. */
  private async traverseChildren(
    parentBlock: NotionBlockWithChildren,
    currentDepth: number,
    getRequestCount: () => number,
    setRequestCount: (val: number) => void,
    getIsComplete: () => boolean,
    setIsComplete: (val: boolean) => void,
    diagnostics: DiagnosticMessage[],
  ): Promise<void> {
    if (currentDepth > this.maxDepth) {
      diagnostics.push({
        code: 'MAX_DEPTH_REACHED',
        level: 'warn',
        message: `Maximum nesting depth of ${this.maxDepth} reached at block ${parentBlock.id}`,
        blockId: parentBlock.id,
        blockType: parentBlock.type,
        timestamp: new Date().toISOString(),
      });
      setIsComplete(false);
      return;
    }

    if (getRequestCount() >= this.maxRequests) {
      diagnostics.push({
        code: 'REQUEST_BUDGET_EXCEEDED',
        level: 'warn',
        message: `Request budget of ${this.maxRequests} reached before retrieving children for block ${parentBlock.id}`,
        blockId: parentBlock.id,
        blockType: parentBlock.type,
        timestamp: new Date().toISOString(),
      });
      setIsComplete(false);
      return;
    }

    try {
      const children = await this.fetchBlockCollection(
        parentBlock.id,
        getRequestCount,
        setRequestCount,
        getIsComplete,
        setIsComplete,
        diagnostics,
      );

      parentBlock.children = children;

      for (const child of children) {
        if (child.has_children) {
          await this.traverseChildren(
            child,
            currentDepth + 1,
            getRequestCount,
            setRequestCount,
            getIsComplete,
            setIsComplete,
            diagnostics,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to retrieve children for block ${parentBlock.id}`, error?.stack, {
        blockId: parentBlock.id,
        blockType: parentBlock.type,
      });

      diagnostics.push({
        code: 'CHILD_RETRIEVAL_FAILED',
        level: 'error',
        message: `Failed to retrieve children for block ${parentBlock.id}: ${error?.message || String(error)}`,
        blockId: parentBlock.id,
        blockType: parentBlock.type,
        timestamp: new Date().toISOString(),
      });
      setIsComplete(false);
    }
  }
}
