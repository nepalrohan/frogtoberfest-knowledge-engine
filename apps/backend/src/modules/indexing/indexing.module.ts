import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document, EmbeddingOutbox, DocumentChunk } from '../../entities';
import { QueueModule } from '../queue/queue.module';
import { OutboxRelayService } from './outbox.relay';

/* IndexingModule encapsulates outbox polling, chunking, and embedding workflows */
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, EmbeddingOutbox, DocumentChunk]),
    QueueModule,
  ],
  providers: [OutboxRelayService],
  exports: [OutboxRelayService],
})
export class IndexingModule {}
