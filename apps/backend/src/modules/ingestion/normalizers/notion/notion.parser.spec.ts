import { NotionParser } from './notion.parser';
import { NotionBlockWithChildren } from '../../types';
import blocksPage1 from '../../../../../test/fixtures/notion/blocks-page-1.json';
import blocksPage2 from '../../../../../test/fixtures/notion/blocks-page-2.json';
import nestedBlocks from '../../../../../test/fixtures/notion/nested-blocks.json';

describe('NotionParser', () => {
  let parser: NotionParser;

  beforeEach(() => {
    parser = new NotionParser();
  });

  it('should extract rich-text elements in preserved order and retain hyperlink URLs', () => {
    const paragraphBlock = blocksPage1.results.find((b) => b.id === 'block-p-002') as NotionBlockWithChildren;
    expect(paragraphBlock).toBeDefined();

    const { elements } = parser.parse([paragraphBlock]);

    expect(elements).toHaveLength(1);
    const element = elements[0];
    expect(element).toBeDefined();
    if (element && element.type === 'paragraph') {
      expect(element.text).toBe(
        'Welcome to the knowledge engine. Read the architecture docs for more details.',
      );
      expect(element.links).toEqual([
        { text: 'architecture docs', url: 'https://github.com/my-project/docs' },
      ]);
    }
  });

  it('should correctly map all 8 supported block types into provider-neutral AST', () => {
    /* Assemble tree with toggle having nested children */
    const rootBlocks: NotionBlockWithChildren[] = (blocksPage1.results as NotionBlockWithChildren[]).map(
      (block) => {
        if (block.id === 'block-toggle-007') {
          return {
            ...block,
            children: nestedBlocks.results as NotionBlockWithChildren[],
          };
        }
        return block;
      },
    );

    const { elements, diagnostics } = parser.parse(rootBlocks);

    expect(diagnostics).toHaveLength(0);
    expect(elements).toHaveLength(7);

    // 1. Heading 1
    expect(elements[0]).toEqual({
      type: 'heading',
      level: 1,
      text: 'Introduction & Architecture',
      links: [],
    });

    // 2. Paragraph
    expect(elements[1]?.type).toBe('paragraph');

    // 3. Heading 2
    expect(elements[2]).toEqual({
      type: 'heading',
      level: 2,
      text: 'Core Principles',
      links: [],
    });

    // 4. Bulleted list item (unordered)
    expect(elements[3]).toEqual({
      type: 'list_item',
      ordered: false,
      text: 'Quality over quantity',
      links: [],
    });

    // 5. Numbered list item (ordered)
    expect(elements[4]).toEqual({
      type: 'list_item',
      ordered: true,
      text: 'Step 1: Clone repo',
      links: [],
    });

    // 6. To-do (task)
    expect(elements[5]).toEqual({
      type: 'task',
      text: 'Verify local database connection',
      checked: true,
      links: [],
    });

    // 7. Toggle (container with nested children)
    const toggleContainer = elements[6];
    expect(toggleContainer?.type).toBe('container');
    if (toggleContainer && toggleContainer.type === 'container') {
      expect(toggleContainer.label).toBe('Advanced Configuration');
      expect(toggleContainer.children).toHaveLength(2);
      expect(toggleContainer.children[0]).toEqual({
        type: 'paragraph',
        text: 'These are settings inside the toggle container.',
        links: [],
      });
      expect(toggleContainer.children[1]).toEqual({
        type: 'list_item',
        ordered: false,
        text: 'Nested item 1',
        links: [],
      });
    }
  });

  it('should map heading_3 block type accurately', () => {
    const h3Block = blocksPage2.results.find((b) => b.id === 'block-h3-008') as NotionBlockWithChildren;
    const { elements } = parser.parse([h3Block]);

    expect(elements).toHaveLength(1);
    expect(elements[0]).toEqual({
      type: 'heading',
      level: 3,
      text: 'Troubleshooting Guide',
      links: [],
    });
  });

  it('should skip unsupported block types according to policy and record diagnostic warning', () => {
    const imageBlock = blocksPage2.results.find((b) => b.id === 'block-unsupported-011') as NotionBlockWithChildren;
    const { elements, diagnostics } = parser.parse([imageBlock]);

    /* Unsupported block is omitted from AST elements */
    expect(elements).toHaveLength(0);
    /* Recorded as warning diagnostic without crashing */
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'UNSUPPORTED_BLOCK_TYPE',
      level: 'warn',
      blockId: 'block-unsupported-011',
      blockType: 'image',
    });
  });

  it('should capture malformed supported block as error diagnostic without crashing', () => {
    const malformedBlock = blocksPage2.results.find((b) => b.id === 'block-malformed-012') as NotionBlockWithChildren;
    const { elements, diagnostics } = parser.parse([malformedBlock]);

    expect(elements).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'MALFORMED_BLOCK',
      level: 'error',
      blockId: 'block-malformed-012',
      blockType: 'heading_1',
    });
  });
});
