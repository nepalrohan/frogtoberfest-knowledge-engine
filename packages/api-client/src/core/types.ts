import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

export type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
};

export interface ApiClientConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  getBranchId?: () => string | null | undefined;
  getActiveBranchId?: () => string | null | undefined;
  getAuthToken?: () => string | null | undefined;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface NormalizedApiError {
  message: string;
  statusCode: number;
  errorCode?: string;
  /** Machine-readable domain error code (e.g. `ORDER_STATE_CONFLICT`) */
  code?: string;
  /** Structured domain error details (e.g. stock shortages) */
  details?: unknown;
  errors?: Record<string, string[]>;
  timestamp: string;
  path?: string;
  raw?: unknown;
}
