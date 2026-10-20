/* Fast deterministic token estimation utility for markdown documents and code snippets */
export class TokenCounter {
  /* Estimates token count using word and character heuristics (~4 characters per token) */
  static countTokens(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }
    const words = text.trim().split(/\s+/).length;
    const charTokens = Math.ceil(text.length / 4);
    return Math.max(1, Math.round((words * 1.3 + charTokens) / 2));
  }
}
