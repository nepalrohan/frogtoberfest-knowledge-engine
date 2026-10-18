import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionStorageService } from './connection-storage.service';
import { AppConfigService } from '../../config/configuration';

describe('ConnectionStorageService', () => {
  let service: ConnectionStorageService;
  let mockConfigService: Partial<AppConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      encryptionSecret: 'test-secret-key-32-chars-exactly!!',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionStorageService,
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ConnectionStorageService>(ConnectionStorageService);
    await service.clearAll();
  });

  describe('AES-256-GCM Token Encryption', () => {
    it('should encrypt and decrypt a plaintext token accurately', () => {
      const plainToken = 'secret_test_notion_token_1234567890';
      const encrypted = service.encryptToken(plainToken);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toEqual(plainToken);
      expect(encrypted.split('.')).toHaveLength(3);

      const decrypted = service.decryptToken(encrypted);
      expect(decrypted).toEqual(plainToken);
    });

    it('should support colon-delimited encrypted format', () => {
      const plainToken = 'secret_another_token_abc';
      const encrypted = service.encryptToken(plainToken);
      const colonDelimited = encrypted.replace(/\./g, ':');

      const decrypted = service.decryptToken(colonDelimited);
      expect(decrypted).toEqual(plainToken);
    });

    it('should throw an error when decrypting tampered ciphertext', () => {
      const plainToken = 'secret_sample_token';
      const encrypted = service.encryptToken(plainToken);
      const parts = encrypted.split('.');
      /* Corrupt ciphertext */
      const tampered = `${parts[0]}.${parts[1]}.deadbeef1234`;

      expect(() => service.decryptToken(tampered)).toThrow();
    });

    it('should throw an error when credential reference is malformed', () => {
      expect(() => service.decryptToken('malformed-string')).toThrow();
      expect(() => service.decryptToken('')).toThrow();
    });
  });

  describe('Connection Persistence Lifecycle', () => {
    it('should save a new connection and retrieve connection without plaintext credentials', async () => {
      const saved = await service.saveConnection({
        workspaceId: 'ws-123',
        workspaceName: 'Acme Corp',
        workspaceIcon: 'https://example.com/icon.png',
        accessToken: 'secret_token_acme',
        connectedBy: 'user-001',
      });

      expect(saved.id).toBeDefined();
      expect(saved.provider).toBe('notion');
      expect(saved.workspace_id).toBe('ws-123');
      expect(saved.workspace_name).toBe('Acme Corp');
      expect(saved.workspace_icon).toBe('https://example.com/icon.png');
      expect(saved.connected_by).toBe('user-001');
      expect(saved.status).toBe('connected');
      expect(saved.credential_ref).not.toContain('secret_token_acme');

      const retrieved = await service.getConnection('notion');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.workspace_name).toBe('Acme Corp');

      const decryptedToken = await service.getDecryptedToken('notion');
      expect(decryptedToken).toBe('secret_token_acme');
    });

    it('should atomically update existing connection on reconnect', async () => {
      const first = await service.saveConnection({
        workspaceId: 'ws-123',
        workspaceName: 'Acme Corp',
        workspaceIcon: null,
        accessToken: 'secret_token_v1',
        connectedBy: 'user-001',
      });

      const second = await service.saveConnection({
        workspaceId: 'ws-123',
        workspaceName: 'Acme Corp Updated',
        workspaceIcon: 'https://example.com/new.png',
        accessToken: 'secret_token_v2',
        connectedBy: 'user-002',
      });

      expect(second.id).toBe(first.id);
      expect(second.workspace_name).toBe('Acme Corp Updated');
      expect(second.workspace_icon).toBe('https://example.com/new.png');
      expect(second.connected_by).toBe('user-002');

      const decryptedToken = await service.getDecryptedToken('notion');
      expect(decryptedToken).toBe('secret_token_v2');
    });

    it('should disconnect active connection and clear stored token', async () => {
      await service.saveConnection({
        workspaceId: 'ws-123',
        workspaceName: 'Acme Corp',
        workspaceIcon: null,
        accessToken: 'secret_token_xyz',
        connectedBy: 'user-001',
      });

      await service.disconnect('notion');

      const conn = await service.getConnection('notion');
      expect(conn?.status).toBe('disconnected');
      expect(conn?.credential_ref).toBe('');

      const token = await service.getDecryptedToken('notion');
      expect(token).toBeNull();
    });
  });
});
