import { verifyCitations } from './citation-verifier';
import { INSUFFICIENT_EVIDENCE_TEXT } from './answer-text';
import type { ChatSource } from '../chat.types';

const source = (index: number): ChatSource => ({
  index,
  chunkId: `c${index}`,
  documentId: `d${index}`,
  documentVersion: 1,
  documentTitle: `Doc ${index}`,
  sourceType: 'text',
  sectionHeaders: [],
  snippet: `Redeploy the previous release tag to roll back; freeze deploys first. (${index})`,
  score: 0.8,
  cited: false,
});

const sources = [source(1), source(2), source(3)];

describe('verifyCitations', () => {
  it('removes citations to sources that were not provided and marks the valid ones cited', () => {
    const result = verifyCitations(
      'Redeploy the tag [Source 1]. Freeze deploys [Source 7] first [Source 1].',
      sources,
    );

    expect(result).toEqual({
      outcome: 'answered',
      content: 'Redeploy the tag [Source 1]. Freeze deploys first [Source 1].',
      sources: [
        { ...source(1), cited: true },
        { ...source(2), cited: false },
        { ...source(3), cited: false },
      ],
      unsupportedCitations: 0,
    });
  });

  it('keeps the answer but flags it when it cites no provided source', () => {
    const result = verifyCitations(
      'Just redeploy the previous tag [Source 9].',
      sources,
    );

    expect(result).toEqual({
      outcome: 'answered',
      content: 'Just redeploy the previous tag.',
      sources,
      unsupportedCitations: 0,
      citationsUnverified: true,
    });
  });

  it.each([
    INSUFFICIENT_EVIDENCE_TEXT,
    'Sorry, I do not have sufficient information in the indexed documentation to answer this question.',
    'The rollback flag is not mentioned in the context [Source 1].',
  ])(
    'records a model-declared lack of evidence as an insufficient-evidence refusal: %s',
    (answer) => {
      expect(verifyCitations(answer, sources)).toEqual({
        outcome: 'refused',
        refusalReason: 'insufficient_evidence',
        content: INSUFFICIENT_EVIDENCE_TEXT,
        sources,
        unsupportedCitations: 0,
      });
    },
  );

  it.each([
    ['[Source Document 1]', 'Roll back with the previous tag [Source 1].'],
    ['[source 1]', 'Roll back with the previous tag [Source 1].'],
    ['[Source 1, 2]', 'Roll back with the previous tag [Source 1] [Source 2].'],
    [
      '[Source 1, Source 2]',
      'Roll back with the previous tag [Source 1] [Source 2].',
    ],
    [
      '[Sources 1 and 2]',
      'Roll back with the previous tag [Source 1] [Source 2].',
    ],
  ])(
    'normalizes the citation variant %s to [Source N]',
    (variant, expected) => {
      const result = verifyCitations(
        `Roll back with the previous tag ${variant}.`,
        sources,
      );
      expect(result).toMatchObject({ outcome: 'answered', content: expected });
    },
  );

  it('flags the answer as unverified when a variant names no provided source', () => {
    expect(
      verifyCitations('Roll back [Source Document 8].', sources),
    ).toMatchObject({
      outcome: 'answered',
      citationsUnverified: true,
    });
  });

  describe('claim support', () => {
    const billing: ChatSource = {
      ...source(2),
      documentTitle: 'Billing FAQ',
      snippet: 'Invoices are emailed on the first business day of each month.',
    };

    it('drops a citation whose sentence shares no content word with the cited source', () => {
      const result = verifyCitations(
        'Redeploy the previous tag [Source 1] [Source 2].',
        [source(1), billing],
      );
      expect(result).toMatchObject({
        outcome: 'answered',
        content: 'Redeploy the previous tag [Source 1].',
        unsupportedCitations: 1,
      });
      expect(result.sources.map((s) => s.cited)).toEqual([true, false]);
    });

    it('matches word forms by prefix, e.g. "redeployed" against "redeploy"', () => {
      expect(
        verifyCitations('Rolling releases are redeployed [Source 1].', sources),
      ).toMatchObject({ outcome: 'answered', unsupportedCitations: 0 });
    });

    it('judges markers written after the full stop against the sentence before them', () => {
      const result = verifyCitations(
        'Invoices are emailed monthly. [Source 2]\nRedeploy the tag. [Source 1]',
        [source(1), billing],
      );
      expect(result).toMatchObject({ unsupportedCitations: 0 });
      expect(result.sources.every((s) => s.cited)).toBe(true);
    });

    it('flags the answer as unverified when every citation is unsupported', () => {
      expect(
        verifyCitations('Kubernetes autoscaling handles load [Source 2].', [billing]),
      ).toMatchObject({
        outcome: 'answered',
        content: 'Kubernetes autoscaling handles load.',
        unsupportedCitations: 1,
        citationsUnverified: true,
      });
    });

    it('keeps citations on claims too short to judge', () => {
      expect(verifyCitations('See [Source 2].', [billing])).toMatchObject({
        outcome: 'answered',
        content: 'See [Source 2].',
      });
    });
  });
});
