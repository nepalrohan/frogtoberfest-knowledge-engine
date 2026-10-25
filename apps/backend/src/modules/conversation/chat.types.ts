/* Chat domain types; mirrors the wire contract in packages/api-client/src/modules/chat.ts */

export type PipelineStage =
  | 'rewrite'
  | 'embed'
  | 'retrieve'
  | 'rerank'
  | 'select'
  | 'generate'
  | 'verify';

export type AnswerOutcome = 'answered' | 'refused';

export type RefusalReason =
  'insufficient_evidence' | 'out_of_scope' | 'unverifiable_citations';

/* One chunk sent to the LLM as context; `index` is the N in "[Source N]" */
export interface ChatSource {
  index: number;
  chunkId: string;
  documentId: string;
  documentVersion: number;
  documentTitle: string;
  sourceType: string;
  sourceUrl?: string;
  sectionHeaders: string[];
  snippet: string;
  score: number;
  cited: boolean;
}

export interface StageTiming {
  stage: PipelineStage;
  durationMs: number;
}

export interface RunDetails {
  traceId: string;
  model: string;
  embeddingModel: string;
  rewrittenQuery?: string;
  candidatesRetrieved: number;
  contextTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalLatencyMs: number;
  stages: StageTiming[];
  /* Set when an identical earlier answer was reused instead of running the pipeline */
  cachedFromMessageId?: string;
  /* True when a cross-encoder reordered the candidates before selection */
  reranked?: boolean;
  /* Oldest history messages and lowest-ranked sources left out to fit the model's context window */
  historyDropped?: number;
  sourcesDropped?: number;
  /* Citations removed because their sentence shared no words with the cited source */
  unsupportedCitations?: number;
  /* Answer shown although none of its citations could be verified */
  citationsUnverified?: boolean;
}


export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /* Present only when the client stopped the answer mid-stream */
  status?: 'stopped';
  outcome?: AnswerOutcome;
  refusalReason?: RefusalReason;
  sources?: ChatSource[];
  run?: RunDetails;
}

export interface ConversationSummaryView {
  id: string;
  title: string;
  lastMessagePreview: string;
  messageCount: number;
  updatedAt: string;
}

export interface ConversationView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageView[];
}

/* Server-sent events emitted during one assistant turn */
export type ChatStreamEvent =
  | {
      type: 'meta';
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      traceId: string;
      conversationTitle: string;
    }
  | {
      type: 'stage';
      stage: PipelineStage;
      status: 'started' | 'completed';
      durationMs?: number;
    }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'token'; delta: string }
  | {
      type: 'done';
      outcome: AnswerOutcome;
      /* Final stored text; differs from the streamed tokens when the answer was refused or cleaned */
      content: string;
      refusalReason?: RefusalReason;
      citedIndexes: number[];
      run: RunDetails;
    }
  | { type: 'error'; code: string; message: string; retryable: boolean };
