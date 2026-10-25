import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { configuration, AppConfigService } from './config/configuration';
import { AppConfigModule } from './config/app-config.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ConnectorPersistenceModule } from './modules/connector-persistence/connector-persistence.module';
import { IngestionModule } from './modules/ingestion';
import {
  ConnectorConnectionEntity,
  ConnectorCredentialEntity,
  OAuthStateEntity,
  ConnectorSyncItemEntity,
  ConnectorSyncOutboxEntity,
} from './modules/connector-persistence/entities';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    AppConfigModule,
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
          url: db.url,
          entities: [
            ConnectorConnectionEntity,
            ConnectorCredentialEntity,
            OAuthStateEntity,
            ConnectorSyncItemEntity,
            ConnectorSyncOutboxEntity,
          ],
          synchronize: config.nodeEnv === 'development' || config.nodeEnv === 'test',
          autoLoadEntities: true,
        };
      },
    }),
    ConnectorPersistenceModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        encryptionSecret: config.encryptionSecret,
      }),
    }),
    IntegrationsModule,
    IngestionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}



