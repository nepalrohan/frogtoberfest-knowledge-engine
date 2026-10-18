import type { AxiosInstance } from 'axios';

/* Public connection status; access tokens never leave the backend */
export interface NotionConnectionStatus {
  connected: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceIcon: string | null;
  connectedAt: string | null;
}

export interface NotionAuthorizeResponse {
  authorizationUrl: string;
}

export interface NotionDisconnectResponse {
  success: boolean;
  message: string;
}

const BASE_PATH = '/v1/integrations/notion';

/* Notion OAuth lifecycle endpoints, all guarded by the backend admin key */
export function createNotionApi(http: AxiosInstance) {
  return {
    getStatus: async () =>
      (await http.get<NotionConnectionStatus>(`${BASE_PATH}/status`)).data,
    authorize: async () =>
      (await http.get<NotionAuthorizeResponse>(`${BASE_PATH}/oauth/authorize`)).data,
    disconnect: async () =>
      (await http.post<NotionDisconnectResponse>(`${BASE_PATH}/disconnect`)).data,
  };
}
