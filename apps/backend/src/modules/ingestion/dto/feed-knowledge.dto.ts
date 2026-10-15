import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/* DTO for feeding structured textual knowledge or engineering decisions */
export class FeedKnowledgeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  sourceId?: string;

  @IsString()
  @IsOptional()
  sourceUrl?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
