import { createHttpApiClient, type ApiClient } from '@repo/api-client';

/* Same backend resolution as lib/api.ts; port 5000 is taken by macOS AirPlay, so the backend runs on 5003 */
export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://localhost:5003';

/* Unified API client configured for Knowledge Engine ingestion & assistant services */
export const apiClient: ApiClient = createHttpApiClient({
  baseURL: apiBaseUrl,
});

export default apiClient;
