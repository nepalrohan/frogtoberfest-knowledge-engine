/* Injection token for the chat-model client */
export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/* Chat-model contract; implementations must reject with an AbortError once `signal` fires */
export interface ILlmClient {
  /* Streams the reply, calling onToken per delta, and resolves with the full text and usage */
  streamChat(
    messages: LlmMessage[],
    options: { signal?: AbortSignal; onToken: (delta: string) => void },
  ): Promise<LlmResult>;

  /* Non-streaming reply for short internal tasks such as query rewriting */
  complete(
    messages: LlmMessage[],
    options: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<LlmResult>;
}
