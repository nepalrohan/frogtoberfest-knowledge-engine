import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotionOAuthService } from './notion-oauth.service';
import { AppConfigService } from '../../config/configuration';

describe('NotionOAuthService', () => {
  let service: NotionOAuthService;
  let mockConfigService: any;

  beforeEach(async () => {
    mockConfigService = {
      notion: {
        clientId: 'test-client-id-123',
        clientSecret: 'test-client-secret-456',
        redirectUri: 'http://localhost:5000/api/v1/integrations/notion/oauth/callback',
        authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionOAuthService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<NotionOAuthService>(NotionOAuthService);
    service.clearStates();
  });

  describe('State Management & Anti-CSRF', () => {
    it('should generate a 64-character hex state string', async () => {
      const state = await service.generateState('user-1');
      expect(state).toHaveLength(64);
    });

    it('should validate and consume state exactly once', async () => {
      const state = await service.generateState('user-1');

      /* First validation succeeds */
      const firstValid = await service.validateAndConsumeState(state);
      expect(firstValid).toBe(true);

      /* Replay attack fails */
      const secondValid = await service.validateAndConsumeState(state);
      expect(secondValid).toBe(false);
    });

    it('should reject unknown states', async () => {
      const valid = await service.validateAndConsumeState('unknown-state-token');
      expect(valid).toBe(false);
    });

    it('should reject empty or null state', async () => {
      expect(await service.validateAndConsumeState('')).toBe(false);
    });
  });

  describe('Authorization URL Generation', () => {
    it('should build a valid Notion OAuth authorization URL with correct parameters', async () => {
      const { authorizationUrl, state } =
        await service.generateAuthorizationUrl('user-1');

      expect(authorizationUrl).toBeDefined();
      expect(state).toBeDefined();

      const url = new URL(authorizationUrl);
      expect(url.origin).toBe('https://api.notion.com');
      expect(url.pathname).toBe('/v1/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('test-client-id-123');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('owner')).toBe('user');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:5000/api/v1/integrations/notion/oauth/callback',
      );
      expect(url.searchParams.get('state')).toBe(state);
    });
  });

  describe('Authorization Code Exchange (Offline Mocked)', () => {
    it('should exchange code for access token using Basic Auth and return workspace info', async () => {
      const mockResponse = {
        access_token: 'secret_notion_oauth_access_token_xyz',
        token_type: 'bearer',
        bot_id: 'bot-123',
        workspace_id: 'ws-789',
        workspace_name: 'Engineering Notion Workspace',
        workspace_icon: 'https://example.com/notion.png',
      };

      let capturedUrl = '';
      let capturedOptions: any = {};

      const mockFetch = jest.fn().mockImplementation((url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockResponse,
        });
      });

      service.setFetchFunction(mockFetch as unknown as typeof fetch);

      const result = await service.exchangeCodeForToken('auth-code-123');

      expect(result).toEqual(mockResponse);
      expect(capturedUrl).toBe('https://api.notion.com/v1/oauth/token');
      expect(capturedOptions.method).toBe('POST');

      const expectedBasicAuth = `Basic ${Buffer.from('test-client-id-123:test-client-secret-456').toString('base64')}`;
      expect(capturedOptions.headers['Authorization']).toBe(expectedBasicAuth);

      const parsedBody = JSON.parse(capturedOptions.body);
      expect(parsedBody.grant_type).toBe('authorization_code');
      expect(parsedBody.code).toBe('auth-code-123');
      expect(parsedBody.redirect_uri).toBe(
        'http://localhost:5000/api/v1/integrations/notion/oauth/callback',
      );
    });

    it('should throw BadRequestException if Notion token endpoint returns an error', async () => {
      const mockFetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: 'invalid_grant' }),
        }),
      );

      service.setFetchFunction(mockFetch as unknown as typeof fetch);

      await expect(service.exchangeCodeForToken('invalid-code')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
