import { createApiClient } from "./core/client";
import type { ApiClientConfig } from "./core/types";
import { createNotionApi } from "./integrations/notion";

export * from "./core/types";
export * from "./core/errors";
export * from "./core/interceptors";
export * from "./core/client";
export * from "./integrations/notion";

export interface ApiClient {
  http: ReturnType<typeof createApiClient>;
  notion: ReturnType<typeof createNotionApi>;
}

/* Creates the Knowledge Engine API client with one module per backend domain */
export function createHttpApiClient(
  config: ApiClientConfig = {},
): ApiClient {
  const http = createApiClient(config);

  return {
    http,
    notion: createNotionApi(http),
  };
}
