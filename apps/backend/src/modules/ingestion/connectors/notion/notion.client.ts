import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../../../config/configuration';
import { AppTracer } from '../../../../common/telemetry';
import { CircuitBreaker, RetryPolicy } from '../../../../common/resilience';
import { StructuredLogger } from '../../../../common/logger';
import { NotionBlockChildrenResponse, NotionPageResponse } from '../../types';
import {
  ConnectorPersistenceService,
  ConnectorConnectionStatus,
} from '../../../connector-persistence';

/* HTTP client communicating with the Notion REST API with resilience, tracing, and dynamic credentials */
@Injectable()
export class NotionClient {
  private readonly logger = new StructuredLogger('NotionClient');
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;
  private fetchFn: typeof fetch;

  constructor(
    private readonly configService: AppConfigService,
    @Optional()
    private readonly persistenceService?: ConnectorPersistenceService,
  ) {
    this.circuitBreaker = new CircuitBreaker({
      name: 'NotionClient',
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxProbes: 2,
    });

    this.retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 300,
      maxDelayMs: 5000,
      backoffFactor: 2,
      onRetry: (error, attempt, delayMs) => {
        this.logger.warn(`Retrying Notion request after failure`, {
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    this.fetchFn = fetch;
  }

  /* Injects a custom fetch implementation for offline testing */
  setFetchFunction(fn: typeof fetch): void {
    this.fetchFn = fn;
  }

  /* Dynamically resolves the access token from persisted connection */
  private async resolveAccessToken(): Promise<string> {
    if (this.persistenceService) {
      const token = await this.persistenceService.getDecryptedToken('notion');
      if (token) {
        return token;
      }
    }

    if (this.configService.notion.apiKey) {
      return this.configService.notion.apiKey;
    }

    throw new UnauthorizedException(
      'Notion connector is not connected or credentials are missing',
    );
  }

  /* Executes an HTTP request to the Notion API wrapped inside tracing, circuit breaker, and retry policy */
  private async executeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const config = this.configService.notion;
    const url = `${config.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const token = await this.resolveAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': config.apiVersion,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    return AppTracer.traceSpan(
      'notion.http_request',
      {
        attributes: {
          'http.url': url,
          'http.method': options.method || 'GET',
          'notion.api_version': config.apiVersion,
        },
      },
      async () => {
        return this.circuitBreaker.execute(async () => {
          return this.retryPolicy.execute(async (attempt: number) => {
            this.logger.debug(
              `Executing Notion HTTP call [attempt ${attempt}]`,
              {
                url,
                attempt,
              },
            );

            const response = await this.fetchFn(url, {
              ...options,
              headers,
            });

            if (!response.ok) {
              if (response.status === 401 && this.persistenceService) {
                this.logger.warn(
                  'Notion API returned HTTP 401 Unauthorized; marking connection as REAUTH_REQUIRED',
                );
                await this.persistenceService.updateStatus(
                  'notion',
                  ConnectorConnectionStatus.REAUTH_REQUIRED,
                );
              }

              let errorPayload: any;
              try {
                errorPayload = await response.json();
              } catch {
                errorPayload = { message: response.statusText };
              }

              const err = new Error(
                `Notion API error [${response.status}]: ${errorPayload?.message || response.statusText}`,
              );
              (err as any).status = response.status;
              (err as any).statusCode = response.status;
              (err as any).code =
                errorPayload?.code || `HTTP_${response.status}`;
              (err as any).response = {
                status: response.status,
                data: errorPayload,
              };

              /* Propagate retry-after guidance if provided */
              const retryAfter = response.headers?.get?.('Retry-After');
              if (retryAfter) {
                (err as any).retryAfter = parseInt(retryAfter, 10);
              }

              throw err;
            }

            if (this.persistenceService) {
              await this.persistenceService.recordVerification('notion');
            }

            return (await response.json()) as T;
          });
        });
      },
    );
  }

  /* Retrieves page metadata and properties by page identifier */
  async getPage(pageId: string): Promise<NotionPageResponse> {
    return AppTracer.traceSpan(
      'notion.get_page',
      {
        attributes: {
          'notion.page_id': pageId,
        },
      },
      async () => {
        return this.executeRequest<NotionPageResponse>(`/pages/${pageId}`);
      },
    );
  }

  /* Retrieves paginated child blocks for a specified parent block or page */
  async getBlockChildren(
    blockId: string,
    cursor?: string,
    pageSize = 100,
  ): Promise<NotionBlockChildrenResponse> {
    return AppTracer.traceSpan(
      'notion.get_block_children',
      {
        attributes: {
          'notion.block_id': blockId,
          'notion.cursor': cursor || 'none',
          'notion.page_size': pageSize,
        },
      },
      async () => {
        const queryParams = new URLSearchParams();
        if (cursor) {
          queryParams.set('start_cursor', cursor);
        }
        if (pageSize) {
          queryParams.set('page_size', String(pageSize));
        }

        const queryString = queryParams.toString();
        const endpoint = `/blocks/${blockId}/children${queryString ? `?${queryString}` : ''}`;

        return this.executeRequest<NotionBlockChildrenResponse>(endpoint);
      },
    );
  }
}
