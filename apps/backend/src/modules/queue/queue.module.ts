import { Inject, Module, OnModuleDestroy, Provider } from '@nestjs/common';
import { DefaultJobOptions, Queue } from 'bullmq';
import { AppConfigModule, AppConfigService } from '../../config';
import {
  EMBEDDING_QUEUE_NAME,
  EMBEDDING_QUEUE_TOKEN,
  EmbeddingJobPayload,
  INGESTION_SYNC_DLQ_NAME,
  INGESTION_SYNC_DLQ_TOKEN,
  INGESTION_SYNC_QUEUE_NAME,
  INGESTION_SYNC_QUEUE_TOKEN,
  SyncDeadLetterPayload,
  SyncResourceJobPayload,
} from './queue.constants';

const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 4,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: true,
  removeOnFail: false,
};

/* Builds a BullMQ queue on the shared Redis connection */
export function createQueue<T>(
  name: string,
  config: AppConfigService,
  defaultJobOptions: DefaultJobOptions = DEFAULT_JOB_OPTIONS,
): Queue<T> {
  const redis = config.redis;
  return new Queue<T>(name, {
    connection: {
      host: redis.host,
      port: redis.port,
      password: redis.password,
      maxRetriesPerRequest: null,
    },
    defaultJobOptions,
  });
}

const queueProviders: Provider[] = [
  {
    provide: EMBEDDING_QUEUE_TOKEN,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) =>
      createQueue<EmbeddingJobPayload>(EMBEDDING_QUEUE_NAME, config),
  },
  {
    provide: INGESTION_SYNC_QUEUE_TOKEN,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) =>
      createQueue<SyncResourceJobPayload>(INGESTION_SYNC_QUEUE_NAME, config),
  },
  {
    provide: INGESTION_SYNC_DLQ_TOKEN,
    inject: [AppConfigService],
    /* Dead letters are retained for inspection only; nothing consumes this queue */
    useFactory: (config: AppConfigService) =>
      createQueue<SyncDeadLetterPayload>(INGESTION_SYNC_DLQ_NAME, config, {
        removeOnComplete: false,
        removeOnFail: {
          age: config.sync.dlqRetentionDays * 24 * 60 * 60,
        },
      }),
  },
];

/* QueueModule configures and exposes BullMQ queue instances backed by Redis */
@Module({
  imports: [AppConfigModule],
  providers: queueProviders,
  exports: [EMBEDDING_QUEUE_TOKEN, INGESTION_SYNC_QUEUE_TOKEN, INGESTION_SYNC_DLQ_TOKEN],
})
export class QueueModule implements OnModuleDestroy {
  constructor(
    @Inject(EMBEDDING_QUEUE_TOKEN) private readonly embeddingQueue: Queue,
    @Inject(INGESTION_SYNC_QUEUE_TOKEN) private readonly syncQueue: Queue,
    @Inject(INGESTION_SYNC_DLQ_TOKEN) private readonly syncDlq: Queue,
  ) {}

  /* Gracefully closes BullMQ queue connections on shutdown */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.embeddingQueue.close(), this.syncQueue.close(), this.syncDlq.close()]);
  }
}
