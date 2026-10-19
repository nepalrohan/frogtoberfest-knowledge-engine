import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, EmbeddingOutbox, DocumentChunk } from '../../entities';
import { AppConfigModule } from '../../config';
import { QueueModule } from '../queue/queue.module';
import { OutboxRelayService } from './outbox.relay';
import { VectorStoreService } from './retrieval/vector-store.service';
import { MarkdownChunker } from './chunker/markdown-chunker';
import { EmbeddingProviderFactory } from './embedding/embedding-provider.factory';
import { EMBEDDING_PROVIDER_TOKEN } from './embedding/embedding.interface';
import { EmbeddingWorker } from './workers/embedding.worker';

/* IndexingModule encapsulates outbox polling, chunking, and embedding workflows */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, EmbeddingOutbox, DocumentChunk]),
    AppConfigModule,
    QueueModule,
  ],
  providers: [
    OutboxRelayService,
    MarkdownChunker,
    EmbeddingProviderFactory,
    EmbeddingWorker,
    VectorStoreService,
  ],
  exports: [
    OutboxRelayService,
    MarkdownChunker,
    EMBEDDING_PROVIDER_TOKEN,
    EmbeddingWorker,
    VectorStoreService,
  ],
})
export class IndexingModule {}
