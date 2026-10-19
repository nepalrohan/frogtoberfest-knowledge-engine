import {
  Controller,
  Post,
  Get,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import 'multer';
import { IngestionService } from './ingestion.service';
import { FeedKnowledgeDto } from './dto/feed-knowledge.dto';
import { IngestResponseDto } from './dto/ingest-response.dto';
import { DocumentSummaryDto } from './dto/document-summary.dto';
import {
  FILE_STORAGE_TOKEN,
  type IFileStorage,
} from '../storage/storage.interface';

/* Controller exposing HTTP entry points for document ingestion */
@Controller({ version: '1' })
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    @Inject(FILE_STORAGE_TOKEN)
    private readonly fileStorage: IFileStorage,
  ) {}

  /* Recent documents with their indexing status for the ingestion feed */
  @Get('documents')
  async listDocuments(): Promise<DocumentSummaryDto[]> {
    return this.ingestionService.listRecentDocuments(50);
  }

  /* Ingests a single uploaded file (.md, .txt, .pdf) */
  @Post(['upload', 'ingestion/upload'])
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingleDoc(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<IngestResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required for upload');
    }

    const storedMeta = await this.fileStorage.saveBuffer(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    const rawContent = file.buffer.toString('utf-8');
    const title = file.originalname.replace(/\.[^/.]+$/, '');

    return await this.ingestionService.ingestDocument({
      sourceType: 'upload',
      sourceId: storedMeta.filename,
      title,
      rawContent,
      metadata: {
        originalName: storedMeta.originalName,
        mimeType: storedMeta.mimeType,
        sizeBytes: storedMeta.sizeBytes,
      },
    });
  }

  /* Feeds textual knowledge or engineering decisions in structured JSON format */
  @Post(['feed-knowledge', 'ingestion/feed-knowledge'])
  async feedKnowledge(
    @Body() dto: FeedKnowledgeDto,
  ): Promise<IngestResponseDto> {
    const sourceId =
      dto.sourceId ||
      `text-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    return await this.ingestionService.ingestDocument({
      sourceType: 'text',
      sourceId,
      sourceUrl: dto.sourceUrl,
      title: dto.title,
      rawContent: dto.content,
      metadata: dto.metadata,
    });
  }
}
