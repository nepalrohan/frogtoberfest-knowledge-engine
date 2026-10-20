import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { AppConfigService } from '../../config/configuration';
import { StructuredLogger } from '../../common/logger';
import { NotionPageNodeDto } from './dto';
import {
  ConnectorPersistenceService,
  ConnectorConnectionStatus,
} from '../connector-persistence';

interface NotionSearchRawItem {
  id: string;
  object: 'page' | 'database';
  parent?: {
    type?: string;
    page_id?: string;
    database_id?: string;
    block_id?: string;
    workspace?: boolean;
  };
  properties?: Record<string, any>;
  title?: Array<{ plain_text?: string }>;
  icon?: {
    type?: string;
    emoji?: string;
    external?: { url?: string };
    file?: { url?: string };
  };
  last_edited_time?: string;
}

interface NotionSearchResponse {
  object: 'list';
  results: NotionSearchRawItem[];
  next_cursor?: string | null;
  has_more: boolean;
}

/* Service responsible for communicating with Notion Search API and serializing workspace document trees */
@Injectable()
export class NotionPagesService {
  private readonly logger = new StructuredLogger('NotionPagesService');
  private fetchFn: typeof fetch = fetch;

  constructor(
    private readonly configService: AppConfigService,
    @Optional()
    private readonly persistenceService?: ConnectorPersistenceService,
  ) { }

  /* Allows overriding the fetch implementation for isolated unit and e2e testing */
  setFetchFunction(customFetch: typeof fetch): void {
    this.fetchFn = customFetch;
  }

  /* Validates an integration token against Notion and extracts workspace metadata */
  async validateTokenAndGetWorkspace(
    token: string,
    fallbackName?: string,
  ): Promise<{ workspaceId: string; workspaceName: string; workspaceIcon: string | null }> {
    const config = this.configService.notion;
    const url = `${config.baseUrl}/users/me`;

    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': config.apiVersion || '2022-06-28',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        this.logger.warn('Failed Notion token validation', { status: response.status });
        throw new BadRequestException('Invalid Notion token or insufficient permissions');
      }

      const data: any = await response.json();
      const workspaceName =
        data.bot?.workspace_name || fallbackName || 'Notion Workspace';
      const workspaceId =
        data.bot?.owner?.workspace?.id || data.id || 'notion-workspace';

