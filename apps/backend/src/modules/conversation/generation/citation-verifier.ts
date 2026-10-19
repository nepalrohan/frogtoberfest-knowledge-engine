import type { AnswerOutcome, ChatSource, RefusalReason } from '../chat.types';
import {
  INSUFFICIENT_EVIDENCE_TEXT,
  UNVERIFIABLE_CITATIONS_TEXT,
} from './answer-text';

export interface VerifiedAnswer {
  outcome: AnswerOutcome;
  refusalReason?: RefusalReason;
  /* Text to store and show: the cleaned answer, or the refusal text */
  content: string;
  sources: ChatSource[];
}

const CITATION = /\s?\[Source (\d+)\]/g;

/* Brackets made only of source/document words, numbers and separators, e.g. [Source Document 1], [Sources 1 and 2] */
const CITATION_VARIANT =
  /\[\s*sources?\b(?:\s*(?:documents?|sources?|and|&|,|;|\d+))*\s*\]/gi;

/* Small models vary the marker format; rewrite each variant into canonical [Source N] markers */
function normalizeCitations(answer: string): string {
  return answer.replace(CITATION_VARIANT, (variant) => {
    const numbers = variant.match(/\d+/g);
    return numbers ? numbers.map((n) => `[Source ${n}]`).join(' ') : variant;
  });
}

/* Phrases with which the model declares it lacks evidence (docs/retrieval-and-citations.md) */
const LACK_OF_EVIDENCE = [
  /sufficient information in the indexed documentation/i,
  /not mentioned in the context/i,
];

/* Checks [Source N] markers against the sources actually sent and decides whether the answer stands */
export function verifyCitations(
  answer: string,
  sources: ChatSource[],
): VerifiedAnswer {
  if (LACK_OF_EVIDENCE.some((pattern) => pattern.test(answer))) {
    return {
      outcome: 'refused',
      refusalReason: 'insufficient_evidence',
      content: INSUFFICIENT_EVIDENCE_TEXT,
      sources,
    };
  }

  const provided = new Set(sources.map((s) => s.index));
  const cited = new Set<number>();
  const content = normalizeCitations(answer)
    .replace(CITATION, (marker, n: string) => {
      const index = Number(n);
      if (!provided.has(index)) return '';
      cited.add(index);
      return marker;
    })
    .trim();

  if (cited.size === 0) {
    return {
      outcome: 'refused',
      refusalReason: 'unverifiable_citations',
      content: UNVERIFIABLE_CITATIONS_TEXT,
      sources,
    };
  }
  return {
    outcome: 'answered',
    content,
    sources: sources.map((s) => ({ ...s, cited: cited.has(s.index) })),
  };
}
