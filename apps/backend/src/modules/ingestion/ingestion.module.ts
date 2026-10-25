import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, IngestionJob, EmbeddingOutbox } from '../../entities';
import { StorageModule } from '../storage/storage.module';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { MarkdownNormalizer } from './normalizer/markdown-normalizer';

/* IngestionModule encapsulates document intake, normalization, and outbox emission */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, IngestionJob, EmbeddingOutbox]),
    StorageModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, MarkdownNormalizer],
  exports: [IngestionService, MarkdownNormalizer],
})
export class IngestionModule {}
