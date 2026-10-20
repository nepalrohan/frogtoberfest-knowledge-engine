import type { AxiosInstance } from 'axios';

/* Public connection status; access tokens never leave the backend */
export interface NotionConnectionStatus {
  connected: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceIcon: string | null;
  connectedAt: string | null;
  selectedPagesCount?: number;
}

export interface NotionAuthorizeResponse {
  authorizationUrl: string;
}

export interface NotionDisconnectResponse {
  success: boolean;
  message: string;
}

export interface PageNode {
  id: string;
  title: string;
  depth: number;
  meta: string;
  parentId?: string | null;
  object?: 'page' | 'database';
  icon?: string | null;
}

export interface NotionPagesResponse {
  pages: PageNode[];
  selectedPageIds: string[];
}

export interface SaveNotionPagesResponse {
  success: boolean;
  selectedCount: number;
  selectedPageIds: string[];
}

export interface ConnectNotionTokenResponse {
  success: boolean;
  workspaceName: string;
}

const BASE_PATH = '/v1/integrations/notion';

/* Notion OAuth and Document Management endpoints, guarded by the backend admin key */
export function createNotionApi(http: AxiosInstance) {
  return {
    getStatus: async () =>
      (await http.get<NotionConnectionStatus>(`${BASE_PATH}/status`)).data,
    authorize: async () =>
      (await http.get<NotionAuthorizeResponse>(`${BASE_PATH}/oauth/authorize`)).data,
    disconnect: async () =>
      (await http.post<NotionDisconnectResponse>(`${BASE_PATH}/disconnect`)).data,
    getPages: async () =>
      (await http.get<NotionPagesResponse>(`${BASE_PATH}/pages`)).data,
    savePages: async (pageIds: string[]) =>
      (await http.post<SaveNotionPagesResponse>(`${BASE_PATH}/pages`, { pageIds })).data,
    connectWithToken: async (token: string, workspaceName?: string) =>
      (await http.post<ConnectNotionTokenResponse>(`${BASE_PATH}/token`, { token, workspaceName })).data,
  };
}
