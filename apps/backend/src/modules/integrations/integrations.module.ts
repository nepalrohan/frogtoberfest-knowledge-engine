import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { NotionOAuthService } from './notion-oauth.service';
import { NotionPagesService } from './notion-pages.service';
import { ConnectionStorageService } from './connection-storage.service';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';

/* Module encapsulating third-party source OAuth integrations and secure credential persistence */
@Module({
  controllers: [IntegrationsController],
  providers: [
    NotionOAuthService,
    NotionPagesService,
    ConnectionStorageService,
    AdminAuthGuard,
  ],
  exports: [
    NotionOAuthService,
    NotionPagesService,
    ConnectionStorageService,
    AdminAuthGuard,
  ],
})
export class IntegrationsModule {}
