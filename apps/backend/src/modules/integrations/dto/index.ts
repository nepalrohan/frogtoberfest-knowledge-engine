/* Data transfer object for returning public connection status without sensitive credentials */
export class NotionConnectionStatusDto {
  connected!: boolean;
  workspaceId!: string | null;
  workspaceName!: string | null;
  workspaceIcon!: string | null;
  connectedAt!: string | null;
}

/* Data transfer object for OAuth authorize endpoint */
export class NotionAuthorizeResponseDto {
  authorizationUrl!: string;
}

/* Data transfer object for disconnect operation response */
export class NotionDisconnectResponseDto {
  success!: boolean;
  message!: string;
}
