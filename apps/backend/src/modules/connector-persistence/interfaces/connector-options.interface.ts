import { ModuleMetadata, Type } from '@nestjs/common';

/* Configuration options for ConnectorPersistenceModule */
export interface ConnectorPersistenceOptions {
  /* Encryption secret used to derive the 32-byte AES-256-GCM key */
  encryptionSecret: string;
  /* Optional key version identifier (default: 1) */
  defaultKeyVersion?: number;
  /* Optional OAuth state TTL in milliseconds (default: 10 minutes) */
  oauthStateTtlMs?: number;
}

/* Factory interface for asynchronous module configuration */
export interface ConnectorPersistenceOptionsFactory {
  createConnectorPersistenceOptions():
    | Promise<ConnectorPersistenceOptions>
    | ConnectorPersistenceOptions;
}

/* Asynchronous configuration options for ConnectorPersistenceModule */
export interface ConnectorPersistenceAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<ConnectorPersistenceOptionsFactory>;
  useClass?: Type<ConnectorPersistenceOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<ConnectorPersistenceOptions> | ConnectorPersistenceOptions;
  inject?: any[];
}
