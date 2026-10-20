/* Lifecycle states for external connector connections */
export enum ConnectorConnectionStatus {
  CONNECTED = 'CONNECTED',
  REAUTH_REQUIRED = 'REAUTH_REQUIRED',
  DISCONNECTED = 'DISCONNECTED',
}

/* Supported authentication schemes */
export enum ConnectorAuthType {
  OAUTH2 = 'OAUTH2',
  API_TOKEN = 'API_TOKEN',
}

/* Non-sensitive connection summary returned to callers */
export interface SafeConnectorConnectionDto {
  id: string;
  provider: string;
  status: ConnectorConnectionStatus;
  externalAccountId: string;
  externalAccountName: string | null;
  connectedByUserId: string;
  connectedAt: Date;
  lastVerifiedAt: Date | null;
  disconnectedAt: Date | null;
  metadata?: Record<string, any> | null;
}

/* Decrypted credential payload accessed only by internal callers */
export interface DecryptedCredentialPayload {
  accessToken: string;
  tokenType?: string;
  botId?: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  raw?: Record<string, any>;
}

/* Parameters for persisting or updating a connector connection atomically */
export interface SaveConnectionParams {
  provider: string;
  externalAccountId: string;
  externalAccountName?: string | null;
  connectedByUserId?: string;
  authType?: ConnectorAuthType;
  credentialPayload: DecryptedCredentialPayload;
  metadata?: Record<string, any>;
  expiresAt?: Date | null;
}
