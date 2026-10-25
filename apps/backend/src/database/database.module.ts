import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule, AppConfigService } from '../config';
import {
  Document,
  IngestionJob,
  EmbeddingOutbox,
  DocumentChunk,
} from '../entities';
import { buildDataSourceOptions } from './data-source.options';
import { TransactionRunner } from './transaction-runner';

/* DatabaseModule encapsulates TypeORM connection pooling, entity registration, startup migrations, and the shared transaction runner */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        ...buildDataSourceOptions(config.database),
        autoLoadEntities: true,
      }),
    }),
    TypeOrmModule.forFeature([
      Document,
      IngestionJob,
      EmbeddingOutbox,
      DocumentChunk,
    ]),
  ],
  providers: [TransactionRunner],
  exports: [TypeOrmModule, TransactionRunner],
})
export class DatabaseModule {}
