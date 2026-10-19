/* Standard fallback from docs/retrieval-and-citations.md; the model is told to reply with exactly this */
export const INSUFFICIENT_EVIDENCE_TEXT =
  'I do not have sufficient information in the indexed documentation to answer this question.';

/* Shown instead of an answer whose citations do not point at any provided source */
export const UNVERIFIABLE_CITATIONS_TEXT =
  "I drafted an answer but couldn't verify its citations against the retrieved documents, so I'm not showing it.";
