import type { AxiosInstance } from "axios";
import { ApiError, normalizeApiError } from "./errors";
import type { ApiClientConfig } from "./types";

export function applyDefaultInterceptors(
  instance: AxiosInstance,
  config: ApiClientConfig = {},
): void {
  // Request interceptor
  instance.interceptors.request.use(
    async (requestConfig) => {
      if (config.getAuthToken) {
        try {
          const token = await config.getAuthToken();
          if (token && requestConfig.headers) {
            requestConfig.headers.Authorization = `Bearer ${token}`;
          }
        } catch {
          // Token retrieval failed; continue request without token
        }
      }

      if (config.onRequest) {
        return config.onRequest(requestConfig);
      }

      return requestConfig;
    },
    (error) => Promise.reject(new ApiError(normalizeApiError(error))),
  );

  // Response interceptor
  instance.interceptors.response.use(
    (response) => {
      if (config.onResponse) {
        return config.onResponse(response);
      }
      return response;
    },
    async (error) => {
      if (config.onResponseError) {
        return config.onResponseError(error);
      }
      const normalized = normalizeApiError(error);
      return Promise.reject(new ApiError(normalized));
    },
  );
}
