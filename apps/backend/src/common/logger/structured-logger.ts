// import { LoggerService } from '@nestjs/common';

// export interface StructuredLogContext {
//   level?: string;
//   timestamp?: string;
//   context?: string;
//   action?: string;
//   userId?: string;
//   branchId?: string;
//   resource?: string;
//   resourceId?: string;
//   [key: string]: unknown;
// }

// const SENSITIVE_KEYS = [
//   'password',
//   'token',
//   'accesstoken',
//   'refreshtoken',
//   'idtoken',
//   'code',
//   'otp',
//   'secret',
//   'authorization',
//   'cookie',
//   'set-cookie',
// ];

// /**
//  * Sanitizes an object by recursively masking sensitive keys and PII.
//  *
//  * @param {Record<string, unknown>} data - Raw metadata object
//  * @returns {Record<string, unknown>} Sanitized metadata
//  */
// export function sanitizeLogMetadata(data?: Record<string, unknown>): Record<string, unknown> | undefined {
//   if (!data || typeof data !== 'object') {
//     return undefined;
//   }

//   const result: Record<string, unknown> = {};

//   for (const [key, value] of Object.entries(data)) {
//     const lowerKey = key.toLowerCase();

//     if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
//       result[key] = '[REDACTED]';
//       continue;
//     }

//     /* Mask full phone number and email if present */
//     if (lowerKey === 'phonenumber' || lowerKey === 'phone') {
//       if (typeof value === 'string' && value.length > 5) {
//         result[key] = `${value.slice(0, 3)}***${value.slice(-2)}`;
//       } else {
//         result[key] = '[MASKED_PHONE]';
//       }
//       continue;
//     }

//     if (lowerKey === 'email') {
//       if (typeof value === 'string' && value.includes('@')) {
//         const [user, domain] = value.split('@');
//         result[key] = `${user?.slice(0, 2)}***@${domain}`;
//       } else {
//         result[key] = '[MASKED_EMAIL]';
//       }
//       continue;
//     }

//     if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
//       result[key] = sanitizeLogMetadata(value as Record<string, unknown>);
//     } else {
//       result[key] = value;
//     }
//   }

//   return result;
// }

// /**
//  * Structured Logger utility for domain services and repositories.
//  *
//  * @remarks
//  * - Enforces JSON metadata objects over string template literals.
//  * - Prevents PII leakage in application telemetry.
//  */
// export class StructuredLogger implements LoggerService {
//   constructor(private readonly contextName: string) {}

//   private formatEntry(
//     level: string,
//     message: string,
//     metadata?: Record<string, unknown>,
//   ): Record<string, unknown> {
//     return {
//       level,
//       timestamp: new Date().toISOString(),
//       context: this.contextName,
//       message,
//       ...(metadata ? sanitizeLogMetadata(metadata) : {}),
//     };
//   }

//   log(message: string, metadata?: Record<string, unknown>): void {
//     const entry = this.formatEntry('INFO', message, metadata);
//     console.log(JSON.stringify(entry));
//   }

//   error(message: string, trace?: string, metadata?: Record<string, unknown>): void {
//     const entry = this.formatEntry('ERROR', message, {
//       ...metadata,
//       ...(trace ? { trace } : {}),
//     });
//     console.error(JSON.stringify(entry));
//   }

//   warn(message: string, metadata?: Record<string, unknown>): void {
//     const entry = this.formatEntry('WARN', message, metadata);
//     console.warn(JSON.stringify(entry));
//   }

//   debug(message: string, metadata?: Record<string, unknown>): void {
//     const entry = this.formatEntry('DEBUG', message, metadata);
//     console.debug(JSON.stringify(entry));
//   }

//   verbose(message: string, metadata?: Record<string, unknown>): void {
//     const entry = this.formatEntry('VERBOSE', message, metadata);
//     console.log(JSON.stringify(entry));
//   }
// }



import { Logger } from '@nestjs/common';
import { TraceContextPropagator } from '../telemetry/trace-context.propagator';
import { LogEvent } from './log-events';
import { ErrorClassifier } from '../resilience';


export interface LogContext {
  event?: LogEvent;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  jobId?: string;
  documentId?: string;
  versionId?: string;
  chunkId?: string;
  eventId?: string;
  messageId?: string;
  workerName?: string;
  stage?: string;
  attempt?: number;
  durationMs?: number;
  errorType?: string;
  errorMessage?: string;
  retryable?: boolean;
  [key: string]: unknown;
}

export interface StructuredLogEntry extends LogContext {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  event?: LogEvent;
  service: string;
  contextName: string;
}

export class StructuredLogger {
  private readonly nestLogger: Logger;
  private readonly contextName: string;
  private readonly serviceName: string;

  constructor(contextName: string, serviceName = 'knowledge-engine') {
    this.contextName = contextName;
    this.serviceName = serviceName;
    this.nestLogger = new Logger(contextName);
  }

