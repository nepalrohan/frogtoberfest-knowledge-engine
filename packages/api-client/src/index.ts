import { createApiClient } from "./core/client";
import type { ApiClientConfig } from "./core/types";

export * from "./core/types";
export * from "./core/errors";
export * from "./core/interceptors";
export * from "./core/client";


export interface ApiClient {
  http: ReturnType<typeof createApiClient>;
}

/**
 * Creates the complete Rani Cake unified API client suite.
 *
 * @param {ApiClientConfig} config - Client configuration with baseURL and branch resolver
 * @returns {ApiClient} Unified client suite with all domain modules
 */
export function createHttpApiClient(
  config: ApiClientConfig = {},
): ApiClient {
  const http = createApiClient(config);

  return {
    http,
  };
}
