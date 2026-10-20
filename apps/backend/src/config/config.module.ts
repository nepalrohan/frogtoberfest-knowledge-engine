import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './configuration';

/* Global configuration module making AppConfigService accessible throughout the application */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
