import { Logger } from '@nestjs/common';
import { ErrorClassifier } from './error-classifier';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /* Number of consecutive failures before tripping circuit to OPEN */
  failureThreshold?: number;
  /* Duration in milliseconds to stay OPEN before attempting HALF_OPEN reset probe */
  resetTimeoutMs?: number;
  /* Maximum number of test probes in HALF_OPEN state */
  halfOpenMaxProbes?: number;
  /* Optional name identifier for logging */
  name?: string;
}

export class CircuitBreaker {
  private readonly logger: Logger;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private halfOpenProbes = 0;

  constructor(options?: CircuitBreakerOptions) {
    this.name = options?.name || 'CircuitBreaker';
    this.logger = new Logger(this.name);
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30000;
  }

  /**
   * Returns current state of circuit breaker (CLOSED, OPEN, or HALF_OPEN).
   */
  getState(): CircuitBreakerState {
    this.evaluateStateTransition();
    return this.state;
  }

  /**
   * Executes a protected dependency operation through the circuit breaker state machine.
   *
   * @param {() => Promise<T>} fn - Asynchronous function to execute
   * @returns {Promise<T>} Result of protected function call
   * @throws {Error} Throws fast-fail CircuitBreakerOpenException if circuit is OPEN
   *
   * @example
   * ```ts
   * const response = await circuitBreaker.execute(() => callOllamaApi(request));
   * ```
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.evaluateStateTransition();

    if (this.state === 'OPEN') {
      const openErr = new Error(
        `Circuit breaker [${this.name}] is OPEN - fast failing external dependency call`,
      );
      (openErr as any).code = 'CIRCUIT_OPEN';
      throw openErr;
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenProbes++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Internal helper evaluating OPEN -> HALF_OPEN state transition on timeout expiration.
   */
  private evaluateStateTransition(): void {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.logger.log('Circuit breaker entering HALF_OPEN probe state', {
          name: this.name,
          resetTimeoutMs: this.resetTimeoutMs,
        });
        this.state = 'HALF_OPEN';
        this.halfOpenProbes = 0;
      }
    }
  }

  /**
   * Handles successful call execution, resetting failures and closing half-open circuits.
   */
  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.logger.log('Half-open probe succeeded. Closing circuit breaker', {
        name: this.name,
      });
      this.state = 'CLOSED';
    }
    this.consecutiveFailures = 0;
  }

  /**
   * Handles call failure, incrementing failure counter and tripping circuit to OPEN when threshold reached.
   */
  private onFailure(error: unknown): void {
    if (ErrorClassifier.isRetryable(error) || this.state === 'HALF_OPEN') {
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();

      if (
        this.consecutiveFailures >= this.failureThreshold ||
        this.state === 'HALF_OPEN'
      ) {
        this.logger.warn('Circuit breaker tripped to OPEN state', {
          name: this.name,
          consecutiveFailures: this.consecutiveFailures,
          failureThreshold: this.failureThreshold,
          error: error instanceof Error ? error.message : String(error),
        });
        this.state = 'OPEN';
      }
    }
  }
}
