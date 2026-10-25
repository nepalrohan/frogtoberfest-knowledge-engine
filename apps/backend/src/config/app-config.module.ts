import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './configuration';

/* Global configuration module providing AppConfigService across all feature modules */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
