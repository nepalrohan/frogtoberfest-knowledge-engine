import { Logger } from '@nestjs/common';
import { ChatTurnService } from './chat-turn.service';
import type { BegunTurn, ConversationService } from './conversation.service';
import type { ILlmClient } from './llm/llm-client.interface';
import type { IEmbeddingProvider } from '../indexing/embedding/embedding.interface';
import type {
  ChunkCandidate,
  VectorStoreService,
} from '../indexing/retrieval/vector-store.service';
import type { AppConfigService } from '../../config';
import type { ChatStreamEvent } from './chat.types';
import { LlmUnavailableError } from './llm/llm-unavailable.error';
import { UNVERIFIABLE_CITATIONS_TEXT } from './generation/answer-text';

const QUERY_VECTOR = [0.1, 0.2, 0.3];

const candidate = (id: string, cosine: number): ChunkCandidate => ({
  chunkId: id,
  documentId: `doc-${id}`,
  documentVersion: 1,
  documentTitle: `Doc ${id}`,
  sourceType: 'text',
  content: `content ${id}`,
  sectionHeaders: [`Doc ${id}`],
  cosineSimilarity: cosine,
  vectorRank: 1,
  keywordRank: null,
  rrfScore: 0.03,
});

describe('ChatTurnService', () => {
  const firstTurn = {
    conversation: { id: 'conv-1', title: 'How do I roll back?' },
    userMessage: { id: 'user-1', content: 'How do I roll back?' },
    history: [],
  } as unknown as BegunTurn;
  const followUp = {
    conversation: { id: 'conv-1', title: 'How do I roll back?' },
    userMessage: { id: 'user-2', content: 'what if that fails?' },
    history: [
      { role: 'user', content: 'How do I roll back?' },
      { role: 'assistant', content: 'Redeploy the previous tag [Source 1].' },
    ],
  } as unknown as BegunTurn;

  let events: ChatStreamEvent[];
  let conversations: { saveAnswer: jest.Mock };
  let embeddings: { embed: jest.Mock; getModelName: jest.Mock };
  let vectorStore: { searchHybrid: jest.Mock };
  let llm: { streamChat: jest.Mock; complete: jest.Mock };
  let service: ChatTurnService;

  const config = {
    retrieval: {
      minSimilarity: 0.65,
      candidateK: 20,
      maxSources: 5,
      maxSourcesPerDocument: 2,
      contextTokenBudget: 2500,
    },
    llm: { rewriteTimeoutMs: 8000 },
  } as unknown as AppConfigService;

  const run = (
    signal = new AbortController().signal,
    begun: BegunTurn = firstTurn,
  ) => service.answer(begun, { emit: (e) => events.push(e), signal });

  beforeEach(() => {
    events = [];
    conversations = { saveAnswer: jest.fn() };
    embeddings = {
      embed: jest.fn(async () => [QUERY_VECTOR]),
      getModelName: jest.fn(() => 'nomic-embed-text'),
    };
    vectorStore = {
      searchHybrid: jest.fn(async () => [
        candidate('a', 0.9),
        candidate('b', 0.7),
      ]),
    };
    llm = {
      streamChat: jest.fn(async (_m, { onToken }) => {
        onToken('Redeploy [Source 1].');
        return {
          text: 'Redeploy [Source 1].',
          model: 'qwen',
          promptTokens: 50,
          completionTokens: 5,
        };
      }),
      complete: jest.fn(async () => ({
        text: 'What to do when a deploy rollback fails',
        model: 'qwen',
        promptTokens: 30,
        completionTokens: 8,
      })),
    };
    service = new ChatTurnService(
      conversations as unknown as ConversationService,
      llm as unknown as ILlmClient,
      embeddings as unknown as IEmbeddingProvider,
      vectorStore as unknown as VectorStoreService,
      config,
    );
  });

  it('embeds the question as a query, retrieves and selects context, then generates', async () => {
    await run();

    expect(embeddings.embed).toHaveBeenCalledWith(
      ['How do I roll back?'],
      'query',
    );
    expect(vectorStore.searchHybrid).toHaveBeenCalledWith(
      'How do I roll back?',
      QUERY_VECTOR,
      'nomic-embed-text',
      {
        candidateK: 20,
        signal: expect.any(AbortSignal),
      },
    );
    const sequence = events
      .filter((e) => e.type !== 'token')
      .map((e) => (e.type === 'stage' ? `${e.stage}:${e.status}` : e.type));
    expect(sequence).toEqual([
      'meta',
      'embed:started',
      'embed:completed',
      'retrieve:started',
      'retrieve:completed',
      'select:started',
      'select:completed',
      'sources',
      'generate:started',
      'generate:completed',
      'verify:started',
      'verify:completed',
      'done',
    ]);
    const sources = events.find((e) => e.type === 'sources');
    expect(
      sources?.type === 'sources' &&
        sources.sources.map((s) => [s.index, s.chunkId]),
    ).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      run: { embeddingModel: 'nomic-embed-text', candidatesRetrieved: 2 },
    });
  });

  it('refuses with insufficient evidence and never calls the model when nothing is relevant enough', async () => {
    vectorStore.searchHybrid.mockResolvedValue([candidate('a', 0.42)]);

    await run();

    expect(llm.streamChat).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'sources')).toBe(false);
    const text = events
      .filter((e) => e.type === 'token')
      .map((e) => (e.type === 'token' ? e.delta : ''))
      .join('');
    expect(text).toBe(
      'I do not have sufficient information in the indexed documentation to answer this question.',
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'refused',
      refusalReason: 'insufficient_evidence',
    });
    expect(conversations.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        outcome: 'refused',
        refusalReason: 'insufficient_evidence',
        content: text,
      }),
    );
  });

  it('grounds the prompt in history and sources, verifies citations, and stores the verified answer', async () => {
    llm.streamChat.mockImplementation(async (_m, { onToken }) => {
      onToken('Redeploy the tag [Source 1] [Source 9].');
      return {
        text: 'Redeploy the tag [Source 1] [Source 9].',
        model: 'phi4-mini',
        promptTokens: 80,
        completionTokens: 9,
      };
    });

    await run(undefined, followUp);

    const [messages] = llm.streamChat.mock.calls[0];
    expect(messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages.at(-1).content).toContain(
      '<source_document id="2" title="Doc b">',
    );
    expect(messages.at(-1).content).toMatch(/Question: what if that fails\?$/);

    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'answered',
      content: 'Redeploy the tag [Source 1].',
      citedIndexes: [1],
      run: { model: 'phi4-mini', promptTokens: 80, completionTokens: 9 },
    });
    expect(conversations.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        outcome: 'answered',
        content: 'Redeploy the tag [Source 1].',
        sources: [
          expect.objectContaining({ index: 1, cited: true }),
          expect.objectContaining({ index: 2, cited: false }),
        ],
      }),
    );
  });

  it('refuses after generation when the answer cites no provided source', async () => {
    llm.streamChat.mockImplementation(async (_m, { onToken }) => {
      onToken('Just redeploy.');
      return {
        text: 'Just redeploy.',
        model: 'phi4-mini',
        promptTokens: 80,
        completionTokens: 3,
      };
    });

    await run();

    expect(events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'refused',
      refusalReason: 'unverifiable_citations',
      content: UNVERIFIABLE_CITATIONS_TEXT,
    });
    expect(conversations.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'refused',
        refusalReason: 'unverifiable_citations',
        content: UNVERIFIABLE_CITATIONS_TEXT,
      }),
    );
  });

  it.each([
    [
      'the model server fails',
      new LlmUnavailableError('Ollama request failed: fetch failed'),
    ],
    [
      'the circuit is open',
      new LlmUnavailableError('The language model is temporarily unavailable'),
    ],
  ])(
    'ends with a retryable LLM_UNAVAILABLE error and stores no answer when %s',
    async (_case, failure) => {
      llm.streamChat.mockRejectedValue(failure);

      await run();

      expect(events.at(-1)).toEqual({
        type: 'error',
        code: 'LLM_UNAVAILABLE',
        message:
          'The language model is not responding right now. Please try again in a moment.',
        retryable: true,
      });
      expect(events.some((e) => e.type === 'done')).toBe(false);
      expect(conversations.saveAnswer).not.toHaveBeenCalled();
    },
  );

  it('rewrites a follow-up into a standalone query for retrieval but answers the original question', async () => {
    await run(undefined, followUp);

    const [rewriteMessages, rewriteOptions] = llm.complete.mock.calls[0];
    expect(rewriteMessages.at(-1).content).toContain('what if that fails?');
    expect(
      rewriteMessages.map((m: { content: string }) => m.content).join('\n'),
    ).toContain('How do I roll back?');
    expect(rewriteOptions).toMatchObject({
      timeoutMs: 8000,
      signal: expect.any(AbortSignal),
    });

    const stages = events.flatMap((e) =>
      e.type === 'stage' && e.status === 'started' ? [e.stage] : [],
    );
    expect(stages.slice(0, 2)).toEqual(['rewrite', 'embed']);
    expect(embeddings.embed).toHaveBeenCalledWith(
      ['What to do when a deploy rollback fails'],
      'query',
    );
    expect(vectorStore.searchHybrid.mock.calls[0][0]).toBe(
      'What to do when a deploy rollback fails',
    );
    expect(llm.streamChat.mock.calls[0][0].at(-1).content).toMatch(
      /Question: what if that fails\?$/,
    );
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      run: { rewrittenQuery: 'What to do when a deploy rollback fails' },
    });
  });

  it('does not rewrite the first question of a conversation', async () => {
    await run();
    expect(llm.complete).not.toHaveBeenCalled();
    expect(
      events.some((e) => e.type === 'stage' && e.stage === 'rewrite'),
    ).toBe(false);
  });

  it('falls back to the original question when rewriting fails or times out', async () => {
    llm.complete.mockRejectedValue(
      new LlmUnavailableError('Ollama request failed: timeout'),
    );

    await run(undefined, followUp);

    expect(embeddings.embed).toHaveBeenCalledWith(
      ['what if that fails?'],
      'query',
    );
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', outcome: 'answered' });
    expect(done?.type === 'done' && done.run.rewrittenQuery).toBeUndefined();
  });

  describe('trace correlation and structured logs', () => {
    let entries: { event?: string; traceId?: string; [key: string]: unknown }[];

    beforeEach(() => {
      entries = [];
      const capture = (raw: unknown) => {
        if (typeof raw === 'string' && raw.startsWith('{'))
          entries.push(JSON.parse(raw));
      };
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);
    });

    afterEach(() => jest.restoreAllMocks());

    it('uses one valid trace id for meta, the stored run and the retrieval and completion logs', async () => {
      await run();

      const meta = events[0];
      const traceId = meta?.type === 'meta' ? meta.traceId : '';
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(traceId).not.toBe('0'.repeat(32));
      expect(conversations.saveAnswer.mock.calls[0][0].run.traceId).toBe(
        traceId,
      );
      expect(
        entries.find((e) => e.event === 'retrieval.completed'),
      ).toMatchObject({
        traceId,
        candidates: 2,
        selectedChunkIds: ['a', 'b'],
        bestSimilarity: 0.9,
      });
      expect(
        entries.find((e) => e.event === 'chat.request.completed'),
      ).toMatchObject({
        traceId,
        conversationId: 'conv-1',
        outcome: 'answered',
      });
    });

    it('logs a no-evidence retrieval with its best similarity', async () => {
      vectorStore.searchHybrid.mockResolvedValue([candidate('a', 0.42)]);
      await run();
      const meta = events[0];
      expect(
        entries.find((e) => e.event === 'retrieval.no_evidence'),
      ).toMatchObject({
        traceId: meta?.type === 'meta' ? meta.traceId : '',
        bestSimilarity: 0.42,
      });
    });

    it('logs a failed request when the model is unavailable', async () => {
      llm.streamChat.mockRejectedValue(
        new LlmUnavailableError('Ollama request failed: fetch failed'),
      );
      await run();
      expect(
        entries.find((e) => e.event === 'chat.request.failed'),
      ).toMatchObject({ code: 'LLM_UNAVAILABLE' });
    });
  });
});
