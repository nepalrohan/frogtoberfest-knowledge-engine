import { DiagnosticMessage } from './connector.types';

/* Rich text annotation styling attributes from Notion. */
export interface NotionAnnotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

/* Rich text element inside a Notion block or property. */
export interface NotionRichText {
  type: string;
  plain_text: string;
  href: string | null;
  annotations: NotionAnnotations;
  text?: {
    content: string;
    link: { url: string } | null;
  };
}

/* Supported block payload data map. */
export interface NotionBlockData {
  rich_text?: NotionRichText[];
  checked?: boolean;
  color?: string;
  [key: string]: any;
}

/* Raw Notion API block response object. */
export interface NotionBlockResponse {
  id: string;
  type: string;
  has_children: boolean;
  created_time?: string;
  last_edited_time?: string;
  heading_1?: NotionBlockData;
  heading_2?: NotionBlockData;
  heading_3?: NotionBlockData;
  paragraph?: NotionBlockData;
  bulleted_list_item?: NotionBlockData;
  numbered_list_item?: NotionBlockData;
  to_do?: NotionBlockData;
  toggle?: NotionBlockData;
  [key: string]: any;
}

/* Recursive block node carrying hierarchically nested child blocks. */
export interface NotionBlockWithChildren extends NotionBlockResponse {
  children?: NotionBlockWithChildren[];
}

/* Notion block children API response with cursor pagination. */
export interface NotionBlockChildrenResponse {
  object: 'list';
  results: NotionBlockResponse[];
  next_cursor: string | null;
  has_more: boolean;
}

/* Raw Notion API page response object. */
export interface NotionPageResponse {
  id: string;
  object: 'page';
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, any>;
  [key: string]: any;
}

/* Outcome of Notion document retrieval including reconstructed tree and diagnostics. */
export interface NotionRetrievalResult {
  page: NotionPageResponse;
  rootBlocks: NotionBlockWithChildren[];
  isComplete: boolean;
  totalRequests: number;
  diagnostics: DiagnosticMessage[];
}
