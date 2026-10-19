import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule, AppConfigService } from '../config';
import {
  Document,
  IngestionJob,
  EmbeddingOutbox,
  DocumentChunk,
} from '../entities';
import { buildDataSourceOptions } from './data-source.options';

/* DatabaseModule encapsulates TypeORM connection pooling, entity registration, and startup migrations */
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
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
