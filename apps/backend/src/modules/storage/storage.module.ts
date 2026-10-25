import { Module } from '@nestjs/common';
import { FILE_STORAGE_TOKEN } from './storage.interface';
import { LocalFileStorageService } from './local-file-storage.service';

/* StorageModule configures and exports pluggable file storage providers */
@Module({
  providers: [
    {
      provide: FILE_STORAGE_TOKEN,
      useClass: LocalFileStorageService,
    },
    LocalFileStorageService,
  ],
  exports: [FILE_STORAGE_TOKEN, LocalFileStorageService],
})
export class StorageModule {}
