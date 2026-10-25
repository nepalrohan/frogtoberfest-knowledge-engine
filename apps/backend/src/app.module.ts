import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule, AppConfigService, configuration } from './config';

import { DatabaseModule } from './database/database.module';
import { StorageModule } from './modules/storage/storage.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { QueueModule } from './modules/queue/queue.module';
import { IndexingModule } from './modules/indexing/indexing.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ConnectorPersistenceModule } from './modules/connector-persistence/connector-persistence.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      /* `.env.<NODE_ENV>` takes precedence; `.env` is the shared local fallback */
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    AppConfigModule,
    DatabaseModule,
    ConnectorPersistenceModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        encryptionSecret: config.encryptionSecret,
      }),
    }),
    StorageModule,
    IngestionModule,
    QueueModule,
    IndexingModule,
    ConversationModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppConfigModule],
})
export class AppModule {}
