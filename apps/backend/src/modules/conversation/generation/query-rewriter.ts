import type { HistoryMessage } from '../conversation.service';
import type { ILlmClient, LlmMessage } from '../llm/llm-client.interface';

const REWRITE_INSTRUCTIONS = `Rewrite the user's latest question as a single standalone search query for an internal documentation search engine.
Resolve pronouns and references using the conversation. Keep product names, error codes and identifiers exactly.
Reply with the query only: no answer, no quotes, no explanation.`;

/* Words that point back into the conversation ("what about that one?") */
const REFERRING =
  /\b(it|its|it's|this|that|these|those|they|them|their|there|he|she|his|her|above|previous|same|also|else|other|another|more|again|instead|then)\b/i;
const OPENS_WITH_CONTINUATION = /^\s*(and|but|or|so|what about|how about|why|why not)\b/i;
/* Questions this short almost always lean on the previous turn */
const SHORT_QUESTION_WORDS = 4;

/* Skips the extra model call when the follow-up already stands on its own */
export function needsRewrite(question: string): boolean {
  const words = question.trim().split(/\s+/).filter(Boolean);
  return (
    words.length <= SHORT_QUESTION_WORDS ||
    REFERRING.test(question) ||
    OPENS_WITH_CONTINUATION.test(question)
  );
}

/* Turns a context-dependent follow-up into a standalone retrieval query; returns undefined to keep the original */
export async function rewriteFollowUp(
  llm: ILlmClient,
  {
    question,
    history,
    timeoutMs,
    signal,
  }: {
    question: string;
    history: HistoryMessage[];
    timeoutMs: number;
    signal: AbortSignal;
  },
): Promise<string | undefined> {
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const messages: LlmMessage[] = [
    { role: 'system', content: REWRITE_INSTRUCTIONS },
    {
      role: 'user',
      content: `Conversation:\n${transcript}\n\nLatest question: ${question}`,
    },
  ];
  try {
    const { text } = await llm.complete(messages, { signal, timeoutMs });
    const query = text
      .split('\n')[0]
      ?.trim()
      .replace(/^["'`]|["'`]$/g, '');
    return query && query.toLowerCase() !== question.toLowerCase()
      ? query
      : undefined;
  } catch (err) {
    /* A caller abort must still stop the turn; any model failure just keeps the original question */
    if (signal.aborted) throw err;
    return undefined;
  }
}
