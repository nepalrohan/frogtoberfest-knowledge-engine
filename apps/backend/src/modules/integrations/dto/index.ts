import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/* Data transfer object for returning public connection status without sensitive credentials */
export class NotionConnectionStatusDto {
  connected!: boolean;
  workspaceId!: string | null;
  workspaceName!: string | null;
  workspaceIcon!: string | null;
  connectedAt!: string | null;
  selectedPagesCount?: number;
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

/* Data transfer object representing a page or database node in the workspace hierarchy */
export class NotionPageNodeDto {
  id!: string;
  title!: string;
  depth!: number;
  meta!: string;
  parentId?: string | null;
  object?: 'page' | 'database';
  icon?: string | null;
}

/* Response payload containing retrieved Notion pages and existing user selections */
export class NotionPagesResponseDto {
  pages!: NotionPageNodeDto[];
  selectedPageIds!: string[];
}

/* Request payload to save selected Notion page IDs */
export class SaveNotionPagesDto {
  @IsArray()
  @IsString({ each: true })
  pageIds!: string[];
}

/* Response payload after updating selected Notion page IDs */
export class SaveNotionPagesResponseDto {
  success!: boolean;
  selectedCount!: number;
  selectedPageIds!: string[];
}

/* Request payload to connect directly using a Notion Internal Integration Token */
export class ConnectNotionTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsOptional()
  @IsString()
  workspaceName?: string;
}

/* Response payload after connecting via Notion Token */
export class ConnectNotionTokenResponseDto {
  success!: boolean;
  workspaceName!: string;
}

