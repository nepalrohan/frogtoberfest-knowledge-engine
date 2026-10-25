import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { IFileStorage, StoredFileMetadata } from './storage.interface';

/* Local in-memory / disk storage adapter implementing IFileStorage */
@Injectable()
export class LocalFileStorageService implements IFileStorage {
  /* Computes cryptographic checksum and returns file metadata */
  async saveBuffer(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<StoredFileMetadata> {
    const checksumSha256 = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');

    const sanitizedFilename = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    return {
      filename: sanitizedFilename,
      originalName,
      mimeType,
      sizeBytes: buffer.length,
      checksumSha256,
    };
  }
}
