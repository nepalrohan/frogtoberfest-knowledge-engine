import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/* Mirrors the web composer limit; validated before any stream opens or anything is stored */
export const MAX_QUESTION_LENGTH = 2000;

export class SendMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_QUESTION_LENGTH)
  message: string;
}
