import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation, ConversationMessage } from '../../entities';
import { IndexingModule } from '../indexing/indexing.module';
import { ChatController } from './chat.controller';
import { QUESTION_RATE_LIMIT } from './question-rate-limit';
import { ConversationService } from './conversation.service';
import { ChatTurnService } from './chat-turn.service';
import { LLM_CLIENT } from './llm/llm-client.interface';
import { OllamaLlmClient } from './llm/ollama-llm.client';
import { RERANKER } from './rerank/reranker.interface';
import { TeiRerankerClient } from './rerank/tei-reranker.client';

/* ConversationModule owns the chat API, conversation storage, and the grounded answer pipeline */
@Module({
  imports: [
    IndexingModule,
    TypeOrmModule.forFeature([Conversation, ConversationMessage]),
    ThrottlerModule.forRoot([QUESTION_RATE_LIMIT]),
  ],
  controllers: [ChatController],
  providers: [
    ConversationService,
    ChatTurnService,
    { provide: LLM_CLIENT, useClass: OllamaLlmClient },
    { provide: RERANKER, useClass: TeiRerankerClient },
  ],
})
export class ConversationModule {}
