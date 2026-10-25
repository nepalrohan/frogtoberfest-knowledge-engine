import type { EmbeddingInputType } from './embedding.interface';

/* Task prefixes that asymmetric retrieval models were trained with; matched on model name */
const TASK_PREFIXES: { pattern: RegExp; query: string; document: string }[] = [
  { pattern: /nomic-embed/i, query: 'search_query: ', document: 'search_document: ' },
  {
    pattern: /bge-(small|base|large)-en/i,
    query: 'Represent this sentence for searching relevant passages: ',
    document: '',
  },
];

/* Prepends the model's task prefix; models without a known prefix receive text unchanged */
export function applyTaskPrefix(model: string, inputType: EmbeddingInputType, texts: string[]): string[] {
  const rule = TASK_PREFIXES.find((r) => r.pattern.test(model));
  const prefix = rule ? rule[inputType] : '';
  return prefix ? texts.map((text) => `${prefix}${text}`) : texts;
}
