import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DataSource,
  LessThan,
  MoreThan,
  Not,
  type EntityManager,
} from 'typeorm';
import {
  Conversation,
  ConversationMessage,
  type MessageStatus,
} from '../../entities';
import type {
  AnswerOutcome,
  ChatMessageView,
  ChatSource,
  ConversationSummaryView,
  ConversationView,
  RefusalReason,
  RunDetails,
} from './chat.types';

const TITLE_MAX_LENGTH = 60;
const PREVIEW_MAX_LENGTH = 90;
/* Bounded conversational context; every question still retrieves fresh evidence */
const HISTORY_WINDOW = 6;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantAnswer {
  id: string;
  conversationId: string;
  content: string;
  status: MessageStatus;
  outcome?: AnswerOutcome;
  refusalReason?: RefusalReason;
  sources: ChatSource[];
  run?: RunDetails;
  answerCacheKey?: string;
}

/* A stored answer that may be reused for an identical standalone question */
export interface CachedAnswer {
  messageId: string;
  content: string;
  sources: ChatSource[];
  run: RunDetails;
}

export interface BegunTurn {
  conversation: Conversation;
  userMessage: ConversationMessage;
  /* Last completed messages before this question, oldest first */
  history: HistoryMessage[];
}

/* Persists conversations and their messages */
@Injectable()
export class ConversationService {
  constructor(private readonly dataSource: DataSource) {}

  /*
   * Stores the question before any answering work, creating the conversation on the first question.
   * A retry of the conversation's latest, unanswered question reuses it (dropping any stopped answer to it).
   */
  async beginTurn(
    conversationId: string | null,
    question: string,
    retryOfMessageId?: string,
  ): Promise<BegunTurn> {
    return this.dataSource.transaction(async (manager) => {
      const conversations = manager.getRepository(Conversation);
      const conversation = conversationId
        ? await conversations.findOneBy({ id: conversationId })
        : await conversations.save(
            conversations.create({
              title: question.trim().slice(0, TITLE_MAX_LENGTH),
            }),
          );
      if (!conversation) {
        throw new NotFoundException(`Conversation ${conversationId} not found`);
      }

      const retried =
        conversationId && retryOfMessageId
          ? await this.unansweredQuestion(manager, conversation.id, retryOfMessageId)
          : null;
      if (retried) {
        await manager.getRepository(ConversationMessage).delete({
          conversationId: conversation.id,
          role: 'assistant',
          status: 'stopped',
          createdAt: MoreThan(retried.createdAt),
        });
        await conversations.update(conversation.id, { updatedAt: new Date() });
        return {
          conversation,
          userMessage: retried,
          history: await this.historyBefore(manager, conversation.id, retried.createdAt),
        };
      }

      const history = await this.historyBefore(manager, conversation.id);
      const userMessage = await manager
        .getRepository(ConversationMessage)
        .save({
          conversationId: conversation.id,
          role: 'user',
          content: question,
          status: 'completed',
        });
      if (conversationId) {
        await conversations.update(conversation.id, { updatedAt: new Date() });
      }
      return { conversation, userMessage, history };
    });
  }

