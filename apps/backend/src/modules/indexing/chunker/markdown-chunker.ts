import { Injectable } from '@nestjs/common';
import {
  IChunker,
  ChunkOptions,
  DocumentChunkResult,
  ChunkMetadata,
} from './chunker.interface';
import { TokenCounter } from './token-counter';

/* Default chunking parameters based on architecture specs */
const DEFAULT_MAX_CHUNK_SIZE = 800; // ~200 tokens
const DEFAULT_CHUNK_OVERLAP = 100; // ~12.5% overlap
const DEFAULT_MIN_CHUNK_SIZE = 50;

interface SectionBlock {
  headers: string[];
  content: string;
}

/* Header-aware markdown chunking engine preserving code blocks and section context */
@Injectable()
export class MarkdownChunker implements IChunker {
  /* Chunks normalized markdown into semantic chunks with hierarchy metadata */
  chunk(content: string, options?: ChunkOptions): DocumentChunkResult[] {
    if (!content || content.trim().length === 0) {
      return [];
    }

    const maxChunkSize = options?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
    const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    const minChunkSize = options?.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;

    /* 1. Parse markdown into sections grouped by header hierarchy */
    const sections = this.parseSections(content);
    const results: DocumentChunkResult[] = [];
    let chunkIndex = 0;

    /* 2. Process each section independently to keep section headers aligned */
    for (const section of sections) {
      const sectionChunks = this.chunkSection(
        section,
        maxChunkSize,
        chunkOverlap,
        minChunkSize,
      );

      for (const sc of sectionChunks) {
        const tokenCount = TokenCounter.countTokens(sc.content);
        const metadata: ChunkMetadata = {
          sectionHeaders: section.headers,
          sectionTitle: section.headers[section.headers.length - 1] || 'Overview',
          tokenCount,
        };

        results.push({
          content: sc.content,
          chunkIndex,
          tokenCount,
          metadata,
        });
        chunkIndex++;
      }
    }

    return results;
  }

  /* Parses markdown document into sections preserving header hierarchy breadcrumbs */
  private parseSections(content: string): SectionBlock[] {
    const lines = content.split('\n');
    const sections: SectionBlock[] = [];
    const headerStack: { level: number; text: string }[] = [];
    let currentLines: string[] = [];
    let inCodeBlock = false;

    const flushCurrent = () => {
      const text = currentLines.join('\n').trim();
      if (text.length > 0) {
        sections.push({
          headers: headerStack.map((h) => h.text),
          content: text,
        });
      }
      currentLines = [];
    };

    for (const line of lines) {
      /* Detect code fences to prevent interpreting markdown headers inside code */
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        currentLines.push(line);
        continue;
      }

      if (!inCodeBlock) {
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch && headerMatch[1] && headerMatch[2]) {
          flushCurrent();
          const level = headerMatch[1].length;
          const headerText = headerMatch[2].trim();

          /* Pop deeper or equal level headers from the stack */
          while (
            headerStack.length > 0 &&
            (headerStack[headerStack.length - 1]?.level ?? 0) >= level
          ) {
            headerStack.pop();
          }
          headerStack.push({ level, text: headerText });
          currentLines.push(line);
          continue;
        }
      }

      currentLines.push(line);
    }

    flushCurrent();
    return sections;
  }

  /* Chunks an individual section into bounded pieces with overlap */
  private chunkSection(
    section: SectionBlock,
    maxChunkSize: number,
    chunkOverlap: number,
    minChunkSize: number,
  ): { content: string }[] {
    const text = section.content;
    if (text.length <= maxChunkSize) {
      return [{ content: text }];
    }

    /* Split section text into indivisible blocks (paragraphs and intact code blocks) */
    const blocks = this.splitIntoAtomicBlocks(text);
    const chunks: { content: string }[] = [];
    let currentBuffer = '';

    for (const block of blocks) {
      /* If adding block exceeds maxChunkSize, flush buffer */
      if (currentBuffer.length + block.length + 1 > maxChunkSize) {
        if (currentBuffer.length >= minChunkSize) {
          chunks.push({ content: currentBuffer.trim() });
          /* Calculate overlap from the end of the current buffer */
          const overlapSlice = currentBuffer.slice(-chunkOverlap).trim();
          currentBuffer = overlapSlice ? `${overlapSlice}\n\n${block}` : block;
        } else {
          currentBuffer = currentBuffer ? `${currentBuffer}\n\n${block}` : block;
        }
      } else {
        currentBuffer = currentBuffer ? `${currentBuffer}\n\n${block}` : block;
      }

      /* If a single block alone is larger than maxChunkSize, split it by sentences/lines */
      if (currentBuffer.length > maxChunkSize) {
        const subChunks = this.splitOversizedBlock(currentBuffer, maxChunkSize, chunkOverlap);
        for (let i = 0; i < subChunks.length - 1; i++) {
          const item = subChunks[i];
          if (item) {
            chunks.push({ content: item.trim() });
          }
        }
        currentBuffer = subChunks[subChunks.length - 1] || '';
      }
    }

    if (currentBuffer.trim().length >= minChunkSize || chunks.length === 0) {
      chunks.push({ content: currentBuffer.trim() });
    }

    return chunks;
  }

  /* Splits text into paragraphs while preserving fenced code blocks intact */
  private splitIntoAtomicBlocks(text: string): string[] {
    const blocks: string[] = [];
    const lines = text.split('\n');
    let buffer: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        buffer.push(line);
        if (!inCodeBlock) {
          /* Closed code block; flush buffer as complete atomic block */
          blocks.push(buffer.join('\n'));
          buffer = [];
        }
        continue;
      }

      if (inCodeBlock) {
        buffer.push(line);
        continue;
      }

      if (line.trim() === '') {
        if (buffer.length > 0) {
          blocks.push(buffer.join('\n'));
          buffer = [];
        }
      } else {
        buffer.push(line);
      }
    }

    if (buffer.length > 0) {
      blocks.push(buffer.join('\n'));
    }

    return blocks.filter((b) => b.trim().length > 0);
  }

  /* Splits an oversized block by sentence or line boundaries */
  private splitOversizedBlock(text: string, maxChunkSize: number, chunkOverlap: number): string[] {
    const pieces: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChunkSize;
      if (end >= text.length) {
        pieces.push(text.slice(start));
        break;
      }

      /* Find nearest sentence or line boundary before the limit */
      const slice = text.slice(start, end);
      const boundaryIndex = Math.max(
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('! '),
      );

      if (boundaryIndex > maxChunkSize * 0.4) {
        end = start + boundaryIndex + 1;
      }

      pieces.push(text.slice(start, end).trim());
      start = end - chunkOverlap;
      if (start <= 0 || start >= end) {
        start = end;
      }
    }

    return pieces;
  }
}
