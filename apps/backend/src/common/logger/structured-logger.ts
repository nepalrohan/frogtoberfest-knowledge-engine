import { LoggerService } from '@nestjs/common';

export interface StructuredLogContext {
  level?: string;
  timestamp?: string;
  context?: string;
  action?: string;
  userId?: string;
  branchId?: string;
  resource?: string;
  resourceId?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = [
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'code',
  'otp',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
];

/**
 * Sanitizes an object by recursively masking sensitive keys and PII.
 *
 * @param {Record<string, unknown>} data - Raw metadata object
 * @returns {Record<string, unknown>} Sanitized metadata
 */
export function sanitizeLogMetadata(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      result[key] = '[REDACTED]';
      continue;
    }

    /* Mask full phone number and email if present */
    if (lowerKey === 'phonenumber' || lowerKey === 'phone') {
      if (typeof value === 'string' && value.length > 5) {
        result[key] = `${value.slice(0, 3)}***${value.slice(-2)}`;
      } else {
        result[key] = '[MASKED_PHONE]';
      }
      continue;
    }

    if (lowerKey === 'email') {
      if (typeof value === 'string' && value.includes('@')) {
        const [user, domain] = value.split('@');
        result[key] = `${user?.slice(0, 2)}***@${domain}`;
      } else {
        result[key] = '[MASKED_EMAIL]';
      }
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[key] = sanitizeLogMetadata(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Structured Logger utility for domain services and repositories.
 *
 * @remarks
 * - Enforces JSON metadata objects over string template literals.
 * - Prevents PII leakage in application telemetry.
 */
export class StructuredLogger implements LoggerService {
  constructor(private readonly contextName: string) {}

  private formatEntry(
    level: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      level,
      timestamp: new Date().toISOString(),
      context: this.contextName,
      message,
      ...(metadata ? sanitizeLogMetadata(metadata) : {}),
    };
  }

  log(message: string, metadata?: Record<string, unknown>): void {
    const entry = this.formatEntry('INFO', message, metadata);
    console.log(JSON.stringify(entry));
  }

  error(message: string, trace?: string, metadata?: Record<string, unknown>): void {
    const entry = this.formatEntry('ERROR', message, {
      ...metadata,
      ...(trace ? { trace } : {}),
    });
    console.error(JSON.stringify(entry));
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    const entry = this.formatEntry('WARN', message, metadata);
    console.warn(JSON.stringify(entry));
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    const entry = this.formatEntry('DEBUG', message, metadata);
    console.debug(JSON.stringify(entry));
  }

  verbose(message: string, metadata?: Record<string, unknown>): void {
    const entry = this.formatEntry('VERBOSE', message, metadata);
    console.log(JSON.stringify(entry));
  }
}
