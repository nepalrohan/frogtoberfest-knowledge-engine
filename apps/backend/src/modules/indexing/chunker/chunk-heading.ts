/* "Doc title › Section › Subsection"; sectionHeaders[0] is the document's own H1, so it is skipped */
export const chunkHeading = (
  documentTitle: string,
  sectionHeaders: string[],
): string => [documentTitle, ...sectionHeaders.slice(1)].join(' › ');

/* Chunk text with its heading path, so a passage that never names its topic still matches questions about it */
export const withChunkHeading = (
  documentTitle: string,
  sectionHeaders: string[],
  content: string,
): string => `${chunkHeading(documentTitle, sectionHeaders)}\n\n${content}`;
