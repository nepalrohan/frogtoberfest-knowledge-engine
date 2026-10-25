import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ConnectorSyncItemEntity, ConnectorSyncItemStatus } from '../entities';

/* Data access for connector sync items; methods accept a manager to join a caller's transaction */
@Injectable()
export class ConnectorSyncItemRepository {
  constructor(
    @InjectRepository(ConnectorSyncItemEntity)
    private readonly repo: Repository<ConnectorSyncItemEntity>,
  ) {}

  private scoped(manager?: EntityManager): Repository<ConnectorSyncItemEntity> {
    return manager ? manager.getRepository(ConnectorSyncItemEntity) : this.repo;
  }

  findById(id: string, manager?: EntityManager): Promise<ConnectorSyncItemEntity | null> {
    return this.scoped(manager).findOne({ where: { id } });
  }

  /* Row lock serializing publication with concurrent deselection of the same item */
  lockById(id: string, manager: EntityManager): Promise<ConnectorSyncItemEntity | null> {
    return manager
      .getRepository(ConnectorSyncItemEntity)
      .createQueryBuilder('item')
      .setLock('pessimistic_write')
      .where('item.id = :id', { id })
      .getOne();
  }

  save(item: ConnectorSyncItemEntity, manager?: EntityManager): Promise<ConnectorSyncItemEntity> {
    return this.scoped(manager).save(item);
  }

  /* Records a successful no-op sync unless the item was deselected meanwhile */
  async markUnchanged(id: string, observedRevision: string | null | undefined): Promise<void> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item || item.status === ConnectorSyncItemStatus.DESELECTED) {
      return;
    }
    item.status = ConnectorSyncItemStatus.COMPLETED;
    item.lastSyncedAt = new Date();
    item.lastError = null;
    if (observedRevision) {
      item.lastObservedRevision = observedRevision;
    }
    await this.repo.save(item);
  }
}
