import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/* Runs a unit of work in one ACID transaction so services orchestrate repositories without touching DataSource */
@Injectable()
export class TransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
