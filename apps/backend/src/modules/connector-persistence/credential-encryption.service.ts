import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { ConnectorPersistenceOptions } from './interfaces/connector-options.interface';

export const CONNECTOR_PERSISTENCE_OPTIONS = 'CONNECTOR_PERSISTENCE_OPTIONS';

/* Self-contained service providing authenticated AES-256-GCM encryption with key versioning */
@Injectable()
export class CredentialEncryptionService {
  private readonly logger = new Logger(CredentialEncryptionService.name);
  private readonly defaultKeyVersion: number;
  private readonly encryptionSecret: string;

  constructor(
    @Optional()
    @Inject(CONNECTOR_PERSISTENCE_OPTIONS)
    options?: ConnectorPersistenceOptions,
  ) {
    this.encryptionSecret =
      options?.encryptionSecret !== undefined
        ? options.encryptionSecret
        : 'default-fallback-encryption-secret-32b';
    this.defaultKeyVersion = options?.defaultKeyVersion ?? 1;
  }

  /* Derives a consistent 32-byte key from the configured secret */
  private getDerivedKey(): Buffer {
    if (!this.encryptionSecret || this.encryptionSecret.trim().length === 0) {
      throw new InternalServerErrorException(
        'Credential encryption key is not configured',
      );
    }
    return crypto.createHash('sha256').update(this.encryptionSecret).digest();
  }

  /* Encrypts plaintext string using AES-256-GCM */
  encrypt(
    plainText: string,
    keyVersion?: number,
  ): { payload: string; keyVersion: number } {
    if (!plainText) {
      throw new Error('Plaintext cannot be empty');
    }

    const version = keyVersion ?? this.defaultKeyVersion;
    const iv = crypto.randomBytes(12);
    const key = this.getDerivedKey();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const payload = `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted.toString('hex')}`;
    return { payload, keyVersion: version };
  }

  /* Decrypts an AES-256-GCM payload into the plaintext string */
  decrypt(encryptedPayload: string, _keyVersion?: number): string {
    if (!encryptedPayload) {
      throw new Error('Encrypted payload cannot be empty');
    }

    const parts = encryptedPayload.includes('.')
      ? encryptedPayload.split('.')
      : encryptedPayload.split(':');

    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error('Invalid encrypted payload format');
    }

    try {
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const cipherText = Buffer.from(parts[2], 'hex');
      const key = this.getDerivedKey();

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(cipherText),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error('Failed to decrypt credential payload (safe failure)');
      throw new InternalServerErrorException(
        'Failed to decrypt credential payload',
      );
    }
  }

  /* Encrypts an arbitrary object as JSON using AES-256-GCM */
  encryptPayload<T>(
    data: T,
    keyVersion?: number,
  ): { payload: string; keyVersion: number } {
    const jsonStr = JSON.stringify(data);
    return this.encrypt(jsonStr, keyVersion);
  }

  /* Decrypts an AES-256-GCM payload and parses as JSON */
  decryptPayload<T>(encryptedPayload: string, keyVersion?: number): T {
    const jsonStr = this.decrypt(encryptedPayload, keyVersion);
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      throw new InternalServerErrorException(
        'Failed to parse decrypted credential payload as JSON',
      );
    }
  }
}
