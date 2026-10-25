import type { DataSourceOptions } from 'typeorm';
import type { AppConfiguration } from '../config/configuration';
import {
  Document,
  IngestionJob,
  EmbeddingOutbox,
  DocumentChunk,
  Conversation,
  ConversationMessage,
} from '../entities';
import {
  ConnectorConnectionEntity,
  ConnectorCredentialEntity,
  OAuthStateEntity,
  ConnectorSyncItemEntity,
  ConnectorSyncOutboxEntity,
} from '../modules/connector-persistence/entities';
import { MIGRATIONS } from './migrations';

/* Single source of connection options for the Nest app and the TypeORM migration CLI */
export function buildDataSourceOptions(
  db: AppConfiguration['database'],
): DataSourceOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
    ssl: db.ssl ? { rejectUnauthorized: false } : false,
    /* Migrations own the schema; synchronize stays opt-in for throwaway local databases */
    synchronize: db.synchronize,
    migrations: MIGRATIONS,
    migrationsRun: true,
    entities: [
      Document,
      IngestionJob,
      EmbeddingOutbox,
      DocumentChunk,
      Conversation,
      ConversationMessage,
      ConnectorConnectionEntity,
      ConnectorCredentialEntity,
      OAuthStateEntity,
      ConnectorSyncItemEntity,
      ConnectorSyncOutboxEntity,
    ],
    extra: {
      max: 20,
      idleTimeoutMillis: 30000,
    },
  };
}
