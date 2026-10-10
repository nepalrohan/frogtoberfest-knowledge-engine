import axios, { type AxiosError } from "axios";
import type { NormalizedApiError } from "./types";

export class ApiError extends Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly errors?: Record<string, string[] | string>;
  readonly raw?: unknown;

  constructor(normalized: NormalizedApiError) {
    super(normalized.message);
    this.name = "ApiError";
    this.statusCode = normalized.statusCode;
    this.code = normalized.code;
    this.errors = normalized.errors;
    this.raw = normalized.raw;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export function isAxiosError<T = unknown>(error: unknown): error is AxiosError<T> {
  return axios.isAxiosError(error);
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      code: error.code,
      errors: error.errors,
      raw: error.raw,
    };
  }

  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as
      | { message?: string | string[]; error?: string; errors?: Record<string, string[] | string>; code?: string }
      | undefined;

    let message = error.message || "An unexpected network error occurred";

    if (responseData) {
      if (Array.isArray(responseData.message)) {
        message = responseData.message.join(", ");
      } else if (typeof responseData.message === "string") {
        message = responseData.message;
      } else if (typeof responseData.error === "string") {
        message = responseData.error;
      }
    }

    return {
      message,
      statusCode: error.response?.status,
      code: responseData?.code || error.code,
      errors: responseData?.errors,
      raw: error,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      raw: error,
    };
  }

  return {
    message: typeof error === "string" ? error : "An unknown error occurred",
    raw: error,
  };
}
