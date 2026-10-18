import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { NotionOAuthService } from '../../src/modules/integrations/notion-oauth.service';
import { ConnectionStorageService } from '../../src/modules/integrations/connection-storage.service';
import { AppConfigService } from '../../src/config/configuration';

/* End-to-end contract tests verifying the complete Notion OAuth 2.0 lifecycle offline without external API calls */
describe('Notion OAuth Integration (e2e contract)', () => {
  let app: INestApplication;
  let oAuthService: NotionOAuthService;
  let storageService: ConnectionStorageService;
  let configService: AppConfigService;
  let adminKey: string;

  const mockNotionTokenResponse = {
    access_token: 'secret_test_notion_access_token_super_confidential_999',
    token_type: 'bearer',
    bot_id: 'bot_uuid_001',
    workspace_name: 'Antigravity Workspace',
    workspace_icon: 'https://example.com/notion-icon.png',
    workspace_id: 'workspace_uuid_12345',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    oAuthService = app.get(NotionOAuthService);
    storageService = app.get(ConnectionStorageService);
    configService = app.get(AppConfigService);
    adminKey = configService.adminApiKey || 'default-admin-api-key-for-dev';

    /* Enforce mock fetch to prevent any live HTTP requests to Notion */
    const mockFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth/token')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockNotionTokenResponse,
        });
      }
      return Promise.reject(new Error(`Unexpected outbound network call to ${url}`));
    });

    oAuthService.setFetchFunction(mockFetch as unknown as typeof fetch);
  });

  beforeEach(async () => {
    await storageService.clearAll();
    oAuthService.clearStates();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Scenario 0: Unauthorized request without admin credentials is rejected with 401 Unauthorized', async () => {
    /* Status endpoint requires admin key */
    await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/status')
      .expect(401);

    /* Authorize endpoint requires admin key */
    await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/oauth/authorize')
      .expect(401);

    /* Disconnect endpoint requires admin key */
    await request(app.getHttpServer())
      .post('/api/v1/integrations/notion/disconnect')
      .expect(401);
  });

  it('Scenario 1: Initial state returns disconnected with zero credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/status')
      .set('x-admin-key', adminKey)
      .expect(200);

    expect(response.body).toEqual({
      connected: false,
      workspaceId: null,
      workspaceName: null,
      workspaceIcon: null,
      connectedAt: null,
    });

    /* Strict verification of zero token leakage */
    const stringified = JSON.stringify(response.body);
    expect(stringified).not.toContain('secret_test_notion_access_token');
    expect(stringified).not.toContain('credential_ref');
    expect(response.body.access_token).toBeUndefined();
  });

  it('Scenario 2: Initiate OAuth authorization returns valid URL with anti-CSRF state', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/oauth/authorize')
      .set('x-admin-key', adminKey)
      .expect(200);

    expect(response.body.authorizationUrl).toBeDefined();

    const authUrl = new URL(response.body.authorizationUrl);
    expect(authUrl.origin).toBe('https://api.notion.com');
    expect(authUrl.pathname).toBe('/v1/oauth/authorize');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('owner')).toBe('user');
    expect(authUrl.searchParams.get('state')).toBeTruthy();
  });

  it('Scenario 3: Complete flow: initiate, callback token exchange, query status, and verify zero token leakage', async () => {
    /* 1. Initiate authorization with admin header */
    const authRes = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/oauth/authorize')
      .set('x-admin-key', adminKey)
      .expect(200);

    const authUrl = new URL(authRes.body.authorizationUrl);
    const state = authUrl.searchParams.get('state')!;
    expect(state).toBeDefined();

    /* 2. Process callback redirect (called by browser redirect from Notion, no admin key) */
    const callbackRes = await request(app.getHttpServer())
      .get(`/api/v1/integrations/notion/oauth/callback?code=mock_code_abc&state=${state}`)
      .expect(302);

    expect(callbackRes.header.location).toContain('/integrations?status=success');
    expect(callbackRes.header.location).toContain(
      encodeURIComponent('Antigravity Workspace'),
    );

    /* 3. Query connection status with admin header */
    const statusRes = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/status')
      .set('x-admin-key', adminKey)
      .expect(200);

    expect(statusRes.body.connected).toBe(true);
    expect(statusRes.body.workspaceId).toBe('workspace_uuid_12345');
    expect(statusRes.body.workspaceName).toBe('Antigravity Workspace');
    expect(statusRes.body.workspaceIcon).toBe('https://example.com/notion-icon.png');
    expect(statusRes.body.connectedAt).toBeDefined();

    /* Zero token leakage assertion */
    const statusBody = JSON.stringify(statusRes.body);
    expect(statusBody).not.toContain(mockNotionTokenResponse.access_token);
    expect(statusBody).not.toContain('credential_ref');
    expect(statusRes.body.access_token).toBeUndefined();

    /* 4. Verify internal storage has encrypted credentials */
    const storedConn = await storageService.getConnection('notion');
    expect(storedConn?.status).toBe('connected');
    expect(storedConn?.connected_by).toBe('admin-user');
    expect(storedConn?.credential_ref).not.toContain(
      mockNotionTokenResponse.access_token,
    );
    expect(storedConn?.credential_ref.split('.')).toHaveLength(3);

    /* Decrypted token is valid */
    const decrypted = await storageService.getDecryptedToken('notion');
    expect(decrypted).toBe(mockNotionTokenResponse.access_token);
  });

  it('Scenario 4: Replay attack fails with invalid_state redirect', async () => {
    /* 1. Initiate authorization */
    const authRes = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/oauth/authorize')
      .set('x-admin-key', adminKey)
      .expect(200);

    const state = new URL(authRes.body.authorizationUrl).searchParams.get('state')!;

    /* 2. First callback succeeds */
    await request(app.getHttpServer())
      .get(`/api/v1/integrations/notion/oauth/callback?code=first_code&state=${state}`)
      .expect(302);

    /* 3. Replay with same state is rejected */
    const replayRes = await request(app.getHttpServer())
      .get(`/api/v1/integrations/notion/oauth/callback?code=second_code&state=${state}`)
      .expect(302);

    expect(replayRes.header.location).toContain(
      '/integrations?status=error&message=invalid_state',
    );
  });

  it('Scenario 5: User cancellation redirects with cancelled status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/oauth/callback?error=access_denied')
      .expect(302);

    expect(res.header.location).toContain(
      '/integrations?status=cancelled&error=access_denied',
    );
  });

  it('Scenario 6: Disconnect removes credentials and marks status disconnected', async () => {
    /* Set up active connection */
    await storageService.saveConnection({
      workspaceId: 'ws-active',
      workspaceName: 'To Disconnect',
      workspaceIcon: null,
      accessToken: 'token-to-revoke',
      connectedBy: 'admin-user',
    });

    const preStatus = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/status')
      .set('x-admin-key', adminKey)
      .expect(200);
    expect(preStatus.body.connected).toBe(true);

    /* Disconnect with admin key */
    const disconnectRes = await request(app.getHttpServer())
      .post('/api/v1/integrations/notion/disconnect')
      .set('x-admin-key', adminKey)
      .expect(201);

    expect(disconnectRes.body).toEqual({
      success: true,
      message: 'Notion integration disconnected successfully',
    });

    /* Verify post-disconnect status */
    const postStatus = await request(app.getHttpServer())
      .get('/api/v1/integrations/notion/status')
      .set('x-admin-key', adminKey)
      .expect(200);

    expect(postStatus.body).toEqual({
      connected: false,
      workspaceId: null,
      workspaceName: null,
      workspaceIcon: null,
      connectedAt: null,
    });

    /* Token cannot be retrieved */
    const token = await storageService.getDecryptedToken('notion');
    expect(token).toBeNull();

    /* Repeated disconnect is idempotent and succeeds */
    const repeatDisconnect = await request(app.getHttpServer())
      .post('/api/v1/integrations/notion/disconnect')
      .set('x-admin-key', adminKey)
      .expect(201);
    expect(repeatDisconnect.body.success).toBe(true);
  });
});
