import { Test, TestingModule } from '@nestjs/testing';
import { NotionPagesService } from './notion-pages.service';
import { AppConfigService } from '../../config/configuration';
import { BadRequestException } from '@nestjs/common';

describe('NotionPagesService', () => {
  let service: NotionPagesService;
  let mockConfigService: Partial<AppConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      notion: {
        baseUrl: 'https://api.notion.com/v1',
        apiVersion: '2022-06-28',
        apiKey: '',
        maxDepth: 5,
        maxRequests: 50,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:5000/callback',
        authorizationUrl: 'https://api.notion.com/oauth/authorize',
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionPagesService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<NotionPagesService>(NotionPagesService);
  });

  describe('fetchWorkspacePages', () => {
    it('should query Notion search API and return a depth-ordered page hierarchy', async () => {
      const mockRawResults = [
        {
          id: 'root-1',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'Engineering' }],
            },
          },
        },
        {
          id: 'child-1-1',
          object: 'page',
          parent: { type: 'page_id', page_id: 'root-1' },
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'Runbooks' }],
            },
          },
        },
        {
          id: 'child-1-1-1',
          object: 'page',
          parent: { type: 'page_id', page_id: 'child-1-1' },
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'Deployment' }],
            },
          },
        },
        {
          id: 'db-1',
          object: 'database',
          parent: { type: 'workspace', workspace: true },
          title: [{ plain_text: 'Tasks Database' }],
        },
      ];

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'list',
          results: mockRawResults,
          has_more: false,
        }),
      });

      service.setFetchFunction(mockFetch as unknown as typeof fetch);

      const pages = await service.fetchWorkspacePages('secret_test_token');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.notion.com/v1/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer secret_test_token',
          }),
        }),
      );

      /* Engineering (depth 0) -> Runbooks (depth 1) -> Deployment (depth 2) */
      expect(pages).toHaveLength(4);
      expect(pages[0]!.id).toBe('root-1');
      expect(pages[0]!.depth).toBe(0);
      expect(pages[0]!.meta).toBe('1 page');

      expect(pages[1]!.id).toBe('child-1-1');
      expect(pages[1]!.depth).toBe(1);
      expect(pages[1]!.meta).toBe('1 page');

      expect(pages[2]!.id).toBe('child-1-1-1');
      expect(pages[2]!.depth).toBe(2);

      expect(pages[3]!.id).toBe('db-1');
      expect(pages[3]!.title).toBe('Tasks Database');
      expect(pages[3]!.depth).toBe(0);
      expect(pages[3]!.meta).toBe('Database');
    });

    it('should throw BadRequestException if access token is invalid or expired', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      service.setFetchFunction(mockFetch as unknown as typeof fetch);

      await expect(service.fetchWorkspacePages('expired_token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateTokenAndGetWorkspace', () => {
    it('should validate token and extract workspace name from bot user', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          object: 'user',
          id: 'bot-123',
          type: 'bot',
          bot: {
            owner: { type: 'workspace', workspace: true },
            workspace_name: 'Antigravity Workspace',
          },
        }),
      });

      service.setFetchFunction(mockFetch as unknown as typeof fetch);

      const result = await service.validateTokenAndGetWorkspace('secret_valid_token');
      expect(result).toEqual({
        workspaceId: 'bot-123',
        workspaceName: 'Antigravity Workspace',
        workspaceIcon: null,
      });
    });

    it('should throw BadRequestException when token validation fails', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      service.setFetchFunction(mockFetch as unknown as typeof fetch);

      await expect(
        service.validateTokenAndGetWorkspace('invalid_token'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
