import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorSyncItemEntity } from '../connector-persistence/entities';
import { ConnectorPersistenceModule } from '../connector-persistence';
import { NotionClient } from './connectors/notion/notion.client';
import { NotionAdapter } from './connectors/notion/notion.adapter';
import { NotionParser } from './normalizers/notion/notion.parser';
import { CanonicalDocumentNormalizer } from './normalizers/canonical/canonical-document.normalizer';
import { NotionConnector } from './connectors/notion/notion.connector';
import { NotionSyncProcessor } from './connectors/notion/notion-sync.processor';
import {
  DocumentStoragePlaceholderService,
  DOCUMENT_STORAGE_SERVICE,
} from './services/document-storage-placeholder.service';
import { SyncResourceWorker } from './workers/sync-resource.worker';

/* Modular feature module providing connectors, AST normalization, change detection, and background sync worker */
@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectorSyncItemEntity]),
    ConnectorPersistenceModule,
  ],
  providers: [
    NotionClient,
    NotionAdapter,
    NotionParser,
    CanonicalDocumentNormalizer,
    NotionConnector,
    NotionSyncProcessor,
    DocumentStoragePlaceholderService,
    {
      provide: DOCUMENT_STORAGE_SERVICE,
      useClass: DocumentStoragePlaceholderService,
    },
    SyncResourceWorker,
  ],
  exports: [
    NotionClient,
    NotionAdapter,
    NotionParser,
    CanonicalDocumentNormalizer,
    NotionConnector,
    NotionSyncProcessor,
    DocumentStoragePlaceholderService,
    SyncResourceWorker,
  ],
})
export class IngestionModule {}
