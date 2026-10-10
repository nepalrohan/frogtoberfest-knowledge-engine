import axios, { AxiosError } from 'axios';
import type { NormalizedApiError } from './types';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode?: string;
  readonly code?: string;
  readonly details?: unknown;
  readonly errors?: Record<string, string[]>;
  readonly timestamp: string;
  readonly path?: string;
  readonly raw?: unknown;

  constructor(normalized: NormalizedApiError) {
    super(normalized.message);
    this.name = 'ApiError';
    this.statusCode = normalized.statusCode;
    this.errorCode = normalized.errorCode;
    this.code = normalized.code;
    this.details = normalized.details;
    this.errors = normalized.errors;
    this.timestamp = normalized.timestamp;
    this.path = normalized.path;
    this.raw = normalized.raw;
  }
}

export function isAxiosError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error);
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  const timestamp = new Date().toISOString();

  if (isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const data = error.response?.data as Record<string, unknown> | undefined;

    const message =
      typeof data?.message === 'string'
        ? data.message
        : Array.isArray(data?.message)
          ? data.message.join(', ')
          : error.message || 'An unexpected network error occurred';

    const errorCode = typeof data?.error === 'string' ? data.error : undefined;
    const code = typeof data?.code === 'string' ? data.code : undefined;
    const errors =
      data?.errors && typeof data.errors === 'object'
        ? (data.errors as Record<string, string[]>)
        : undefined;

    return {
      message,
      statusCode: status,
      errorCode,
      code,
      details: data?.details,
      errors,
      timestamp,
      path: error.config?.url,
      raw: error,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      statusCode: 500,
      timestamp,
      raw: error,
    };
  }

  return {
    message: 'An unknown error occurred',
    statusCode: 500,
    timestamp,
    raw: error,
  };
}
