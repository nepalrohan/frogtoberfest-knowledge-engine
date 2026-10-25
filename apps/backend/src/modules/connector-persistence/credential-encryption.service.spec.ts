import { Test, TestingModule } from '@nestjs/testing';
import {
  CredentialEncryptionService,
  CONNECTOR_PERSISTENCE_OPTIONS,
} from './credential-encryption.service';
import { InternalServerErrorException } from '@nestjs/common';

describe('CredentialEncryptionService', () => {
  let service: CredentialEncryptionService;
  const testSecret = 'super-secret-key-32-chars-at-least!';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialEncryptionService,
        {
          provide: CONNECTOR_PERSISTENCE_OPTIONS,
          useValue: {
            encryptionSecret: testSecret,
            defaultKeyVersion: 1,
          },
        },
      ],
    }).compile();

    service = module.get<CredentialEncryptionService>(
      CredentialEncryptionService,
    );
  });

  describe('Encryption & Decryption Round-trip', () => {
    it('should encrypt and decrypt a plaintext string accurately', () => {
      const plain = 'secret_test_notion_token_xyz_123';
      const { payload, keyVersion } = service.encrypt(plain);

      expect(payload).toBeDefined();
      expect(payload).not.toEqual(plain);
      expect(payload.split('.')).toHaveLength(3);
      expect(keyVersion).toEqual(1);

      const decrypted = service.decrypt(payload);
      expect(decrypted).toEqual(plain);
    });

    it('should encrypt and decrypt a structured JSON payload accurately', () => {
      const payloadObj = {
        accessToken: 'access-token-123',
        botId: 'bot-456',
        tokenType: 'bearer',
      };

      const { payload, keyVersion } = service.encryptPayload(payloadObj);
      expect(keyVersion).toEqual(1);

      const decrypted = service.decryptPayload<typeof payloadObj>(payload);
      expect(decrypted).toEqual(payloadObj);
    });

    it('should support colon-delimited format for backward compatibility', () => {
      const plain = 'secret_colon_delimited_token';
      const { payload } = service.encrypt(plain);
      const colonDelimited = payload.replace(/\./g, ':');

      const decrypted = service.decrypt(colonDelimited);
      expect(decrypted).toEqual(plain);
    });
  });

  describe('Security & Failure Handling (Safe Failures)', () => {
    it('should throw an InternalServerErrorException without leaking secrets on tampered ciphertext', () => {
      const plain = 'sensitive_notion_secret';
      const { payload } = service.encrypt(plain);
      const parts = payload.split('.');
      const tampered = `${parts[0]}.${parts[1]}.deadbeef9999`;

      expect(() => service.decrypt(tampered)).toThrow(
        InternalServerErrorException,
      );

      try {
        service.decrypt(tampered);
      } catch (err: any) {
        expect(err.message).not.toContain(plain);
        expect(err.message).not.toContain(testSecret);
      }
    });

    it('should throw an error for malformed payload format', () => {
      expect(() => service.decrypt('invalid-format')).toThrow(
        'Invalid encrypted payload format',
      );
    });

    it('should throw when empty string is provided', () => {
      expect(() => service.encrypt('')).toThrow('Plaintext cannot be empty');
      expect(() => service.decrypt('')).toThrow(
        'Encrypted payload cannot be empty',
      );
    });

    it('should fail safely if encryption secret is missing or empty', async () => {
      const emptyModule: TestingModule = await Test.createTestingModule({
        providers: [
          CredentialEncryptionService,
          {
            provide: CONNECTOR_PERSISTENCE_OPTIONS,
            useValue: {
              encryptionSecret: '',
            },
          },
        ],
      }).compile();

      const emptyService = emptyModule.get<CredentialEncryptionService>(
        CredentialEncryptionService,
      );
      expect(() => emptyService.encrypt('any_token')).toThrow(
        InternalServerErrorException,
      );
    });
  });
});
