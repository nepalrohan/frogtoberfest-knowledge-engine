import type { AnswerOutcome, ChatSource, RefusalReason } from '../chat.types';
import { INSUFFICIENT_EVIDENCE_TEXT } from './answer-text';

export interface VerifiedAnswer {
  outcome: AnswerOutcome;
  refusalReason?: RefusalReason;
  /* Text to store and show: the cleaned answer, or the refusal text */
  content: string;
  sources: ChatSource[];
  /* Citations removed because their sentence shares no content words with the cited source */
  unsupportedCitations: number;
  /* Answer shown although none of its citations could be verified; the UI warns instead of refusing */
  citationsUnverified?: boolean;
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

/* True when the text declares the sources do not answer the question */
export const declaresNoEvidence = (text: string): boolean =>
  LACK_OF_EVIDENCE.some((pattern) => pattern.test(text));

const STOPWORDS = new Set(
  'about above after again also because been before being below between both cannot could does doing down during each from further have having here into itself just more most must only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your yours'.split(
    ' ',
  ),
);
/* Crude stem: comparing word prefixes lets "rolling" support "roll" without a stemmer */
const STEM_LENGTH = 5;

/* Lower-cased, stemmed content words of a text, ignoring citation markers */
function contentTerms(text: string): Set<string> {
  const words = text
    .replace(CITATION, ' ')
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu);
  return new Set(
    (words ?? [])
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      .map((w) => w.slice(0, STEM_LENGTH)),
  );
}

/* Sentences and lines, each keeping its trailing separator so joining them restores the text */
const SEGMENT = /[^\n]*?(?:[.!?](?=\s)|\n|$)\s*/g;

/*
 * Drops citations whose claim shares no content word with the cited source: such a citation cannot be
 * support, only decoration. Markers opening a segment (written after the full stop) belong to the previous one.
 */
function dropUnsupportedCitations(
  answer: string,
  sources: ChatSource[],
): { text: string; removed: number } {
  const sourceTerms = new Map(
    sources.map((s) => [
      s.index,
      contentTerms([s.documentTitle, ...s.sectionHeaders, s.snippet].join(' ')),
    ]),
  );
  let removed = 0;
  let previousClaim = new Set<string>();
  const segments = (answer.match(SEGMENT) ?? []).map((segment) => {
    const own = contentTerms(segment);
    const claim = own.size > 0 ? own : previousClaim;
    previousClaim = claim;
    return segment.replace(CITATION, (marker, n: string) => {
      const terms = sourceTerms.get(Number(n));
      /* Unknown sources are handled by the caller; claims without content words cannot be judged */
      if (!terms || claim.size === 0) return marker;
      for (const term of claim) if (terms.has(term)) return marker;
      removed += 1;
      return '';
    });
  });
  return { text: segments.join(''), removed };
}

/* Checks [Source N] markers against the sources actually sent and decides whether the answer stands */
export function verifyCitations(
  answer: string,
  sources: ChatSource[],
): VerifiedAnswer {
  if (declaresNoEvidence(answer)) {
    return {
      outcome: 'refused',
      refusalReason: 'insufficient_evidence',
      content: INSUFFICIENT_EVIDENCE_TEXT,
      sources,
      unsupportedCitations: 0,
    };
  }

  const provided = new Set(sources.map((s) => s.index));
  const cited = new Set<number>();
  const supported = dropUnsupportedCitations(normalizeCitations(answer), sources);
  const content = supported.text
    .replace(CITATION, (marker, n: string) => {
      const index = Number(n);
      if (!provided.has(index)) return '';
      cited.add(index);
      return marker;
    })
    .trim();

  /* Retrieval already passed the relevance gate, so an uncited draft is still shown, flagged for a warning */
  if (cited.size === 0) {
    return {
      outcome: 'answered',
      content,
      sources,
      unsupportedCitations: supported.removed,
      citationsUnverified: true,
    };
  }
  return {
    outcome: 'answered',
    content,
    sources: sources.map((s) => ({ ...s, cited: cited.has(s.index) })),
    unsupportedCitations: supported.removed,
  };
}
