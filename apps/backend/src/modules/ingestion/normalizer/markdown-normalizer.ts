import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

export interface NormalizerOptions {
  title: string;
  sourceType: string;
  sourceId: string;
  sourceUrl?: string;
  sourceUpdatedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface NormalizedResult {
  normalizedContent: string;
  contentHash: string;
  title: string;
  metadata: Record<string, unknown>;
}

/* Normalizes raw content into standardized GitHub Flavored Markdown with frontmatter and SHA-256 hash */
@Injectable()
export class MarkdownNormalizer {
  /* Cleans markdown, ensures single newline spacing, injects frontmatter, and computes hash */
  normalize(rawContent: string, options: NormalizerOptions): NormalizedResult {
    const cleanedBody = this.cleanMarkdown(rawContent);

    const frontmatterLines = [
      '---',
      `title: ${JSON.stringify(options.title)}`,
      `source: ${JSON.stringify(options.sourceType)}`,
      `source_id: ${JSON.stringify(options.sourceId)}`,
    ];

    if (options.sourceUrl) {
      frontmatterLines.push(`source_url: ${JSON.stringify(options.sourceUrl)}`);
    }

    if (options.sourceUpdatedAt) {
      frontmatterLines.push(`updated_at: ${JSON.stringify(options.sourceUpdatedAt.toISOString())}`);
    }

    if (options.metadata && Object.keys(options.metadata).length > 0) {
      for (const [key, val] of Object.entries(options.metadata)) {
        frontmatterLines.push(`${key}: ${JSON.stringify(val)}`);
      }
    }

    frontmatterLines.push('---', '');

    const fullNormalized = `${frontmatterLines.join('\n')}\n# ${options.title}\n\n${cleanedBody}`.trim();

    /* Deterministic SHA-256 hash derived strictly from title and normalized body */
    const contentHash = crypto
      .createHash('sha256')
      .update(`${options.title}\n${cleanedBody}`)
      .digest('hex');

    return {
      normalizedContent: fullNormalized,
      contentHash,
      title: options.title,
      metadata: {
        ...options.metadata,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /* Strips trailing spaces, normalizes CRLF to LF, and collapses 3+ consecutive newlines */
  private cleanMarkdown(content: string): string {
    if (!content) return '';

    return content
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
