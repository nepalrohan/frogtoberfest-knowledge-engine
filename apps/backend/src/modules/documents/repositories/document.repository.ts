import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';
import { Document } from '../../../entities';

/* Data access for canonical documents; methods accept a manager to join a caller's transaction */
@Injectable()
export class DocumentRepository {
  constructor(
    @InjectRepository(Document)
    private readonly repo: Repository<Document>,
  ) {}

  private scoped(manager?: EntityManager): Repository<Document> {
    return manager ? manager.getRepository(Document) : this.repo;
  }

  /* Locks the source's document row so version increments are serialized */
  findBySourceForUpdate(
    sourceType: string,
    sourceId: string,
    manager: EntityManager,
  ): Promise<Document | null> {
    return manager
      .getRepository(Document)
      .createQueryBuilder('doc')
      .setLock('pessimistic_write')
      .where('doc.sourceType = :sourceType AND doc.sourceId = :sourceId', { sourceType, sourceId })
      .getOne();
  }

  create(data: DeepPartial<Document>, manager?: EntityManager): Document {
    return this.scoped(manager).create(data);
  }

  save(document: Document, manager?: EntityManager): Promise<Document> {
    return this.scoped(manager).save(document);
  }
}
