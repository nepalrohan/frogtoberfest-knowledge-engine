import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { configuration, AppConfigService } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
  ],
  controllers: [AppController],
  providers: [AppService, AppConfigService],
  exports: [AppConfigService],
})
export class AppModule {}
