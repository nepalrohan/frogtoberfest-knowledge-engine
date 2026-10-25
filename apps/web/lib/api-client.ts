import { createHttpApiClient, type ApiClient } from '@repo/api-client';

/* Unified API client configured for Knowledge Engine ingestion & assistant services */
const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const apiClient: ApiClient = createHttpApiClient({
  baseURL: apiBaseUrl,
});

export default apiClient;
