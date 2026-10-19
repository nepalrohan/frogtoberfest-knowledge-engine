import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
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

  /* Stores the question before any answering work, creating the conversation on the first question */
  async beginTurn(
    conversationId: string | null,
    question: string,
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

      const recent = await manager.getRepository(ConversationMessage).find({
        select: { role: true, content: true },
        where: { conversationId: conversation.id, status: 'completed' },
        order: { createdAt: 'DESC' },
        take: HISTORY_WINDOW,
      });
      const history = recent
        .reverse()
        .map(({ role, content }) => ({ role, content }));

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
