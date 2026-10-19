import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { QUESTION_RATE_LIMIT } from './question-rate-limit';
import request from 'supertest';
import { request as httpRequest } from 'http';
import type { AddressInfo } from 'net';
import { LLM_CLIENT, type ILlmClient } from './llm/llm-client.interface';
import { EMBEDDING_PROVIDER_TOKEN } from '../indexing/embedding/embedding.interface';
import { VectorStoreService } from '../indexing/retrieval/vector-store.service';
import { AppConfigService } from '../../config';
import { ChatController } from './chat.controller';
import { ConversationService } from './conversation.service';
import { ChatTurnService } from './chat-turn.service';
import type {
  ChatStreamEvent,
  ConversationSummaryView,
  ConversationView,
} from './chat.types';

/* Buffers a server-sent event stream and parses each `data:` line as one JSON event */
const parseSse = (
  res: any,
  done: (err: Error | null, body: ChatStreamEvent[]) => void,
) => {
  let raw = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => (raw += chunk));
  res.on('end', () =>
    done(
      null,
      raw
        .split('\n\n')
        .filter((block) => block.startsWith('data: '))
        .map((block) => JSON.parse(block.slice(6)) as ChatStreamEvent),
    ),
  );
};

const KNOWN_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

describe('Chat HTTP API', () => {
  let app: INestApplication;

  const summary: ConversationSummaryView = {
    id: KNOWN_ID,
    title: 'How do I roll back?',
    lastMessagePreview: 'Redeploy the previous tag',
    messageCount: 2,
    updatedAt: '2026-10-19T10:00:00.000Z',
  };
  const conversation: ConversationView = {
    id: KNOWN_ID,
    title: 'How do I roll back?',
    createdAt: '2026-10-19T09:59:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'How do I roll back?',
        createdAt: '2026-10-19T09:59:00.000Z',
      },
    ],
  };

  /* In-memory stand-in honouring the service's not-found contract */
  const calls: string[] = [];
  const fakeConversations = {
    beginTurn: jest.fn(async (id: string | null, question: string) => {
      if (id && id !== KNOWN_ID) throw new NotFoundException();
      calls.push('beginTurn');
      return {
        conversation: { id: KNOWN_ID, title: question.slice(0, 60) },
        userMessage: { id: 'user-message-1' },
        history: [],
      };
    }),
    saveAnswer: jest.fn(async () => {
      calls.push('saveAnswer');
    }),
    listConversations: jest.fn(async () => [summary]),
    getConversation: jest.fn(async (id: string) => {
      if (id !== KNOWN_ID) throw new NotFoundException();
      return conversation;
    }),
    deleteConversation: jest.fn(async (id: string) => {
      if (id !== KNOWN_ID) throw new NotFoundException();
    }),
  };

  /* Streams a short canned answer word by word */
  const streamCanned: ILlmClient['streamChat'] = async (
    _messages,
    { onToken },
  ) => {
    for (const word of [
      'Redeploy ',
      'the ',
      'previous ',
      'tag ',
      '[Source 1].',
    ])
      onToken(word);
    return {
      text: 'Redeploy the previous tag [Source 1].',
      model: 'fake-llm',
      promptTokens: 10,
      completionTokens: 5,
    };
  };
  const fakeLlm = {
    streamChat: jest.fn(streamCanned),
    complete: jest.fn(),
  };

  /* Builds an app wired like production routing, with fresh rate-limit counters */
  const buildApp = async (): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([QUESTION_RATE_LIMIT])],
      controllers: [ChatController],
      providers: [
        ChatTurnService,
        { provide: ConversationService, useValue: fakeConversations },
        { provide: LLM_CLIENT, useValue: fakeLlm },
        {
          provide: EMBEDDING_PROVIDER_TOKEN,
          useValue: {
            embed: async () => [[0.1, 0.2]],
            getModelName: () => 'nomic-embed-text',
          },
        },
        {
          provide: VectorStoreService,
          useValue: {
            searchHybrid: async () => [
              {
                chunkId: 'chunk-1',
                documentId: 'doc-1',
                documentVersion: 1,
                documentTitle: 'Deployment Guide',
                sourceType: 'text',
                content: 'Redeploy the previous release tag.',
                sectionHeaders: ['Deployment Guide'],
                cosineSimilarity: 0.9,
                vectorRank: 1,
                keywordRank: 1,
                rrfScore: 0.03,
              },
            ],
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            retrieval: {
              minSimilarity: 0.65,
              candidateK: 20,
              maxSources: 5,
              maxSourcesPerDocument: 2,
              contextTokenBudget: 2500,
            },
          },
        },
      ],
    }).compile();

    /* Mirrors main.ts routing so paths match production */
    const built = moduleRef.createNestApplication();
    built.setGlobalPrefix('api');
    built.enableVersioning({ type: VersioningType.URI });
    built.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await built.init();
    await built.listen(0);
    return built;
  };

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    fakeLlm.streamChat.mockImplementation(streamCanned);
  });

  it('lists conversations', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/chat')
      .expect(200)
      .expect([summary]);
  });

  it('returns one conversation and 404 for an unknown id', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/chat/${KNOWN_ID}`)
      .expect(200)
      .expect(conversation);
    await request(app.getHttpServer())
      .get(`/api/v1/chat/${UNKNOWN_ID}`)
      .expect(404);
  });

  it('rejects a malformed conversation id with 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/chat/not-a-uuid')
      .expect(400);
  });

  it('deletes a conversation with 204 and returns 404 for an unknown id', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/chat/${KNOWN_ID}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/chat/${UNKNOWN_ID}`)
      .expect(404);
  });

  it('rejects an empty or oversized question with 400 before storing anything', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/chat')
      .send({ message: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/chat')
      .send({ message: 'x'.repeat(2001) })
      .expect(400);
    expect(fakeConversations.beginTurn).not.toHaveBeenCalled();
  });

  it('returns 404 as JSON, without opening a stream, for a follow-up to an unknown conversation', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/chat/${UNKNOWN_ID}`)
      .send({ message: 'Still there?' })
      .expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('streams meta, tokens and done as server-sent events, storing the answer before done', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat')
      .send({ message: '  How do I roll back?  ' })
      .buffer(true)
      .parse(parseSse)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache');
    const events = res.body as ChatStreamEvent[];
    expect(events[0]).toEqual({
      type: 'meta',
      conversationId: KNOWN_ID,
      userMessageId: 'user-message-1',
      assistantMessageId: expect.any(String),
      traceId: expect.any(String),
      conversationTitle: 'How do I roll back?',
    });
    expect(
      events
        .slice(1, -1)
        .every((e) => ['token', 'stage', 'sources'].includes(e.type)),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', outcome: 'answered' });
    expect(fakeConversations.beginTurn).toHaveBeenCalledWith(
      null,
      'How do I roll back?',
    );
    expect(fakeConversations.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: (events[0] as { assistantMessageId: string }).assistantMessageId,
        status: 'completed',
      }),
    );
    expect(calls).toEqual(['beginTurn', 'saveAnswer']);
  });

  it('stops generation and stores the partial answer as stopped when the client disconnects', async () => {
    let generationAborted = false;
    fakeLlm.streamChat.mockImplementationOnce(
      (_messages, { onToken, signal }) =>
        new Promise((_resolve, reject) => {
          onToken('Partial ');
          signal?.addEventListener('abort', () => {
            generationAborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const { port } = app.getHttpServer().address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          port,
          path: '/api/v1/chat',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (chunk.includes('"type":"token"')) {
              req.destroy();
              resolve();
            }
          });
        },
      );
      req.on('error', () => undefined);
      req.end(JSON.stringify({ message: 'Tell me everything' }));
      setTimeout(() => reject(new Error('no token received')), 3000);
    });

    await waitFor(() => fakeConversations.saveAnswer.mock.calls.length === 1);
    expect(generationAborted).toBe(true);
    expect(fakeConversations.saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'stopped', content: 'Partial ' }),
    );
  });

  it('limits questions to 20 per minute per client while history routes stay available', async () => {
    const limited = await buildApp();
    try {
      for (let i = 0; i < 20; i++) {
        await request(limited.getHttpServer())
          .post('/api/v1/chat')
          .send({ message: `question ${i}` })
          .expect(200);
      }
      await request(limited.getHttpServer())
        .post('/api/v1/chat')
        .send({ message: 'one too many' })
        .expect(429);
      await request(limited.getHttpServer())
        .post(`/api/v1/chat/${KNOWN_ID}`)
        .send({ message: 'follow-up' })
        .expect(429);
      await request(limited.getHttpServer()).get('/api/v1/chat').expect(200);
      await request(limited.getHttpServer())
        .get(`/api/v1/chat/${KNOWN_ID}`)
        .expect(200);
    } finally {
      await limited.close();
    }
  });
});

/* Polls until the condition holds or one second passes */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!condition()) throw new Error('condition not met within 1s');
}
