import { Injectable } from '@nestjs/common';
import { StructuredLogger } from '../../../../common/logger';
import {
  DiagnosticMessage,
  NeutralElement,
  NotionBlockWithChildren,
  NotionRichText,
  TextLink,
} from '../../types';

const SUPPORTED_BLOCK_TYPES = new Set([
  'heading_1',
  'heading_2',
  'heading_3',
  'paragraph',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
]);

/* Parser transforming Notion block trees into structured provider-neutral AST elements. */
@Injectable()
export class NotionParser {
  private readonly logger = new StructuredLogger('NotionParser');

  /* Parses an array of Notion blocks into provider-neutral AST elements with diagnostics. */
  parse(blocks: NotionBlockWithChildren[]): {
    elements: NeutralElement[];
    diagnostics: DiagnosticMessage[];
  } {
    const elements: NeutralElement[] = [];
    const diagnostics: DiagnosticMessage[] = [];

    for (const block of blocks) {
      this.parseBlock(block, elements, diagnostics);
    }

    return { elements, diagnostics };
  }

  /* Parses an individual block and appends valid elements or diagnostics. */
  private parseBlock(
    block: NotionBlockWithChildren,
    elements: NeutralElement[],
    diagnostics: DiagnosticMessage[],
  ): void {
    if (!block || typeof block !== 'object') {
      return;
    }

    const type = block.type;

    /* Handle unsupported block types according to explicit skip policy */
    if (!SUPPORTED_BLOCK_TYPES.has(type)) {
      this.logger.debug(`Skipping unsupported block type ${type}`, {
        blockId: block.id,
        blockType: type,
      });

      diagnostics.push({
        code: 'UNSUPPORTED_BLOCK_TYPE',
        level: 'warn',
        message: `Unsupported Notion block type '${type}' skipped according to policy`,
        blockId: block.id,
        blockType: type,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    /* Extract block payload and check for malformed block content */
    const blockData = block[type];
    if (!blockData || typeof blockData !== 'object' || !Array.isArray(blockData.rich_text)) {
      this.logger.warn(`Encountered malformed supported block '${type}'`, {
        blockId: block.id,
        blockType: type,
      });

      diagnostics.push({
        code: 'MALFORMED_BLOCK',
        level: 'error',
        message: `Malformed Notion block of supported type '${type}' missing rich_text payload`,
        blockId: block.id,
        blockType: type,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { text, links } = this.extractRichText(blockData.rich_text);

    /* Recursively parse nested child blocks if present */
    const parsedChildren: NeutralElement[] = [];
    if (block.children && block.children.length > 0) {
      for (const child of block.children) {
        this.parseBlock(child, parsedChildren, diagnostics);
      }
    }

    /* Map supported block types to neutral AST representations */
    switch (type) {
      case 'heading_1':
        elements.push({
          type: 'heading',
          level: 1,
          text,
          links,
        });
        break;

      case 'heading_2':
        elements.push({
          type: 'heading',
          level: 2,
          text,
          links,
        });
        break;

      case 'heading_3':
        elements.push({
          type: 'heading',
          level: 3,
          text,
          links,
        });
        break;

      case 'paragraph':
        elements.push({
          type: 'paragraph',
          text,
          links,
        });
        break;

      case 'bulleted_list_item':
        elements.push({
          type: 'list_item',
          ordered: false,
          text,
          links,
          ...(parsedChildren.length > 0 ? { children: parsedChildren } : {}),
        });
        break;

      case 'numbered_list_item':
        elements.push({
          type: 'list_item',
          ordered: true,
          text,
          links,
          ...(parsedChildren.length > 0 ? { children: parsedChildren } : {}),
        });
        break;

      case 'to_do':
        elements.push({
          type: 'task',
          text,
          checked: Boolean(blockData.checked),
          links,
          ...(parsedChildren.length > 0 ? { children: parsedChildren } : {}),
        });
        break;

      case 'toggle':
        elements.push({
          type: 'container',
          label: text,
          children: parsedChildren,
          links,
        });
        break;
    }
  }

  /* Extracts plain text and hyperlink elements from Notion rich-text preserving sequential order. */
  private extractRichText(richTextArray: NotionRichText[]): {
    text: string;
    links: TextLink[];
  } {
    let text = '';
    const links: TextLink[] = [];

    for (const item of richTextArray) {
      const content = item.plain_text || item.text?.content || '';
      text += content;

      const url = item.href || item.text?.link?.url;
      if (url && content) {
        links.push({
          text: content,
          url,
        });
      }
    }

    return { text, links };
  }
}
