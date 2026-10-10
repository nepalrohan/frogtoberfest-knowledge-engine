import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ApiError, normalizeApiError } from './errors';
import type { ApiClientConfig } from './types';

export function applyDefaultInterceptors(
  instance: AxiosInstance,
  config?: ApiClientConfig,
): void {
  /* Request Interceptor for Bearer auth and Branch header injection */

  instance.interceptors.request.use(
    (reqConfig: InternalAxiosRequestConfig) => {
      /* Inject Authorization Bearer token if getter provided */

      const token = config?.getAuthToken?.();
      if (token && !reqConfig.headers.Authorization) {
        reqConfig.headers.Authorization = `Bearer ${token}`;
      }

      /* Inject x-branch-id header if getter provided */

      const branchId = config?.getActiveBranchId?.() ?? config?.getBranchId?.();
      if (branchId && !reqConfig.headers['x-branch-id']) {
        reqConfig.headers['x-branch-id'] = branchId;
      }

      return reqConfig;
    },
    (error) => Promise.reject(new ApiError(normalizeApiError(error))),
  );

  /* Response Interceptor for uniform error mapping */

  instance.interceptors.response.use(
    (response) => response,
    (error) => Promise.reject(new ApiError(normalizeApiError(error))),
  );
}
