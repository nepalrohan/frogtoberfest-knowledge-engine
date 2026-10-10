import axios, { AxiosInstance } from 'axios';
import { applyDefaultInterceptors } from './interceptors';
import type { ApiClientConfig } from './types';

export const DEFAULT_API_TIMEOUT = 15000;

export function createApiClient(config: ApiClientConfig = {}): AxiosInstance {
  const instance = axios.create({
    baseURL: config.baseURL || 'http://localhost:5001/api',
    timeout: config.timeout ?? DEFAULT_API_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    withCredentials: true,
  });

  applyDefaultInterceptors(instance, config);

  return instance;
}
