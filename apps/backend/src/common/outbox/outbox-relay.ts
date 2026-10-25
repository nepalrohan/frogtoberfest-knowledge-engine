import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { JobsOptions } from 'bullmq';
import pLimit from 'p-limit';
import type { AppConfiguration } from '../../config/configuration';
import { StructuredLogger } from '../logger/structured-logger';
import { LogEvents } from '../logger/log-events';
import { ErrorClassifier } from '../resilience/error-classifier';
import { toError } from '../resilience/error-utils';
import type { IOutboxStore, OutboxOutcome, OutboxRecord } from './outbox.types';

/* Queue job derived from one outbox record */
export interface OutboxJob<TJob> {
  name: string;
  jobId: string;
  data: TJob;
}

export type OutboxRelayOptions = AppConfiguration['outbox'];

/* Minimal queue port the relay publishes through; a concrete BullMQ Queue satisfies it structurally */
export interface OutboxJobQueue<TJob> {
  add(name: string, data: TJob, opts?: JobsOptions): Promise<unknown>;
}

/* Template-method relay draining one outbox table into one BullMQ queue; subclasses only map records to jobs */
export abstract class OutboxRelay<TPayload, TJob> implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: StructuredLogger;
  private timer?: NodeJS.Timeout;
  private isPolling = false;

  protected constructor(
    private readonly store: IOutboxStore<TPayload>,
    private readonly queue: OutboxJobQueue<TJob>,
    private readonly options: OutboxRelayOptions,
    private readonly jobOptions: JobsOptions,
  ) {
    this.logger = new StructuredLogger(new.target.name);
  }

  protected abstract toJob(record: OutboxRecord<TPayload>): OutboxJob<TJob>;

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.handlePollingTick();
    }, this.options.pollIntervalMs);
    this.logger.log('Outbox relay background poller initialized');
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /* Skips the tick when the previous cycle is still running so one process never drains twice concurrently */
  async handlePollingTick(): Promise<number> {
    if (this.isPolling) {
      return 0;
    }
    this.isPolling = true;
    try {
      return await this.drainOnce();
    } catch (error: unknown) {
      this.logger.logError(LogEvents.OUTBOX_PUBLISH_FAILED, error, {
        errorType: ErrorClassifier.classify(error),
        message: 'Unexpected error during outbox poller tick',
      });
      return 0;
    } finally {
      this.isPolling = false;
    }
  }

  /* Claims a batch, publishes it with bounded concurrency outside any transaction, then records all outcomes at once */
  async drainOnce(batchSize = this.options.batchSize): Promise<number> {
    const records = await this.store.claimBatch(batchSize, this.options.claimLeaseMs);
    if (records.length === 0) {
      return 0;
    }

    const limit = pLimit(this.options.concurrency);
    const outcomes = await Promise.all(records.map((record) => limit(() => this.publish(record))));

    await this.store.recordOutcomes(outcomes);
    return records.length;
  }

  /* Publishes one record; never throws so a single failure cannot abort the batch */
  private async publish(record: OutboxRecord<TPayload>): Promise<OutboxOutcome> {
    let jobId: string | undefined;
    try {
      const job = this.toJob(record);
      jobId = job.jobId;
      await this.queue.add(job.name, job.data, {
        ...this.jobOptions,
        jobId: job.jobId,
      });
      return {
        id: record.id,
        status: 'published',
        attemptCount: record.attemptCount,
        nextAttemptAt: null,
        lastError: null,
        publishedAt: new Date(),
      };
    } catch (error: unknown) {
      return this.failureOutcome(record, error, jobId);
    }
  }

  /* Transient failures back off exponentially; permanent failures or exhausted attempts are dead-lettered */
  private failureOutcome(record: OutboxRecord<TPayload>, error: unknown, jobId?: string): OutboxOutcome {
    const category = ErrorClassifier.classify(error);
    const attemptCount = record.attemptCount + 1;
    const lastError = toError(error).message;
    const deadLetter = category === 'PERMANENT' || attemptCount >= this.options.maxAttempts;

    if (deadLetter) {
      this.logger.logError(LogEvents.OUTBOX_DEAD_LETTERED, error, {
        eventId: record.id,
        jobId,
        errorType: category,
        attempt: attemptCount,
      });
      return {
        id: record.id,
        status: 'dead_lettered',
        attemptCount,
        nextAttemptAt: null,
        lastError,
        publishedAt: null,
      };
    }

    const delayMs = Math.min(
      this.options.baseBackoffMs * 2 ** (attemptCount - 1),
      this.options.maxBackoffMs,
    );
    this.logger.warnEvent(LogEvents.OUTBOX_PUBLISH_FAILED, {
      eventId: record.id,
      jobId,
      errorType: category,
      attempt: attemptCount,
      message: lastError,
    });
    return {
      id: record.id,
      status: 'pending',
      attemptCount,
      nextAttemptAt: new Date(Date.now() + delayMs),
      lastError,
      publishedAt: null,
    };
  }
}
