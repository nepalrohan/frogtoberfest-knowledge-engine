import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/* Mirrors the web composer limit; validated before any stream opens or anything is stored */
export const MAX_QUESTION_LENGTH = 2000;

export class SendMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_QUESTION_LENGTH)
  message: string;

  /* Retrying a question that got no answer reuses it rather than storing it twice */
  @IsOptional()
  @IsUUID()
  retryOfMessageId?: string;
}
