import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StructuredLogger } from '../logger/structured-logger';

export interface ErrorResponseBody {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
  error?: string;
  code?: string;
  details?: unknown;
}

/**
 * Global HTTP Exception Filter providing uniform error responses and structured telemetry.
 *
 * @remarks
 * - Intercepts all thrown HTTP and unhandled exceptions across the NestJS pipeline.
 * - Logs user-relevant client errors (4xx) at the `WARN` log level with contextual metadata.
 * - Logs server errors (5xx) at the `ERROR` log level including full stack trace telemetry.
 * - Formats consistent RFC-compliant JSON response payloads.
 * - Forwards an optional domain `code` and structured `details` from the exception body.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new StructuredLogger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { user?: { id: string; role?: string }; branchId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorName = 'InternalServerError';
    let errorResponse: Record<string, unknown> | string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      errorName = exception.name;

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        message = (obj.message as string | string[]) || exception.message;
        errorResponse = obj;
        if (typeof obj.error === 'string') {
          errorName = obj.error;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorName = exception.name;
    }

    const isClientError = status >= 400 && status < 500;
    const logMetadata = {
      statusCode: status,
      errorName,
      message,
      method: request.method,
      path: request.originalUrl || request.url,
      ip: request.ip,
      userId: request.user?.id,
      userRole: request.user?.role,
      branchId: request.branchId || (request.headers['x-branch-id'] as string | undefined),
    };

    if (isClientError) {
      /* User-relevant client exceptions logged at WARN level */
      this.logger.warn(`Client Error [${status}] ${request.method} ${request.url} - ${Array.isArray(message) ? message.join(', ') : message}`, logMetadata);
    } else {
      /* Server/unhandled exceptions logged at ERROR level */
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Server Error [${status}] ${request.method} ${request.url} - ${message}`, stack, logMetadata);
    }

    const payload: ErrorResponseBody = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url,
      method: request.method,
      message,
      error: errorName,
    };

    if (errorResponse && typeof errorResponse === 'object' && 'errors' in errorResponse) {
      payload.details = errorResponse.errors;
    }

    /* Machine-readable domain error code and structured details (e.g. order conflicts, stock shortages) */
    if (errorResponse && typeof errorResponse === 'object') {
      if (typeof errorResponse.code === 'string') {
        payload.code = errorResponse.code;
      }

      if ('details' in errorResponse && payload.details === undefined) {
        payload.details = errorResponse.details;
      }
    }

    response.status(status).json(payload);
  }
}
