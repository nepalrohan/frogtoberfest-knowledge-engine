import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AppConfigService } from '../../config/configuration';
import { StructuredLogger } from '../../common/logger';
import { AppTracer } from '../../common/telemetry';
import { CircuitBreaker, RetryPolicy } from '../../common/resilience';

export interface OAuthStateEntry {
  state: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  consumed: boolean;
}

export interface NotionOAuthTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  workspace_id: string;
  owner?: {
    type: string;
    user?: {
      object: string;
      id: string;
      name?: string;
      avatar_url?: string;
      type?: string;
      person?: { email?: string };
    };
  };
  duplicated_template_id?: string | null;
}

/* Service handling Notion OAuth 2.0 flow: anti-CSRF state management, URL generation, and token exchange */
@Injectable()
export class NotionOAuthService {
  private readonly logger = new StructuredLogger('NotionOAuthService');
  private readonly states = new Map<string, OAuthStateEntry>();
  private readonly ttlMs = 10 * 60 * 1000; /* 10 minutes */
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;
  private fetchFn: typeof fetch;

  constructor(private readonly configService: AppConfigService) {
    this.circuitBreaker = new CircuitBreaker({
      name: 'NotionOAuthTokenExchange',
      failureThreshold: 3,
      resetTimeoutMs: 15000,
    });

    this.retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 200,
      maxDelayMs: 2000,
      backoffFactor: 2,
      onRetry: (error, attempt, delayMs) => {
        this.logger.warn('Retrying Notion OAuth token exchange', {
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    this.fetchFn = fetch;
  }

  /* Allows overriding fetch function in tests to prevent live network calls */
  setFetchFunction(customFetch: typeof fetch): void {
    this.fetchFn = customFetch;
  }

  /* Generates a 32-byte cryptographically secure state with a 10-minute TTL */
  generateState(userId: string = 'default-user'): string {
    const state = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    this.cleanupExpiredStates();

    this.states.set(state, {
      state,
      userId,
      createdAt: now,
      expiresAt,
      consumed: false,
    });

    return state;
  }

  /* Constructs the authoritative Notion OAuth authorization URL */
  generateAuthorizationUrl(userId: string = 'default-user'): {
    authorizationUrl: string;
    state: string;
  } {
    const config = this.configService.notion;
    if (!config.clientId) {
      throw new InternalServerErrorException(
        'Notion Client ID is not configured',
      );
    }

    const state = this.generateState(userId);
    const authUrl = new URL(config.authorizationUrl);

    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('owner', 'user');
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('state', state);

    this.logger.log('Generated Notion OAuth authorization URL', {
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    });

    return {
      authorizationUrl: authUrl.toString(),
      state,
    };
  }

  /* Validates the state parameter and consumes it immediately to prevent replay attacks */
  validateAndConsumeState(state: string): boolean {
    if (!state) {
      return false;
    }

    const entry = this.states.get(state);
    if (!entry) {
      return false;
    }

    if (entry.consumed) {
      return false;
    }

    const now = Date.now();
    if (now > entry.expiresAt.getTime()) {
      this.states.delete(state);
      return false;
    }

    /* Consume state immediately upon successful check */
    entry.consumed = true;
    return true;
  }

  /* Exchanges the authorization code for an access token via Notion API using HTTP Basic Auth */
  async exchangeCodeForToken(code: string): Promise<NotionOAuthTokenResponse> {
    if (!code) {
      throw new BadRequestException('Authorization code is required');
    }

    const config = this.configService.notion;
    if (!config.clientId || !config.clientSecret) {
      throw new InternalServerErrorException(
        'Notion OAuth credentials are not fully configured',
      );
    }

    const tokenUrl = 'https://api.notion.com/v1/oauth/token';
    const basicAuth = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString('base64');

    return AppTracer.traceSpan(
      'notion.oauth.exchange_token',
      {
        attributes: {
          'oauth.provider': 'notion',
          'http.target': tokenUrl,
        },
      },
      async () => {
        return this.circuitBreaker.execute(async () => {
          return this.retryPolicy.execute(async () => {
            const response = await this.fetchFn(tokenUrl, {
              method: 'POST',
              headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: config.redirectUri,
              }),
            });

            if (!response.ok) {
              const errorText = await response.text();
              this.logger.error('Notion OAuth token exchange failed', {
                status: response.status,
                errorText,
              });
              throw new BadRequestException(
                `Notion token exchange failed: ${errorText}`,
              );
            }

            const data = (await response.json()) as NotionOAuthTokenResponse;

            this.logger.log('Notion OAuth token exchanged successfully', {
              workspaceId: data.workspace_id,
              workspaceName: data.workspace_name,
            });

            return data;
          });
        });
      },
    );
  }

  /* Cleans up expired states from memory */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [key, entry] of this.states.entries()) {
      if (now > entry.expiresAt.getTime() || entry.consumed) {
        this.states.delete(key);
      }
    }
  }

  /* Clears all state records (for testing) */
  clearStates(): void {
    this.states.clear();
  }
}
