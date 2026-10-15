import { Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigModule, AppConfigService } from '../../config';
import {
  EMBEDDING_QUEUE_NAME,
  EMBEDDING_QUEUE_TOKEN,
  EmbeddingJobPayload,
} from './queue.constants';

/* QueueModule configures and exposes BullMQ queue instances backed by Redis */
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: EMBEDDING_QUEUE_TOKEN,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Queue<EmbeddingJobPayload> => {
        const redis = config.redis;
        return new Queue<EmbeddingJobPayload>(EMBEDDING_QUEUE_NAME, {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            maxRetriesPerRequest: null,
          },
          defaultJobOptions: {
            attempts: 4,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        });
      },
    },
  ],
  exports: [EMBEDDING_QUEUE_TOKEN],
})
export class QueueModule implements OnModuleDestroy {
  constructor() {}

  async onModuleDestroy() {
    /* Gracefully closes BullMQ queue connections on shutdown */
  }
}
