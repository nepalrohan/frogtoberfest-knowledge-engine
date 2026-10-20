/* Represents metadata of a saved file buffer */
export interface StoredFileMetadata {
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  path?: string;
  checksumSha256: string;
}

/* Pluggable file storage interface abstracting local disk or memory buffers */
export interface IFileStorage {
  saveBuffer(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<StoredFileMetadata>;
}

export const FILE_STORAGE_TOKEN = Symbol('IFileStorage');
