import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, IngestionJob, EmbeddingOutbox } from '../../entities';
import { ConnectorSyncItemEntity } from '../connector-persistence/entities';
import { StorageModule } from '../storage/storage.module';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { MarkdownNormalizer } from './normalizer/markdown-normalizer';
import { NotionClient } from './connectors/notion/notion.client';
import { NotionAdapter } from './connectors/notion/notion.adapter';
import { NotionParser } from './normalizers/notion/notion.parser';
import { CanonicalDocumentNormalizer } from './normalizers/canonical/canonical-document.normalizer';
import { NotionConnector } from './connectors/notion/notion.connector';
import { NotionSyncProcessor } from './connectors/notion/notion-sync.processor';
import {
  DocumentStorageService,
  DOCUMENT_STORAGE_SERVICE,
} from './services/document-storage.service';
import { DocumentsModule } from '../documents/documents.module';
import { SyncResourceWorker, KNOWLEDGE_SYNC_PROCESSORS } from './workers/sync-resource.worker';
import { QueueModule } from '../queue/queue.module';

/* IngestionModule encapsulates document intake, connector normalization, change detection, and the background sync worker */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      IngestionJob,
      EmbeddingOutbox,
      ConnectorSyncItemEntity,
    ]),
    /* ConnectorPersistenceModule is global and configured once in AppModule; importing the bare class here would
       create a second instance with the fallback encryption secret, so stored credentials could not be decrypted */
    StorageModule,
    DocumentsModule,
    QueueModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    MarkdownNormalizer,
    NotionClient,
    NotionAdapter,
    NotionParser,
    CanonicalDocumentNormalizer,
    NotionConnector,
    NotionSyncProcessor,
    {
      provide: DOCUMENT_STORAGE_SERVICE,
      useClass: DocumentStorageService,
    },
    /* Add further connector processors here; the worker dispatches by each processor's provider name */
    {
      provide: KNOWLEDGE_SYNC_PROCESSORS,
      inject: [NotionSyncProcessor],
      useFactory: (notion: NotionSyncProcessor) => [notion],
    },
    SyncResourceWorker,
  ],
  exports: [
    IngestionService,
    MarkdownNormalizer,
    NotionClient,
    NotionAdapter,
    NotionParser,
    CanonicalDocumentNormalizer,
    NotionConnector,
    NotionSyncProcessor,
    DOCUMENT_STORAGE_SERVICE,
    SyncResourceWorker,
  ],
})
export class IngestionModule {}