  private normalizeArgs(
    arg1: string | LogContext,
    arg2?: unknown,
    arg3?: LogContext,
  ): { message: string; event?: LogEvent; error?: unknown; context: LogContext } {
    let message = '';
    let event: LogEvent | undefined;
    let error: unknown = undefined;
    let context: LogContext = {};

    if (typeof arg1 === 'string') {
      message = arg1;
      if (arg2 instanceof Error) {
        error = arg2;
        context = arg3 || {};
      } else if (arg2 && typeof arg2 === 'object') {
        const obj = arg2 as LogContext;
        if (obj.error) {
          error = obj.error;
        }
        context = { ...obj };
      }
    } else if (arg1 && typeof arg1 === 'object') {
      context = { ...arg1 };
      if (context.error) {
        error = context.error;
      }
      if (typeof arg2 === 'string') {
        message = arg2;
      } else if (context.message && typeof context.message === 'string') {
        message = context.message;
      } else if (context.event) {
        message = String(context.event);
      }
    }

    if (context.event) {
      event = context.event;
    } else if (message.includes('.') && !message.includes(' ')) {
      event = message as LogEvent;
    }

    return { message, event, error, context };
  }

  private buildEntry(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    event?: LogEvent,
    error?: unknown,
    ctx: LogContext = {},
  ): StructuredLogEntry {
    const traceInfo = TraceContextPropagator.getActiveTraceInfo();

    let errorType: string | undefined = ctx.errorType;
    let errorMessage: string | undefined = ctx.errorMessage;
    let retryable: boolean | undefined = ctx.retryable;

    if (error) {
      if (!errorType) {
        errorType = ErrorClassifier.classify(error);
      }
      if (retryable === undefined) {
        retryable = ErrorClassifier.isRetryable(error);
      }
      if (!errorMessage) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    }

    const cleanCtx = { ...ctx };
    delete cleanCtx.error; // Avoid dumping raw error object if serialized

    return {
      timestamp: new Date().toISOString(),
      level,
      message: message || (event ? String(event) : ''),
      event,
      service: this.serviceName,
      contextName: this.contextName,
      traceId: cleanCtx.traceId || traceInfo.traceId,
      spanId: cleanCtx.spanId || traceInfo.spanId,
      ...cleanCtx,
      ...(errorType ? { errorType } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
    };
  }

  log(messageOrContext: string | LogContext, contextOrMessage?: LogContext | string): void {
    this.info(messageOrContext, contextOrMessage);
  }

  info(messageOrContext: string | LogContext, contextOrMessage?: LogContext | string): void {
    const { message, event, error, context } = this.normalizeArgs(
      messageOrContext,
      contextOrMessage,
    );
    const entry = this.buildEntry('info', message, event, error, context);
    this.nestLogger.log(JSON.stringify(entry));
  }

  logEvent(event: LogEvent, context: LogContext = {}): void {
    const entry = this.buildEntry('info', (context.message as string) || event, event, undefined, {
      ...context,
      event,
    });
    this.nestLogger.log(JSON.stringify(entry));
  }

  warn(
    messageOrContext: string | LogContext,
    contextOrMessage?: LogContext | string,
  ): void {
    const { message, event, error, context } = this.normalizeArgs(
      messageOrContext,
      contextOrMessage,
    );
    const entry = this.buildEntry('warn', message, event, error, context);
    this.nestLogger.warn(JSON.stringify(entry));
  }

  warnEvent(event: LogEvent, context: LogContext = {}): void {
    const entry = this.buildEntry('warn', (context.message as string) || event, event, undefined, {
      ...context,
      event,
    });
    this.nestLogger.warn(JSON.stringify(entry));
  }

  debug(
    messageOrContext: string | LogContext,
    contextOrMessage?: LogContext | string,
  ): void {
    const { message, event, error, context } = this.normalizeArgs(
      messageOrContext,
      contextOrMessage,
    );
    const entry = this.buildEntry('debug', message, event, error, context);
    this.nestLogger.debug(JSON.stringify(entry));
  }

  debugEvent(event: LogEvent, context: LogContext = {}): void {
    const entry = this.buildEntry('debug', (context.message as string) || event, event, undefined, {
      ...context,
      event,
    });
    this.nestLogger.debug(JSON.stringify(entry));
  }

  logError(event: LogEvent, error: unknown, context: LogContext = {}): void {
    const entry = this.buildEntry(
      'error',
      (context.message as string) || event,
      event,
      error,
      { ...context, event },
    );
    this.nestLogger.error(
      JSON.stringify(entry),
      error instanceof Error ? error.stack : undefined,
    );
  }

  error(
    messageOrContext: string | LogContext,
    errorOrContextOrMessage?: unknown,
    context?: LogContext,
  ): void {
    const {
      message,
      event,
      error,
      context: normCtx,
    } = this.normalizeArgs(messageOrContext, errorOrContextOrMessage, context);
    const entry = this.buildEntry('error', message, event, error, normCtx);
    this.nestLogger.error(
      JSON.stringify(entry),
      error instanceof Error ? error.stack : undefined,
    );
  }
}
