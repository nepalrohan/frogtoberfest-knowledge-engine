/* One answer-shape instruction picked from the question's wording; small models follow one specific hint better than general rules */
const HINTS: { pattern: RegExp; hint: string }[] = [
  {
    pattern: /\b(compare|comparison|vs\.?|versus|difference|differences|differ|better|pros and cons|trade-?offs?)\b/i,
    hint: 'Answer with a Markdown table: one row per option, one column per aspect, then a one-line recommendation.',
  },
  {
    pattern: /\b(how (do|can|to|should)|steps?|process|procedure|set ?up|install|configure|deploy|roll ?back|migrate)\b/i,
    hint: 'Answer as numbered steps, one action per step, with commands in fenced code blocks.',
  },
  {
    pattern: /^\s*(list|what are|which)\b/i,
    hint: 'Answer as a bulleted list, one item per line with a short explanation.',
  },
  {
    pattern: /^\s*(what is|what's|what does|explain|why|describe|tell me about)\b/i,
    hint: 'Give a one-sentence definition, then 3-5 bullet key points, then an example if the sources contain one.',
  },
];

/* Returns the first matching hint, or undefined to keep the default format rules */
export function formatHint(question: string): string | undefined {
  return HINTS.find(({ pattern }) => pattern.test(question))?.hint;
}
