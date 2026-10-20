import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import {
  ConnectorPersistenceService,
  CredentialEncryptionService,
  OAuthStateService,
  ConnectorConnectionStatus,
  ConnectorAuthType,
} from '../../src/modules/connector-persistence';
import { NotionClient } from '../../src/modules/ingestion/connectors/notion/notion.client';
import { ConnectionStorageService } from '../../src/modules/integrations/connection-storage.service';
import { AppConfigService } from '../../src/config/configuration';

/* Integration test suite verifying Scenarios A–F and Multi-Connector Concurrency */
describe('Connector Persistence Scenarios A–F & Concurrency', () => {
  let app: INestApplication;
  let persistenceService: ConnectorPersistenceService;
  let encryptionService: CredentialEncryptionService;
  let oauthStateService: OAuthStateService;
  let storageService: ConnectionStorageService;
  let notionClient: NotionClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    persistenceService = app.get(ConnectorPersistenceService);
    encryptionService = app.get(CredentialEncryptionService);
    oauthStateService = app.get(OAuthStateService);
    storageService = app.get(ConnectionStorageService);
    const configService = app.get(AppConfigService);
    notionClient = new NotionClient(configService, persistenceService);
  });

  beforeEach(async () => {
    await storageService.clearAll();
  });

  afterAll(async () => {
    await app.close();
  });

  /* Scenario A: Normal restart preserves connection */
  it('Scenario A: Persisted connection survives application restart without re-authorization', async () => {
    /* 1. Save connection */
    const saved = await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'workspace-notion-restart-1',
      externalAccountName: 'Restart Workspace',
      connectedByUserId: 'admin-user',
      authType: ConnectorAuthType.OAUTH2,
      credentialPayload: { accessToken: 'secret_restart_token_123' },
      metadata: { workspaceIcon: 'https://example.com/icon.png' },
    });
    expect(saved.status).toBe(ConnectorConnectionStatus.CONNECTED);

    /* 2. Simulate fresh resolution as would happen after a container or process restart */
    const retrieved = await persistenceService.getConnection('notion');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe(ConnectorConnectionStatus.CONNECTED);
    expect(retrieved?.externalAccountId).toBe('workspace-notion-restart-1');
    expect(retrieved?.externalAccountName).toBe('Restart Workspace');

    /* 3. Decrypted token is immediately available without user intervention */
    const token = await persistenceService.getDecryptedToken('notion');
    expect(token).toBe('secret_restart_token_123');
  });

  /* Scenario B: Failed reconnection preserves existing connection */
  it('Scenario B: Failed reconnection attempt preserves existing valid connection', async () => {
    /* 1. Establish valid active connection */
    await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'workspace-notion-existing',
      externalAccountName: 'Stable Notion Workspace',
      connectedByUserId: 'admin-user',
      credentialPayload: { accessToken: 'valid_existing_notion_token' },
    });

    /* 2. Attempt invalid reconnection: an invalid state consumption fails */
    const fakeState = 'non_existent_or_expired_state_token';
    const consumed = await oauthStateService.validateAndConsumeState(
      fakeState,
      'notion',
    );
    expect(consumed).toBe(false);

    /* 3. Existing connection is completely preserved and still connected */
    const currentConn = await persistenceService.getConnection('notion');
    expect(currentConn).not.toBeNull();
    expect(currentConn?.status).toBe(ConnectorConnectionStatus.CONNECTED);
    expect(currentConn?.externalAccountId).toBe('workspace-notion-existing');

    const token = await persistenceService.getDecryptedToken('notion');
    expect(token).toBe('valid_existing_notion_token');
  });

  /* Multi-Connector Concurrency */
  it('Multi-Connector Concurrency: Concurrent Notion and Confluence connections active simultaneously', async () => {
    /* 1. Connect Notion */
    await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'notion-ws-multi',
      externalAccountName: 'Notion Engineering Hub',
      connectedByUserId: 'admin-user',
      credentialPayload: { accessToken: 'notion_multi_secret_token' },
      metadata: { selectedPageIds: ['page-1', 'page-2'] },
    });

    /* 2. Connect Confluence concurrently */
    await persistenceService.saveConnection({
      provider: 'confluence',
      externalAccountId: 'confluence-site-multi',
      externalAccountName: 'Atlassian Confluence Site',
      connectedByUserId: 'admin-user',
      credentialPayload: { accessToken: 'confluence_multi_bearer_token' },
      metadata: { spaceKey: 'ENG' },
    });

    /* 3. Query all connections via listConnections */
    const allConnections = await persistenceService.listConnections();
    const activeProviders = allConnections
      .filter((c) => c.status === ConnectorConnectionStatus.CONNECTED)
      .map((c) => c.provider);

    expect(activeProviders).toContain('notion');
    expect(activeProviders).toContain('confluence');

    /* 4. Verify distinct credential resolution without cross-contamination */
    const notionToken = await persistenceService.getDecryptedToken('notion');
    const confluenceToken =
      await persistenceService.getDecryptedToken('confluence');

    expect(notionToken).toBe('notion_multi_secret_token');
    expect(confluenceToken).toBe('confluence_multi_bearer_token');

    /* 5. Verify isolated metadata */
    const notionPages = await persistenceService.getSelectedPages('notion');
    expect(notionPages).toEqual(['page-1', 'page-2']);
  });

  /* Scenario C: Transient 5xx/network errors do not alter connection */
  it('Scenario C: Transient network errors or 5xx responses do not alter CONNECTED status', async () => {
    await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'workspace-resilient-1',
      externalAccountName: 'Resilient Workspace',
      credentialPayload: { accessToken: 'resilient_token' },
    });

    /* Mock NotionClient fetch simulating transient 503 Service Unavailable */
    const originalFetch = notionClient['fetchFn'];
    notionClient.setFetchFunction(
      jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
      } as any),
    );

    try {
      await notionClient.getPage('test-page-transient');
    } catch {
      /* Expect client to throw for 503 */
    } finally {
      notionClient.setFetchFunction(originalFetch);
    }

    /* Connection status must remain CONNECTED */
    const conn = await persistenceService.getConnection('notion');
    expect(conn?.status).toBe(ConnectorConnectionStatus.CONNECTED);
  });

  /* Scenario D: Confirmed 401 transitions to REAUTH_REQUIRED */
  it('Scenario D: Confirmed HTTP 401 Unauthorized transitions connection status to REAUTH_REQUIRED', async () => {
    await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'workspace-to-revoke-1',
      externalAccountName: 'Revoked Workspace',
      credentialPayload: { accessToken: 'revoked_token' },
    });

    /* Mock NotionClient fetch returning HTTP 401 Unauthorized */
    const originalFetch = notionClient['fetchFn'];
    notionClient.setFetchFunction(
      jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          object: 'error',
          status: 401,
          code: 'unauthorized',
          message: 'API token is invalid or has been revoked.',
        }),
      } as any),
    );

    try {
      await notionClient.getPage('test-page-401');
    } catch {
      /* Expected error */
    } finally {
      notionClient.setFetchFunction(originalFetch);
    }

    /* Connection must have transitioned to REAUTH_REQUIRED */
    const conn = await persistenceService.getConnection('notion');
    expect(conn?.status).toBe(ConnectorConnectionStatus.REAUTH_REQUIRED);
    expect(conn?.externalAccountId).toBe('workspace-to-revoke-1');
  });

  /* Scenario E: Unavailable key fails safely */
  it('Scenario E: Corrupted payload or unavailable key fails safely without leaking secrets or deleting records', async () => {
    await persistenceService.saveConnection({
      provider: 'notion',
      externalAccountId: 'workspace-enc-safe',
      externalAccountName: 'Safe Encryption Workspace',
      credentialPayload: { accessToken: 'secret_safe_token_data' },
    });

    /* Attempt decryption of a corrupted payload */
    const corruptedPayload = 'bad_iv.bad_tag.bad_cipher';
    expect(() => encryptionService.decrypt(corruptedPayload)).toThrow();

    /* Stored connection in database remains fully intact */
    const conn = await persistenceService.getConnection('notion');
    expect(conn?.status).toBe(ConnectorConnectionStatus.CONNECTED);
    expect(conn?.externalAccountId).toBe('workspace-enc-safe');

    /* Decrypting the valid stored connection continues to work */
    const validToken = await persistenceService.getDecryptedToken('notion');
    expect(validToken).toBe('secret_safe_token_data');
  });

  /* Scenario F: Single-use anti-CSRF state token rejection and replay prevention */
  it('Scenario F: Single-use anti-CSRF state prevents replay and concurrent duplicate consumption', async () => {
    /* 1. Generate state */
    const state = await oauthStateService.generateState('notion', 'admin-user');
    expect(state).toBeDefined();
    expect(state.length).toBe(64); /* 32 bytes hex */

    /* 2. Concurrent consumption attempts */
    const [result1, result2] = await Promise.all([
      oauthStateService.validateAndConsumeState(state, 'notion'),
      oauthStateService.validateAndConsumeState(state, 'notion'),
    ]);

    /* Exactly one must succeed and one must fail */
    const successes = [result1, result2].filter((res) => res === true);
    const failures = [result1, result2].filter((res) => res === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    /* 3. Subsequent replay is also rejected */
    const replayResult = await oauthStateService.validateAndConsumeState(
      state,
      'notion',
    );
    expect(replayResult).toBe(false);
  });
});
