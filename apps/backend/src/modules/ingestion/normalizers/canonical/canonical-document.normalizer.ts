import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { StructuredLogger } from '../../../../common/logger';
import {
  DiagnosticMessage,
  NeutralElement,
  NormalizedDocumentPayload,
  TextLink,
} from '../../types';

/* Input options for document canonicalization. */
export interface NormalizationInput {
  sourceType: 'notion' | 'confluence';
  sourceId: string;
  sourceUrl: string;
  title: string;
  elements: NeutralElement[];
  rawContent?: string;
  sourceUpdatedAt: Date;
  metadata?: {
    spaceKey?: string;
    parentHierarchy?: string[];
    author?: string;
    tags?: string[];
    isComplete?: boolean;
    diagnostics?: DiagnosticMessage[];
    [key: string]: any;
  };
}

/* Normalizer formatting neutral AST into standardized GFM Markdown and validating canonical payloads. */
@Injectable()
export class CanonicalDocumentNormalizer {
  private readonly logger = new StructuredLogger('CanonicalDocumentNormalizer');

  /* Normalizes neutral AST elements into a validated canonical document payload. */
  normalize(input: NormalizationInput): NormalizedDocumentPayload {
    this.validateInput(input);

    this.logger.debug(`Normalizing document into canonical schema`, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
    });

    const frontmatter = this.renderFrontmatter(input);
    const bodyContent = this.renderElements(input.elements);
    const normalizedContent = `${frontmatter}\n\n${bodyContent}`.trim();

    const contentHash = crypto
      .createHash('sha256')
      .update(normalizedContent)
      .digest('hex');

    return {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      title: input.title,
      rawContent: input.rawContent,
      normalizedContent,
      contentHash,
      sourceUpdatedAt: input.sourceUpdatedAt,
      metadata: {
        parentHierarchy: input.metadata?.parentHierarchy || [],
        isComplete: input.metadata?.isComplete ?? true,
        diagnostics: input.metadata?.diagnostics || [],
        ...(input.metadata),
      },
    };
  }

  /* Validates essential presence and non-emptiness of mandatory contract fields. */
  private validateInput(input: NormalizationInput): void {
    const requiredFields: (keyof NormalizationInput)[] = [
      'sourceType',
      'sourceId',
      'sourceUrl',
      'title',
      'sourceUpdatedAt',
    ];

    for (const field of requiredFields) {
      const val = input[field];
      if (val === undefined || val === null || val === '') {
        throw new Error(`Validation failed: missing required field '${field}'`);
      }
    }
  }

  /* Formats metadata frontmatter header into standardized YAML syntax. */
  private renderFrontmatter(input: NormalizationInput): string {
    const lines = [
      '---',
      `title: "${input.title.replace(/"/g, '\\"')}"`,
      `source: "${input.sourceType}"`,
      `source_url: "${input.sourceUrl}"`,
      `updated_at: "${input.sourceUpdatedAt.toISOString()}"`,
      `hierarchy: ${JSON.stringify(input.metadata?.parentHierarchy || [])}`,
      '---',
    ];

    return lines.join('\n');
  }

  /* Converts array of neutral elements into sequential GitHub Flavored Markdown blocks. */
  private renderElements(elements: NeutralElement[], indentLevel = 0): string {
    const blocks: string[] = [];

    for (const element of elements) {
      blocks.push(this.renderSingleElement(element, indentLevel));
    }

    return blocks.join('\n\n');
  }

  /* Converts a single neutral element into corresponding GFM markdown representation. */
  private renderSingleElement(element: NeutralElement, indentLevel: number): string {
    const indent = '  '.repeat(indentLevel);

    switch (element.type) {
      case 'heading': {
        const hashes = '#'.repeat(element.level);
        return `${indent}${hashes} ${this.formatLinks(element.text, element.links)}`;
      }

      case 'paragraph': {
        return `${indent}${this.formatLinks(element.text, element.links)}`;
      }

      case 'list_item': {
        const prefix = element.ordered ? '1. ' : '- ';
        let result = `${indent}${prefix}${this.formatLinks(element.text, element.links)}`;
        if (element.children && element.children.length > 0) {
          result += '\n\n' + this.renderElements(element.children, indentLevel + 1);
        }
        return result;
      }

      case 'task': {
        const check = element.checked ? '[x]' : '[ ]';
        let result = `${indent}- ${check} ${this.formatLinks(element.text, element.links)}`;
        if (element.children && element.children.length > 0) {
          result += '\n\n' + this.renderElements(element.children, indentLevel + 1);
        }
        return result;
      }

      case 'container': {
        const label = this.formatLinks(element.label, element.links);
        const childrenContent = this.renderElements(element.children, indentLevel);
        return `${indent}<details><summary>${label}</summary>\n\n${childrenContent}\n\n${indent}</details>`;
      }
    }
  }

  /* Injects markdown hyperlink syntax for text matches defined in link annotations. */
  private formatLinks(text: string, links?: TextLink[]): string {
    if (!links || links.length === 0) {
      return text;
    }

    let result = text;
    for (const link of links) {
      if (link.text && link.url && result.includes(link.text)) {
        const markdown = `[${link.text}](${link.url})`;
        result = result.replace(link.text, markdown);
      }
    }

    return result;
  }
}
