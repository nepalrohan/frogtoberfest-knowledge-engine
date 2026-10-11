export type ErrorCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'EXPIRED'
  | 'RESOURCE_LIMIT'
  | 'INTEGRITY'
  | 'UNKNOWN';

export class ErrorClassifier {
  static classify(error: unknown): ErrorCategory {
    if (!error || typeof error !== 'object') {
      return 'UNKNOWN';
    }

    const err = error as Record<string, any>;
    const statusCode: number | undefined =
      err.status ||
      err.statusCode ||
      err.response?.status;
    const errorCode: string = String(
      err.code || err.Code || err.name || '',
    ).toUpperCase();
    const message: string = String(err.message || '').toUpperCase();

    // Resource limits / integrity
    if (
      errorCode.includes('PAYLOADTOOLARGE') ||
      errorCode.includes('MAX_SIZE') ||
      message.includes('PAYLOAD TOO LARGE') ||
      message.includes('LIMIT EXCEEDED') ||
      statusCode === 413
    ) {
      return 'RESOURCE_LIMIT';
    }
    if (
      errorCode.includes('CHECKSUM') ||
      errorCode.includes('INTEGRITY') ||
      errorCode.includes('MAGIC_BYTE')
    ) {
      return 'INTEGRITY';
    }

    // Expired credentials / tokens
    if (
      errorCode.includes('EXPIRED') ||
      message.includes('TOKEN EXPIRED') ||
      message.includes('SESSION EXPIRED')
    ) {
      return 'EXPIRED';
    }

    // Transient HTTP codes
    const transientStatusCodes = [408, 429, 500, 502, 503, 504];
    if (statusCode && transientStatusCodes.includes(statusCode)) {
      return 'TRANSIENT';
    }

    // Transient network, timeout, and database deadlock codes
    const transientCodes = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EPIPE',
      'EAI_AGAIN',
      'REQUESTTIMEOUT',
      'REQUESTTIMEDOUT',
      'SERVICEUNAVAILABLE',
      'INTERNALERROR',
      'RATE_LIMIT',
      '40P01', // PostgreSQL deadlock detected
      '57P01', // PostgreSQL admin shutdown
    ];

    if (transientCodes.some((code) => errorCode.includes(code) || message.includes(code))) {
      return 'TRANSIENT';
    }

    // Permanent HTTP codes
    const permanentStatusCodes = [400, 401, 403, 404, 405, 410, 422];
    if (statusCode && permanentStatusCodes.includes(statusCode)) {
      return 'PERMANENT';
    }

    const permanentCodes = [
      'NOT_FOUND',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'ACCESSDENIED',
      'VALIDATION_ERROR',
      'INVALIDPARAMETER',
      'INVALID_ARGUMENT',
    ];

    if (permanentCodes.some((code) => errorCode.includes(code))) {
      return 'PERMANENT';
    }

    return 'UNKNOWN';
  }

  static isRetryable(error: unknown): boolean {
    const category = this.classify(error);
    return category === 'TRANSIENT';
  }
}
