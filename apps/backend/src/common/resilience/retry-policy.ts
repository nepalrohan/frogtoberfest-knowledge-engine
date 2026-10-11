import { ErrorClassifier } from './error-classifier';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleepFn?: (ms: number) => Promise<void>;
}

export class RetryPolicy {
  private readonly defaultOptions: Required<Omit<RetryOptions, 'onRetry'>> & {
    onRetry?: RetryOptions['onRetry'];
  };

  constructor(options?: RetryOptions) {
    this.defaultOptions = {
      maxAttempts: options?.maxAttempts ?? 3,
      initialDelayMs: options?.initialDelayMs ?? 200,
      maxDelayMs: options?.maxDelayMs ?? 5000,
      backoffFactor: options?.backoffFactor ?? 2,
      onRetry: options?.onRetry,
      sleepFn: options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    };
  }

  async execute<T>(
    operation: (attempt: number) => Promise<T>,
    customOptions?: RetryOptions,
  ): Promise<T> {
    const opts = { ...this.defaultOptions, ...customOptions };
    let lastError: unknown;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;

        if (attempt >= opts.maxAttempts) {
          break;
        }

        if (!ErrorClassifier.isRetryable(error)) {
          throw error;
        }

        const delay = this.calculateJitterDelay(
          attempt,
          opts.initialDelayMs,
          opts.maxDelayMs,
          opts.backoffFactor,
        );

        if (opts.onRetry) {
          opts.onRetry(error, attempt, delay);
        }

        await opts.sleepFn(delay);
      }
    }

    throw lastError;
  }

  calculateJitterDelay(
    attempt: number,
    initialDelayMs: number,
    maxDelayMs: number,
    backoffFactor: number,
  ): number {
    const exponential = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
    const ceiling = Math.min(maxDelayMs, exponential);
    // Full jitter: random value between 0 and ceiling
    return Math.floor(Math.random() * ceiling);
  }
}
