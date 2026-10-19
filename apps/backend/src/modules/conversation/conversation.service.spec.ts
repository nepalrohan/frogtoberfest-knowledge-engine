import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConversationService } from './conversation.service';
import type { ChatSource, RunDetails } from './chat.types';
import {
  describeWithDatabase,
  openTestDataSource,
  truncate,
} from '../../../test/support/test-database';

describeWithDatabase('ConversationService (real Postgres)', () => {
  let dataSource: DataSource;
  let service: ConversationService;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    service = new ConversationService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  const source = (index: number, cited: boolean): ChatSource => ({
    index,
    chunkId: `00000000-0000-0000-0000-00000000000${index}`,
    documentId: '10000000-0000-0000-0000-000000000001',
    documentVersion: 3,
    documentTitle: 'Deployment Guide',
    sourceType: 'confluence',
    sourceUrl: 'https://confluence.example.com/deploy',
    sectionHeaders: ['Deployment Guide', 'Rollbacks'],
    snippet: `snippet ${index}`,
    score: 0.81,
    cited,
  });

  const run: RunDetails = {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    model: 'qwen2.5:7b-instruct',
    embeddingModel: 'nomic-embed-text',
    candidatesRetrieved: 24,
    contextTokens: 300,
    promptTokens: 700,
    completionTokens: 80,
    totalLatencyMs: 2100,
    stages: [{ stage: 'retrieve', durationMs: 40 }],
  };

  beforeEach(async () => {
    await truncate(dataSource, ['conversation', 'conversation_message']);
  });

  it('starts a conversation titled from the first question and stores the question', async () => {
    const turn = await service.beginTurn(
      null,
      'How do I roll back a bad deploy?',
    );

    const conversation = await service.getConversation(turn.conversation.id);
    expect(conversation.title).toBe('How do I roll back a bad deploy?');
    expect(conversation.messages).toEqual([
      expect.objectContaining({
        id: turn.userMessage.id,
        role: 'user',
        content: 'How do I roll back a bad deploy?',
      }),
    ]);
  });

  it('replays a stored answer with its outcome, sources and run details after the question', async () => {
    const turn = await service.beginTurn(null, 'How do I roll back?');
    await service.saveAnswer({
      id: '20000000-0000-0000-0000-000000000001',
      conversationId: turn.conversation.id,
      content: 'Redeploy the previous tag [Source 1].',
      status: 'completed',
      outcome: 'answered',
      sources: [source(1, true), source(2, false)],
      run,
    });

    const conversation = await service.getConversation(turn.conversation.id);
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(conversation.messages[1]).toEqual({
      id: '20000000-0000-0000-0000-000000000001',
      role: 'assistant',
      content: 'Redeploy the previous tag [Source 1].',
      createdAt: expect.any(String),
      outcome: 'answered',
      sources: [source(1, true), source(2, false)],
      run,
    });
  });

  it('lists conversations by latest activity with a collapsed, truncated preview', async () => {
    const older = await service.beginTurn(null, 'Older question');
    const newer = await service.beginTurn(null, 'Newer question');
    const longAnswer = `Line one\n\n   ${'word '.repeat(40)}`;
    await service.saveAnswer({
      id: '20000000-0000-0000-0000-000000000002',
      conversationId: older.conversation.id,
      content: longAnswer,
      status: 'completed',
      outcome: 'answered',
      sources: [],
      run,
    });

    const list = await service.listConversations();

    expect(list.map((c) => c.id)).toEqual([
      older.conversation.id,
      newer.conversation.id,
    ]);
    expect(list[0]).toEqual({
      id: older.conversation.id,
      title: 'Older question',
      lastMessagePreview: `Line one ${'word '.repeat(40)}`.slice(0, 90),
      messageCount: 2,
      updatedAt: expect.any(String),
    });
    expect(list[1]?.lastMessagePreview).toBe('Newer question');
  });

  it('moves a conversation to the top of the list when a follow-up is asked', async () => {
    const first = await service.beginTurn(null, 'First conversation');
    await service.beginTurn(null, 'Second conversation');

    await service.beginTurn(first.conversation.id, 'A follow-up');

    const list = await service.listConversations();
    expect(list[0]?.id).toBe(first.conversation.id);
    expect(list[0]?.lastMessagePreview).toBe('A follow-up');
  });

  it('returns the last 6 completed messages before the question as context, skipping stopped answers', async () => {
    const first = await service.beginTurn(null, 'Q1');
    const id = first.conversation.id;
    const answer = async (n: number, status: 'completed' | 'stopped') =>
      service.saveAnswer({
        id: `30000000-0000-0000-0000-00000000000${n}`,
        conversationId: id,
        content: `A${n}`,
        status,
        outcome: status === 'completed' ? 'answered' : undefined,
        sources: [],
      });
    await answer(1, 'completed');
    for (const n of [2, 3, 4]) {
      await service.beginTurn(id, `Q${n}`);
      await answer(n, n === 4 ? 'stopped' : 'completed');
    }

    const turn = await service.beginTurn(id, 'Q5');

    expect(turn.history).toEqual([
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'Q3' },
      { role: 'assistant', content: 'A3' },
      { role: 'user', content: 'Q4' },
    ]);
  });

  it('deletes a conversation with its messages so later fetches are not found', async () => {
    const kept = await service.beginTurn(null, 'Keep me');
    const doomed = await service.beginTurn(null, 'Delete me');

    await service.deleteConversation(doomed.conversation.id);

    expect((await service.listConversations()).map((c) => c.id)).toEqual([
      kept.conversation.id,
    ]);
    await expect(
      service.getConversation(doomed.conversation.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.deleteConversation(doomed.conversation.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a follow-up to an unknown conversation without storing anything', async () => {
    await expect(
      service.beginTurn('99999999-9999-9999-9999-999999999999', 'Hello?'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.listConversations()).toEqual([]);
  });

  it('truncates a long first question to a 60-character title', async () => {
    const question = 'x'.repeat(200);
    const turn = await service.beginTurn(null, question);
    expect((await service.getConversation(turn.conversation.id)).title).toBe(
      'x'.repeat(60),
    );
  });

  it('marks a stopped answer as stopped when the conversation is fetched', async () => {
    const turn = await service.beginTurn(null, 'Tell me a long story');
    await service.saveAnswer({
      id: '20000000-0000-0000-0000-000000000009',
      conversationId: turn.conversation.id,
      content: 'Once upon',
      status: 'stopped',
      sources: [],
    });

    const [question, answer] = (
      await service.getConversation(turn.conversation.id)
    ).messages;
    expect(question).not.toHaveProperty('status');
    expect(answer).toMatchObject({ content: 'Once upon', status: 'stopped' });
  });
});
