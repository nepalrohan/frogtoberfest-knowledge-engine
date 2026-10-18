import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationsController } from './integrations.controller';
import { NotionOAuthService } from './notion-oauth.service';
import { ConnectionStorageService } from './connection-storage.service';
import { AppConfigService } from '../../config/configuration';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import { Response } from 'express';

describe('IntegrationsController', () => {
  let controller: IntegrationsController;
  let mockOAuthService: Partial<NotionOAuthService>;
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

    mockStorageService = {
      saveConnection: jest.fn(),
      getConnection: jest.fn(),
      disconnect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IntegrationsController],
      providers: [
        { provide: AppConfigService, useValue: mockConfigService },
        { provide: NotionOAuthService, useValue: mockOAuthService },
        { provide: ConnectionStorageService, useValue: mockStorageService },
      ],
    }).compile();

    controller = module.get<IntegrationsController>(IntegrationsController);
  });

  describe('GET oauth/authorize', () => {
    it('should return authorization URL', () => {
      const mockReq = { user: { id: 'admin-user', role: 'ADMIN' } } as any;
      const result = controller.authorize(mockReq);
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
    it('should have AdminAuthGuard applied to authorize, getStatus, and disconnect', () => {
      const authorizeGuards = Reflect.getMetadata('__guards__', controller.authorize);
      expect(authorizeGuards).toContain(AdminAuthGuard);

      const statusGuards = Reflect.getMetadata('__guards__', controller.getStatus);
      expect(statusGuards).toContain(AdminAuthGuard);

      const disconnectGuards = Reflect.getMetadata('__guards__', controller.disconnect);
      expect(disconnectGuards).toContain(AdminAuthGuard);
    });
  });
});
