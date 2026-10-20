import { createApiClient } from "./core/client";
import type { ApiClientConfig } from "./core/types";
import { createIngestionApi, type IngestionApi } from "./modules/ingestion";
import { createChatApi, type ChatApi } from "./modules/chat";

export * from "./core/types";
export * from "./core/errors";
export * from "./core/interceptors";
export * from "./core/client";
export * from "./modules/ingestion";
export * from "./modules/chat";

export interface ApiClient {
  http: ReturnType<typeof createApiClient>;
  ingestion: IngestionApi;
  chat: ChatApi;
}

/**
 * Creates the complete Knowledge Engine API client suite.
 *
 * @param {ApiClientConfig} config - Client configuration with baseURL
 * @returns {ApiClient} Unified client suite with all domain modules
 */
export function createHttpApiClient(
  config: ApiClientConfig = {},
): ApiClient {
  const http = createApiClient(config);
  const ingestion = createIngestionApi(http);
  const chat = createChatApi(http);

  return {
    http,
    ingestion,
    chat,
  };
}
