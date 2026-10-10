import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

export interface ApiClientConfig extends AxiosRequestConfig {
  /**
   * Optional function to retrieve auth token for requests.
   */
  getAuthToken?: () => string | null | Promise<string | null>;
  /**
   * Optional function to retrieve active branch ID for requests (UUID or 'ALL').
   */
  getActiveBranchId?: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Custom request interceptor hook.
   */
  onRequest?: (
    config: InternalAxiosRequestConfig,
  ) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
  /**
   * Custom response interceptor hook.
   */
  onResponse?: (
    response: AxiosResponse,
  ) => AxiosResponse | Promise<AxiosResponse>;
  /**
   * Custom response error interceptor hook.
   */
  onResponseError?: (error: unknown) => Promise<never> | never;
}

export interface NormalizedApiError {
  message: string;
  statusCode?: number;
  code?: string;
  errors?: Record<string, string[] | string>;
  raw?: unknown;
}

export type { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig };
