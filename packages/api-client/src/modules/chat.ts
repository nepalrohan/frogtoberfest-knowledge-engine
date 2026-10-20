import type { AxiosInstance } from 'axios';

/*
 * Chat (query pipeline) API contract.
 *
 * Endpoints:
 *   GET    /api/v1/chat              -> ConversationSummary[] (newest first)
 *   GET    /api/v1/chat/:id          -> Conversation (full message history)
 *   POST   /api/v1/chat              -> SSE stream, starts a new conversation
 *   POST   /api/v1/chat/:id          -> SSE stream, continues a conversation
 *   DELETE /api/v1/chat/:id          -> 204
 *
 * Stream event order for one turn:
 *   meta -> stage* -> sources -> token* -> done
 * `error` may replace everything after `meta`. Closing the request aborts generation.
 * Lines starting with ":" are keep-alive comments and carry no event.
 */

/* Pipeline stages reported while answering, in execution order. */
export type PipelineStage =
  | 'rewrite'
  | 'embed'
  | 'retrieve'
  | 'rerank'
  | 'select'
  | 'generate'
  | 'verify';

/* Answered = grounded answer with citations; refused = insufficient evidence or out of scope. */
export type AnswerOutcome = 'answered' | 'refused';

export type RefusalReason = 'insufficient_evidence' | 'out_of_scope' | 'unverifiable_citations';

/* One chunk sent to the LLM as context; `index` is the N in "[Source N]". */
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

/* Diagnostics for one assistant turn, shown in the run inspector. */
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
}


export interface ChatMessage {
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

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessagePreview: string;
  messageCount: number;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface SendMessagePayload {
  message: string;
  /* Re-answers this unanswered question instead of storing the question again */
  retryOfMessageId?: string;
}

/* Server-sent events emitted during one assistant turn. */
export type ChatStreamEvent =
  | {
      type: 'meta';
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      traceId: string;
      conversationTitle: string;
    }
  | { type: 'stage'; stage: PipelineStage; status: 'started' | 'completed'; durationMs?: number }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'token'; delta: string }
  | {
      type: 'done';
      outcome: AnswerOutcome;
      /* Final stored text; replaces the streamed tokens when the answer was refused or cleaned */
      content: string;
      refusalReason?: RefusalReason;
      citedIndexes: number[];
      run: RunDetails;
    }
  | { type: 'error'; code: string; message: string; retryable: boolean };

export interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

export interface ChatApi {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  /* Resolves when the stream ends; rejects with AbortError when the signal fires. */
  sendMessage(
    conversationId: string | null,
    payload: SendMessagePayload,
    options: StreamOptions,
  ): Promise<void>;
}

/* Parses an SSE byte stream into JSON events separated by blank lines. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/* Factory creating the Chat API client methods; streaming uses fetch since axios cannot stream in browsers. */
export function createChatApi(http: AxiosInstance): ChatApi {
  return {
    async listConversations(): Promise<ConversationSummary[]> {
      const response = await http.get<ConversationSummary[]>('/api/v1/chat');
      return response.data;
    },

    async getConversation(id: string): Promise<Conversation> {
      const response = await http.get<Conversation>(`/api/v1/chat/${id}`);
      return response.data;
    },

    async deleteConversation(id: string): Promise<void> {
      await http.delete(`/api/v1/chat/${id}`);
    },

    async sendMessage(conversationId, payload, { signal, onEvent }): Promise<void> {
      const path = conversationId ? `/api/v1/chat/${conversationId}` : '/api/v1/chat';
      const response = await fetch(`${http.defaults.baseURL ?? ''}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat request failed with status ${response.status}`);
      }

      await readEventStream(response.body, onEvent);
    },
  };
}
