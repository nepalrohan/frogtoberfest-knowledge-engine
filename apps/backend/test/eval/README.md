# Retrieval & grounding evaluation

Scores the live chat pipeline on a fixed question set: whether the right document is retrieved, whether citations
point at it, and whether off-topic questions are refused.

```bash
# backend running (pnpm dev), with the answer cache off so every question runs the full pipeline
CHAT_ANSWER_CACHE_TTL_SECONDS=0 pnpm --filter @my-project/backend dev

pnpm --filter @my-project/backend test:eval                 # ingest corpus, wait for indexing, ask all questions
pnpm --filter @my-project/backend test:eval --skip-ingest --limit 3 --out /tmp/eval.json
```

- `corpus/` is ingested into the database the backend uses (titles start with `Eval ·`, sourceIds with `eval-`).
- `questions.json` holds the questions, the documents each should be answered from, refusal cases and the
  pass thresholds. The command exits with code 1 when a metric falls below its threshold.
- `EVAL_API_URL` (default `http://localhost:5000`) and `EVAL_INDEX_TIMEOUT_MS` (default 10 minutes) are configurable.

Use it to tune `RETRIEVAL_MIN_SIMILARITY`, `RETRIEVAL_MIN_KEYWORD_COVERAGE`, the reranker and the chat model: change
one setting, restart the backend, re-run, compare.
