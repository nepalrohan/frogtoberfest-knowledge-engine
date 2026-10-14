/* Connector configuration defining connection details, authentication credentials, and optional sync filters. */
export interface ConnectorConfig {
  sourceType: 'notion' | 'confluence';
  baseUrl?: string;
  auth: {
    token?: string;
    username?: string;
  };
  syncFilter?: {
    spaceKeys?: string[];
    parentPageIds?: string[];
    since?: Date;
  };
}

/* Diagnostic message captured during traversal, parsing, or normalization. */
export interface DiagnosticMessage {
  code: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  blockId?: string;
  blockType?: string;
  timestamp?: string;
  details?: Record<string, any>;
}

/* Raw source item retrieved from an external knowledge provider before AST normalization. */
export interface RawSourceItem {
  sourceId: string;
  sourceType: 'notion' | 'confluence';
  title: string;
  sourceUrl: string;
  rawPayload: any;
  sourceUpdatedAt: Date;
  metadata: Record<string, any>;
}

/* Canonical normalized document payload compatible with database storage and vector indexing. */
export interface NormalizedDocumentPayload {
  sourceType: 'notion' | 'confluence';
  sourceId: string;
  sourceUrl: string;
  title: string;
  rawContent?: string;
  normalizedContent: string;
  contentHash: string;
  sourceUpdatedAt: Date;
  metadata: {
    spaceKey?: string;
    parentHierarchy: string[];
    author?: string;
    tags?: string[];
    isComplete?: boolean;
    diagnostics?: DiagnosticMessage[];
    [key: string]: any;
  };
}

/* Unified connector interface for knowledge sources adhering to strict modular decoupling. */
export interface KnowledgeConnector {
  testConnection(): Promise<{ success: boolean; message: string }>;
  fetchIncremental(cursor?: string): Promise<{
    items: RawSourceItem[];
    nextCursor?: string;
    hasMore: boolean;
  }>;
  fetchDeletions(since: Date): Promise<string[]>;
}
