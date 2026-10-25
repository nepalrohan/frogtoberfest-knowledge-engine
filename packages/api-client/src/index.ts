import { createApiClient } from "./core/client";
import type { ApiClientConfig } from "./core/types";
import { createIngestionApi, type IngestionApi } from "./modules/ingestion";
import { createChatApi, type ChatApi } from "./modules/chat";
import { createNotionApi } from "./integrations/notion";

export * from "./core/types";
export * from "./core/errors";
export * from "./core/interceptors";
export * from "./core/client";
export * from "./modules/ingestion";
export * from "./modules/chat";
export * from "./integrations/notion";

export interface ApiClient {
  http: ReturnType<typeof createApiClient>;
  ingestion: IngestionApi;
  chat: ChatApi;
  notion: ReturnType<typeof createNotionApi>;
}

/* Creates the Knowledge Engine API client with one module per backend domain */
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
    notion: createNotionApi(http),
  };
}