      return {
        workspaceId,
        workspaceName,
        workspaceIcon: null,
      };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error('Error validating Notion token', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new BadRequestException('Could not connect to Notion with provided token');
    }
  }

  /* Fetches shared pages and databases from Notion Search API and organizes them into a depth-ordered tree */
  async fetchWorkspacePages(accessToken?: string): Promise<NotionPageNodeDto[]> {
    const config = this.configService.notion;
    let token = accessToken;
    if (!token && this.persistenceService) {
      token = (await this.persistenceService.getDecryptedToken('notion')) || '';
    }
    if (!token) {
      throw new BadRequestException('Notion access token is required');
    }

    const searchUrl = `${config.baseUrl}/search`;
    const rawItems: NotionSearchRawItem[] = [];
    let cursor: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;
    const maxPages = 5;

    while (hasMore && pageCount < maxPages) {
      pageCount++;
      const bodyPayload: Record<string, any> = {
        sort: {
          direction: 'descending',
          timestamp: 'last_edited_time',
        },
        page_size: 100,
      };
      if (cursor) {
        bodyPayload.start_cursor = cursor;
      }

      let response: Response;
      try {
        response = await this.fetchFn(searchUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': config.apiVersion || '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });
      } catch (err) {
        this.logger.error('Network error calling Notion search API', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new InternalServerErrorException('Failed to reach Notion API');
      }

      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && this.persistenceService) {
          await this.persistenceService.updateStatus(
            'notion',
            ConnectorConnectionStatus.REAUTH_REQUIRED,
          );
        }

        const errorText = await response.text().catch(() => '');
        this.logger.error('Notion search API returned error status', {
          status: response.status,
          errorText,
        });
        if (response.status === 401 || response.status === 403) {
          throw new BadRequestException('Notion access token has expired or is unauthorized');
        }
        throw new InternalServerErrorException('Error retrieving documents from Notion');
      }

      const data = (await response.json()) as NotionSearchResponse;
      if (Array.isArray(data.results)) {
        rawItems.push(...data.results);
      }
      hasMore = Boolean(data.has_more && data.next_cursor);
      cursor = data.next_cursor || undefined;
    }

    if (this.persistenceService) {
      await this.persistenceService.recordVerification('notion');
    }

    return this.buildHierarchicalNodes(rawItems);
  }

  /* Transforms raw Notion items into a flat depth-ordered tree suitable for nested selection */
  private buildHierarchicalNodes(items: NotionSearchRawItem[]): NotionPageNodeDto[] {
    const itemMap = new Map<string, {
      id: string;
      title: string;
      parentId: string | null;
      object: 'page' | 'database';
      icon: string | null;
      lastEditedTime?: string;
    }>();

    for (const item of items) {
      if (!item.id) continue;
      const title = this.extractTitle(item);
      const parentId = this.extractParentId(item);
      const icon = this.extractIcon(item);

      itemMap.set(item.id, {
        id: item.id,
        title,
        parentId,
        object: item.object,
        icon,
        lastEditedTime: item.last_edited_time,
      });
    }

    /* Build parent -> children map */
    const childrenMap = new Map<string, string[]>();
    for (const [id, node] of itemMap.entries()) {
      if (node.parentId && itemMap.has(node.parentId)) {
        const existing = childrenMap.get(node.parentId) || [];
        existing.push(id);
        childrenMap.set(node.parentId, existing);
      }
    }

    /* Identify root items: parentId is null OR parentId is not in retrieved items */
    const rootIds: string[] = [];
    for (const [id, node] of itemMap.entries()) {
      if (!node.parentId || !itemMap.has(node.parentId)) {
        rootIds.push(id);
      }
    }

    /* Sort roots by title */
    rootIds.sort((a, b) => {
      const titleA = itemMap.get(a)?.title || '';
      const titleB = itemMap.get(b)?.title || '';
      return titleA.localeCompare(titleB);
    });

    const orderedNodes: NotionPageNodeDto[] = [];
    const visited = new Set<string>();

    /* Depth-first traversal ensures children immediately follow their parents */
    const traverse = (nodeId: string, depth: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = itemMap.get(nodeId);
      if (!node) return;

      const children = (childrenMap.get(nodeId) || []).sort((a, b) => {
        const titleA = itemMap.get(a)?.title || '';
        const titleB = itemMap.get(b)?.title || '';
        return titleA.localeCompare(titleB);
      });

      let meta = '';
      if (children.length > 0) {
        meta = `${children.length} ${children.length === 1 ? 'page' : 'pages'}`;
      } else if (node.object === 'database') {
        meta = 'Database';
      } else if (node.lastEditedTime) {
        const date = new Date(node.lastEditedTime);
        meta = `Edited ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      }

      orderedNodes.push({
        id: node.id,
        title: node.title,
        depth,
        meta,
        parentId: node.parentId,
        object: node.object,
        icon: node.icon,
      });

      for (const childId of children) {
        traverse(childId, depth + 1);
      }
    };

    for (const rootId of rootIds) {
      traverse(rootId, 0);
    }

    return orderedNodes;
  }

  /* Extracts plain text title from either a database or page object */
  private extractTitle(item: NotionSearchRawItem): string {
    if (item.object === 'database') {
      if (Array.isArray(item.title) && item.title.length > 0) {
        const plain = item.title.map((t) => t.plain_text || '').join('').trim();
        if (plain) return plain;
      }
      return 'Untitled Database';
    }

    if (item.properties) {
      /* Look for property with type: 'title' */
      for (const prop of Object.values(item.properties)) {
        if (prop && prop.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
          const plain = prop.title.map((t: any) => t.plain_text || '').join('').trim();
          if (plain) return plain;
        }
      }

      /* Check common property names */
      if (item.properties.Name && Array.isArray(item.properties.Name.title)) {
        const plain = item.properties.Name.title.map((t: any) => t.plain_text || '').join('').trim();
        if (plain) return plain;
      }

      if (item.properties.title && Array.isArray(item.properties.title.title)) {
        const plain = item.properties.title.title.map((t: any) => t.plain_text || '').join('').trim();
        if (plain) return plain;
      }
    }

    return 'Untitled Page';
  }

  /* Extracts parent ID from parent metadata */
  private extractParentId(item: NotionSearchRawItem): string | null {
    if (!item.parent) return null;
    if (item.parent.page_id) return item.parent.page_id;
    if (item.parent.database_id) return item.parent.database_id;
    if (item.parent.block_id) return item.parent.block_id;
    return null;
  }

  /* Extracts icon string if available */
  private extractIcon(item: NotionSearchRawItem): string | null {
    if (!item.icon) return null;
    if (item.icon.type === 'emoji' && item.icon.emoji) return item.icon.emoji;
    if (item.icon.type === 'external' && item.icon.external?.url) return item.icon.external.url;
    if (item.icon.type === 'file' && item.icon.file?.url) return item.icon.file.url;
    return null;
  }
}
