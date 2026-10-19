import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { ConversationService } from './conversation.service';
import { ChatTurnService } from './chat-turn.service';
import { SendMessageDto } from './dto/send-message.dto';
import { SseStream } from './sse-stream';
import type { ConversationSummaryView, ConversationView } from './chat.types';

/* HTTP surface for chat: conversation history and streamed answers */
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly chatTurns: ChatTurnService,
  ) {}

  /* Starts a new conversation and streams the answer; rate limited per client before anything is stored */
  @Post()
  @UseGuards(ThrottlerGuard)
  askNew(@Body() dto: SendMessageDto, @Res() res: Response): Promise<void> {
    return this.ask(null, dto, res);
  }

  /* Asks a follow-up in an existing conversation and streams the answer */
  @Post(':id')
  @UseGuards(ThrottlerGuard)
  askFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.ask(id, dto, res);
  }

  @Get()
  listConversations(): Promise<ConversationSummaryView[]> {
    return this.conversations.listConversations();
  }

  @Get(':id')
  getConversation(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationView> {
    return this.conversations.getConversation(id);
  }

  @Delete(':id')
  @HttpCode(204)
  deleteConversation(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.conversations.deleteConversation(id);
  }

  /* Validation and not-found errors are thrown before the stream opens, so they stay plain HTTP errors */
  private async ask(
    conversationId: string | null,
    dto: SendMessageDto,
    res: Response,
  ): Promise<void> {
    const turn = await this.conversations.beginTurn(
      conversationId,
      dto.message,
    );
    const stream = SseStream.open(res);

    /* A response closed before we finished means the client went away */
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      await this.chatTurns.answer(turn, {
        emit: (event) => stream.send(event),
        signal: abort.signal,
      });
    } catch {
      stream.send({
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong while answering. Please try again.',
        retryable: true,
      });
    } finally {
      stream.close();
    }
  }
}