  /* Last completed messages (optionally before a point in time), oldest first */
  private async historyBefore(
    manager: EntityManager,
    conversationId: string,
    before?: Date,
  ): Promise<HistoryMessage[]> {
    const recent = await manager.getRepository(ConversationMessage).find({
      select: { role: true, content: true },
      where: {
        conversationId,
        status: 'completed',
        ...(before ? { createdAt: LessThan(before) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: HISTORY_WINDOW,
    });
    return recent.reverse().map(({ role, content }) => ({ role, content }));
  }

  /* The given question if it is the conversation's last message, or followed only by stopped answers */
  private async unansweredQuestion(
    manager: EntityManager,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationMessage | null> {
    const messages = manager.getRepository(ConversationMessage);
    const question = await messages.findOneBy({
      id: messageId,
      conversationId,
      role: 'user',
    });
    if (!question) return null;
    const later = await messages.find({
      select: { role: true, status: true },
      /* Dates lose Postgres' microseconds, so the question itself also compares as later */
      where: {
        conversationId,
        id: Not(question.id),
        createdAt: MoreThan(question.createdAt),
      },
    });
    const unanswered = later.every(
      (m) => m.role === 'assistant' && m.status === 'stopped',
    );
    return unanswered ? question : null;
  }

  /*
   * Latest reusable answer for this key, if younger than maxAgeSeconds and every document it cites
   * is still live, indexed and at the cited version.
   */
  async findCachedAnswer(
    answerCacheKey: string,
    maxAgeSeconds: number,
  ): Promise<CachedAnswer | null> {
    const message = await this.dataSource
      .getRepository(ConversationMessage)
      .findOne({
        where: {
          answerCacheKey,
          createdAt: MoreThan(new Date(Date.now() - maxAgeSeconds * 1000)),
        },
        order: { createdAt: 'DESC' },
      });
    if (!message?.run) return null;

    const cited = message.sources.filter((s) => s.cited);
    const rows: { current: string }[] = await this.dataSource.query(
      `SELECT count(*) AS current
       FROM unnest($1::uuid[], $2::int[]) AS cited(document_id, version)
       JOIN document d ON d.id = cited.document_id AND d.version = cited.version
       WHERE d.deleted_at IS NULL AND d.sync_status = 'indexed'`,
      [cited.map((s) => s.documentId), cited.map((s) => s.documentVersion)],
    );
    if (Number(rows[0]?.current ?? 0) !== cited.length) return null;
    return {
      messageId: message.id,
      content: message.content,
      sources: message.sources,
      run: message.run,
    };
  }

  /* Stores a finished or stopped answer and marks the conversation as recently active */
  async saveAnswer(answer: AssistantAnswer): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(ConversationMessage)
        .insert({ ...answer, role: 'assistant' });
      await manager
        .getRepository(Conversation)
        .update(answer.conversationId, { updatedAt: new Date() });
    });
  }

  /* Conversations by latest activity, each with its message count and last-message preview */
  async listConversations(): Promise<ConversationSummaryView[]> {
    const rows: {
      id: string;
      title: string;
      updated_at: Date;
      message_count: string;
      last_content: string | null;
    }[] = await this.dataSource.query(`
        SELECT c.id, c.title, c.updated_at, stats.message_count, last.content AS last_content
        FROM conversation c
        CROSS JOIN LATERAL (
          SELECT COUNT(*) AS message_count FROM conversation_message m WHERE m.conversation_id = c.id
        ) stats
        LEFT JOIN LATERAL (
          SELECT m.content FROM conversation_message m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) last ON TRUE
        ORDER BY c.updated_at DESC
      `);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      lastMessagePreview: (row.last_content ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_MAX_LENGTH),
      messageCount: Number(row.message_count),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  /* Permanently removes a conversation; its messages are removed by the ON DELETE CASCADE key */
  async deleteConversation(id: string): Promise<void> {
    const result = await this.dataSource
      .getRepository(Conversation)
      .delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
  }

  /* Full history of one conversation in chronological order */
  async getConversation(id: string): Promise<ConversationView> {
    const conversation = await this.dataSource
      .getRepository(Conversation)
      .findOneBy({ id });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    const messages = await this.dataSource
      .getRepository(ConversationMessage)
      .find({
        where: { conversationId: id },
        order: { createdAt: 'ASC' },
      });
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: messages.map(toMessageView),
    };
  }
}

/* Maps a stored message to the API shape, omitting fields that do not apply */
function toMessageView(message: ConversationMessage): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    ...(message.status === 'stopped' ? { status: 'stopped' as const } : {}),
    ...(message.outcome ? { outcome: message.outcome } : {}),
    ...(message.refusalReason ? { refusalReason: message.refusalReason } : {}),
    ...(message.role === 'assistant' ? { sources: message.sources } : {}),
    ...(message.run ? { run: message.run } : {}),
  };
}
