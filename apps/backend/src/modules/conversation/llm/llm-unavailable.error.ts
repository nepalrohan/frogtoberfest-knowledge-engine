/* The chat model could not produce an answer (down, erroring, stalled, or circuit open); safe to retry later */
export class LlmUnavailableError extends Error {
  readonly code = 'LLM_UNAVAILABLE';
  /* 503 lets ErrorClassifier treat it as TRANSIENT, so the circuit breaker counts it */
  readonly status = 503;
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}
