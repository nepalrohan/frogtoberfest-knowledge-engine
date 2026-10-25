/* Standard fallback from docs/retrieval-and-citations.md; the model is told to reply with exactly this */
export const INSUFFICIENT_EVIDENCE_TEXT =
  'I do not have sufficient information in the indexed documentation to answer this question.';

/* Refusal shown to the user: the fixed sentence plus what was checked, so they can rephrase or ingest the topic */
export function explainInsufficientEvidence(checkedTitles: string[]): string {
  if (checkedTitles.length === 0) {
    return `${INSUFFICIENT_EVIDENCE_TEXT}\n\nNo indexed document matched this question. Check that the topic has been ingested.`;
  }
  const titles = checkedTitles.map((t) => `**${t.replace(/\*/g, '')}**`).join(', ');
  return `${INSUFFICIENT_EVIDENCE_TEXT}\n\nClosest documents checked: ${titles}. They do not answer this question; try rephrasing with terms they use, or ingest a document that covers it.`;
}
