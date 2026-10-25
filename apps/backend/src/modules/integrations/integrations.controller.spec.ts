import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { NotionOAuthService } from './notion-oauth.service';
import { NotionPagesService } from './notion-pages.service';
import { ConnectionStorageService } from './connection-storage.service';
import { AppConfigService } from '../../config/configuration';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { Response } from 'express';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;
  let mockOAuthService: Partial<NotionOAuthService>;
  let mockPagesService: Partial<NotionPagesService>;
  let mockStorageService: Partial<ConnectionStorageService>;
  let mockConfigService: Partial<AppConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      frontendUrl: 'http://localhost:3000',
    };

    mockOAuthService = {
      generateAuthorizationUrl: jest.fn().mockReturnValue({
        authorizationUrl: 'https://api.notion.com/v1/oauth/authorize?state=test-state',
        state: 'test-state',
      }),
      validateAndConsumeState: jest.fn(),
      exchangeCodeForToken: jest.fn(),
    };

    mockPagesService = {
      fetchWorkspacePages: jest.fn().mockResolvedValue([
        { id: 'page-1', title: 'Roadmap', depth: 0, meta: '2 pages' },
      ]),
      validateTokenAndGetWorkspace: jest.fn().mockResolvedValue({
        workspaceId: 'ws-token-1',
        workspaceName: 'Token Workspace',
        workspaceIcon: null,
      }),
    };

    mockStorageService = {
      saveConnection: jest.fn(),
      getConnection: jest.fn(),
      getDecryptedToken: jest.fn(),
      getSelectedPages: jest.fn(),
      saveSelectedPages: jest.fn(),
      disconnect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: AppConfigService, useValue: mockConfigService },
        { provide: NotionOAuthService, useValue: mockOAuthService },
        { provide: NotionPagesService, useValue: mockPagesService },
        { provide: ConnectionStorageService, useValue: mockStorageService },
      ],
    }).compile();

    controller = module.get<IntegrationsController>(IntegrationsController);
  });

  describe('GET oauth/authorize', () => {
    it('should return authorization URL', async () => {
      const mockReq = { user: { id: 'admin-user', role: 'ADMIN' } } as any;
      const result = await controller.authorize(mockReq);
      expect(result).toEqual({
        authorizationUrl:
          'https://api.notion.com/v1/oauth/authorize?state=test-state',
      });
      expect(mockOAuthService.generateAuthorizationUrl).toHaveBeenCalledWith('admin-user');
    });
  });

  describe('GET oauth/callback', () => {
    let mockRes: Partial<Response>;

    beforeEach(() => {
      mockRes = {
        redirect: jest.fn(),
      };
    });

    it('should redirect with cancelled status if error query parameter is present', async () => {
      await controller.callback(
        undefined,
        undefined,
        'access_denied',
        mockRes as Response,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:3000/integrations?status=cancelled&error=access_denied',
      );
    });

    it('should redirect with invalid_state error if state is invalid', async () => {
      (mockOAuthService.validateAndConsumeState as jest.Mock).mockReturnValue(
        false,
      );

      await controller.callback('valid-code', 'invalid-state', undefined, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:3000/integrations?status=error&message=invalid_state',
      );
    });

    it('should redirect with missing_code error if code is absent', async () => {
      (mockOAuthService.validateAndConsumeState as jest.Mock).mockReturnValue(
        true,
      );

      await controller.callback(undefined, 'valid-state', undefined, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:3000/integrations?status=error&message=missing_code',
      );
    });

    it('should exchange token, persist connection, and redirect with success', async () => {
      (mockOAuthService.validateAndConsumeState as jest.Mock).mockReturnValue(
        true,
      );
      (mockOAuthService.exchangeCodeForToken as jest.Mock).mockResolvedValue({
        access_token: 'secret_mock_token',
        workspace_id: 'ws-123',
        workspace_name: 'Acme Workspace',
        workspace_icon: 'https://example.com/icon.png',
      });

      await controller.callback('valid-code', 'valid-state', undefined, mockRes as Response);

      expect(mockStorageService.saveConnection).toHaveBeenCalledWith({
        workspaceId: 'ws-123',
        workspaceName: 'Acme Workspace',
        workspaceIcon: 'https://example.com/icon.png',
        accessToken: 'secret_mock_token',
        connectedBy: 'admin-user',
      });

      expect(mockRes.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:3000/integrations?status=success&workspace=Acme%20Workspace',
      );
    });

    it('should redirect with exchange_failed if token exchange throws', async () => {
      (mockOAuthService.validateAndConsumeState as jest.Mock).mockReturnValue(
        true,
      );
      (mockOAuthService.exchangeCodeForToken as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await controller.callback('valid-code', 'valid-state', undefined, mockRes as Response);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:3000/integrations?status=error&message=exchange_failed',
      );
    });
  });

  describe('GET status', () => {
    it('should return disconnected status when no connection exists', async () => {
      (mockStorageService.getConnection as jest.Mock).mockResolvedValue(null);

      const status = await controller.getStatus();
      expect(status).toEqual({
        connected: false,
        workspaceId: null,
        workspaceName: null,
        workspaceIcon: null,
        connectedAt: null,
        selectedPagesCount: 0,
      });
    });

    it('should return connected status with metadata when connection is active', async () => {
      const now = new Date();
      (mockStorageService.getConnection as jest.Mock).mockResolvedValue({
        workspace_id: 'ws-123',
        workspace_name: 'Acme Workspace',
        workspace_icon: 'https://example.com/icon.png',
        status: 'connected',
        updated_at: now,
      });

      const status = await controller.getStatus();
      expect(status).toEqual({
        connected: true,
        workspaceId: 'ws-123',
        workspaceName: 'Acme Workspace',
        workspaceIcon: 'https://example.com/icon.png',
        connectedAt: now.toISOString(),
        selectedPagesCount: 0,
      });
    });
  });

  describe('GET pages', () => {
    it('should return empty pages and selections if disconnected', async () => {
      (mockStorageService.getConnection as jest.Mock).mockResolvedValue(null);

      const result = await controller.getPages();
      expect(result).toEqual({ pages: [], selectedPageIds: [] });
    });

    it('should fetch pages from NotionPagesService and return selectedPageIds', async () => {
      (mockStorageService.getConnection as jest.Mock).mockResolvedValue({
        status: 'connected',
      });
      (mockStorageService.getDecryptedToken as jest.Mock).mockResolvedValue('test-token');
      (mockStorageService.getSelectedPages as jest.Mock).mockResolvedValue(['page-1']);

      const result = await controller.getPages();
      expect(result).toEqual({
        pages: [{ id: 'page-1', title: 'Roadmap', depth: 0, meta: '2 pages' }],
        selectedPageIds: ['page-1'],
      });
      expect(mockPagesService.fetchWorkspacePages).toHaveBeenCalledWith('test-token');
    });
  });

  describe('POST pages', () => {
    it('should save selected page IDs and return updated selection count', async () => {
      (mockStorageService.getConnection as jest.Mock).mockResolvedValue({
        status: 'connected',
      });
      (mockStorageService.saveSelectedPages as jest.Mock).mockResolvedValue(['page-1', 'page-2']);

      const response = await controller.savePages({ pageIds: ['page-1', 'page-2'] });
      expect(response).toEqual({
        success: true,
        selectedCount: 2,
        selectedPageIds: ['page-1', 'page-2'],
        syncJobId: expect.any(String),
      });
      expect(mockStorageService.saveSelectedPages).toHaveBeenCalledWith('notion', ['page-1', 'page-2']);
    });

    it('should allow saving zero selected pages (decoupling connection from document selection)', async () => {
      (mockStorageService.getConnection as jest.Mock).mockResolvedValue({
        status: 'connected',
      });
      (mockStorageService.saveSelectedPages as jest.Mock).mockResolvedValue([]);

      const response = await controller.savePages({ pageIds: [] });
      expect(response).toEqual({
        success: true,
        selectedCount: 0,
        selectedPageIds: [],
        syncJobId: expect.any(String),
      });
    });

    it('should return empty sync items when persistence service is not provided', async () => {
      const response = await controller.getSyncStatus();
      expect(response).toEqual({
        provider: 'notion',
        items: [],
      });
    });
  });

  describe('POST token', () => {
    it('should validate token and persist connection without OAuth page picker', async () => {
      const response = await controller.connectWithToken({
        token: 'secret_integration_token',
        workspaceName: 'Engineering Workspace',
      });

      expect(mockPagesService.validateTokenAndGetWorkspace).toHaveBeenCalledWith(
        'secret_integration_token',
        'Engineering Workspace',
      );
      expect(mockStorageService.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'secret_integration_token',
          workspaceName: 'Token Workspace',
        }),
      );
      expect(response).toEqual({
        success: true,
        workspaceName: 'Token Workspace',
      });
    });
  });

  describe('POST disconnect', () => {
    it('should disconnect provider and return success response', async () => {
      const response = await controller.disconnect();

      expect(mockStorageService.disconnect).toHaveBeenCalledWith('notion');
      expect(response).toEqual({
        success: true,
        message: 'Notion integration disconnected successfully',
      });
    });
  });

  describe('Admin Guard Protection', () => {
    it('should have AdminAuthGuard applied to all management endpoints', () => {
      const authorizeGuards = Reflect.getMetadata('__guards__', controller.authorize);
      expect(authorizeGuards).toContain(AdminAuthGuard);

      const statusGuards = Reflect.getMetadata('__guards__', controller.getStatus);
      expect(statusGuards).toContain(AdminAuthGuard);

      const pagesGuards = Reflect.getMetadata('__guards__', controller.getPages);
      expect(pagesGuards).toContain(AdminAuthGuard);

      const savePagesGuards = Reflect.getMetadata('__guards__', controller.savePages);
      expect(savePagesGuards).toContain(AdminAuthGuard);

      const tokenGuards = Reflect.getMetadata('__guards__', controller.connectWithToken);
      expect(tokenGuards).toContain(AdminAuthGuard);

      const disconnectGuards = Reflect.getMetadata('__guards__', controller.disconnect);
      expect(disconnectGuards).toContain(AdminAuthGuard);
    });
  });
});
