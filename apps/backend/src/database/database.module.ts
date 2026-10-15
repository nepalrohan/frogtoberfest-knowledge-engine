import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule, AppConfigService } from '../config';
import {
  Document,
  IngestionJob,
  EmbeddingOutbox,
  DocumentChunk,
} from '../entities';

/* DatabaseModule encapsulates TypeORM connection pooling and entity registration */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const db = config.database;
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
          synchronize: db.synchronize,
          entities: [Document, IngestionJob, EmbeddingOutbox, DocumentChunk],
          autoLoadEntities: true,
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
          },
        };
      },
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
