import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EmbeddingOutbox } from '../../../entities';
import type { EmbeddingJobPayload } from '../../queue/queue.constants';

/* Writes embedding outbox events; the existing indexing OutboxRelayService drains them */
@Injectable()
export class EmbeddingOutboxRepository {
  /* Records a pending embedding event inside the caller's document transaction */
  async enqueue(payload: EmbeddingJobPayload, manager: EntityManager): Promise<void> {
    const outboxRepo = manager.getRepository(EmbeddingOutbox);
    const record = outboxRepo.create({
      documentId: payload.documentId,
      documentVersion: payload.documentVersion,
      eventType: 'DOCUMENT_READY_FOR_EMBEDDING',
      payload: { ...payload },
      status: 'pending',
    });
    await outboxRepo.save(record);
  }
}
