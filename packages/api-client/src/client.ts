import axios, { type AxiosInstance } from "axios";
import { applyDefaultInterceptors } from "./interceptors";
import type { ApiClientConfig } from "./types";

export const DEFAULT_API_TIMEOUT = 15000;

export function createApiClient(config: ApiClientConfig = {}): AxiosInstance {
  const {
    baseURL,
    timeout = DEFAULT_API_TIMEOUT,
    headers,
    ...restConfig
  } = config;

  const instance = axios.create({
    baseURL,
    timeout,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...restConfig,
  });

  applyDefaultInterceptors(instance, config);

  return instance;
}
