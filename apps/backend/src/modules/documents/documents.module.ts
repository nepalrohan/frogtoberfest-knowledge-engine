import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, EmbeddingOutbox } from '../../entities';
import { DocumentRepository, EmbeddingOutboxRepository } from './repositories';
import { DocumentVersioningService } from './services/document-versioning.service';

/* DocumentsModule owns canonical document persistence shared by direct ingestion, connector sync, and indexing */
@Module({
  imports: [TypeOrmModule.forFeature([Document, EmbeddingOutbox])],
  providers: [DocumentRepository, EmbeddingOutboxRepository, DocumentVersioningService],
  exports: [DocumentRepository, EmbeddingOutboxRepository, DocumentVersioningService],
})
export class DocumentsModule {}
