import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule, configuration } from './config';

import { DatabaseModule } from './database/database.module';
import { StorageModule } from './modules/storage/storage.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { QueueModule } from './modules/queue/queue.module';
import { IndexingModule } from './modules/indexing/indexing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    AppConfigModule,
    DatabaseModule,
    StorageModule,
    IngestionModule,
    QueueModule,
    IndexingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppConfigModule],
})
export class AppModule {}
