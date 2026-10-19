import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './Conversation.entity';
import type {
  AnswerOutcome,
  ChatSource,
  RefusalReason,
  RunDetails,
} from '../modules/conversation/chat.types';

/* completed = usable as history; stopped = interrupted by the client, kept for display only */
export type MessageStatus = 'completed' | 'stopped';

/* One user question or assistant answer, with the evidence and diagnostics behind each answer */
@Entity('conversation_message')
@Index(['conversationId', 'createdAt'])
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'role', type: 'varchar', length: 16 })
  role: 'user' | 'assistant';

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'completed' })
  status: MessageStatus;

  @Column({ name: 'outcome', type: 'varchar', length: 16, nullable: true })
  outcome?: AnswerOutcome | null;

  @Column({
    name: 'refusal_reason',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  refusalReason?: RefusalReason | null;

  /* Every context source sent to the model, each flagged as cited or not */
  @Column({ name: 'sources', type: 'jsonb', default: () => "'[]'" })
  sources: ChatSource[];

  @Column({ name: 'run', type: 'jsonb', nullable: true })
  run?: RunDetails | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;
}
