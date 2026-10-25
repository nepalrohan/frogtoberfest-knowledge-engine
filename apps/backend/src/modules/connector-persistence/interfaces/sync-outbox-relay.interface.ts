/* Outbox message envelope structure */
export interface OutboxSyncMessage<T = Record<string, any>> {
  id: string;
  connectionId: string;
  externalResourceId: string;
  eventType: string;
  payload: T;
  createdAt: Date;
}

/* Poller relay contract for draining outbox tables into distributed message queues */
export interface ISyncOutboxRelay {
  pollAndPublish(batchSize?: number): Promise<number>;
}

/* Interface for target queue publisher to allow decoupling from specific queue implementations */
export interface ISyncQueuePublisher {
  publishSyncJob(params: {
    jobId: string;
    payload: Record<string, any>;
    attempts?: number;
  }): Promise<void>;
}
