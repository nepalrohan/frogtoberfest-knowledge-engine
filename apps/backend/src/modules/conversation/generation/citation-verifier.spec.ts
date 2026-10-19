import { verifyCitations } from './citation-verifier';
import {
  INSUFFICIENT_EVIDENCE_TEXT,
  UNVERIFIABLE_CITATIONS_TEXT,
} from './answer-text';
import type { ChatSource } from '../chat.types';

const source = (index: number): ChatSource => ({
  index,
  chunkId: `c${index}`,
  documentId: `d${index}`,
  documentVersion: 1,
  documentTitle: `Doc ${index}`,
  sourceType: 'text',
  sectionHeaders: [],
  snippet: `snippet ${index}`,
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
    });
  });

  it('refuses as unverifiable when the answer cites no provided source', () => {
    const result = verifyCitations(
      'Just redeploy the previous tag [Source 9].',
      sources,
    );

    expect(result).toEqual({
      outcome: 'refused',
      refusalReason: 'unverifiable_citations',
      content: UNVERIFIABLE_CITATIONS_TEXT,
      sources,
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

  it('still refuses when a variant names no provided source', () => {
    expect(
      verifyCitations('Roll back [Source Document 8].', sources),
    ).toMatchObject({
      outcome: 'refused',
      refusalReason: 'unverifiable_citations',
    });
  });
});
