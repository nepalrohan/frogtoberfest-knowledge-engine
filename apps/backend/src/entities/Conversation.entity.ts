import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { ConversationMessage } from './ConversationMessage.entity';

/* A chat thread; single-tenant, so every conversation belongs to the local user */
@Entity('conversation')
@Index(['ownerId', 'updatedAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'owner_id',
    type: 'varchar',
    length: 128,
    default: 'local_user',
  })
  ownerId: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  title: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /* Bumped explicitly on every new message so listings sort by last activity */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => ConversationMessage, (message) => message.conversation)
  messages?: ConversationMessage[];
}
