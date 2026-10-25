/*
 * Retrieval and grounding evaluation against a running backend.
 *
 *   pnpm --filter @my-project/backend test:eval [--skip-ingest] [--limit N] [--out report.json]
 *
 * Ingests the corpus in ./corpus (idempotent), waits until it is indexed, asks every question in
 * questions.json through the real chat API, and scores retrieval, citations and refusals.
 * Exits with code 1 when a metric falls below its threshold.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ChatSource, ChatStreamEvent, RunDetails } from '../../src/modules/conversation/chat.types';

interface EvalQuestion {
  question: string;
  expectDocuments?: string[];
  expectRefusal?: boolean;
  notes?: string;
}

interface EvalFile {
  thresholds: { retrievalHitRate: number; citationPrecision: number; outcomeAccuracy: number };
  corpus: { file: string; title: string }[];
  questions: EvalQuestion[];
}

interface QuestionResult {
  question: string;
  expectRefusal: boolean;
  outcome: 'answered' | 'refused' | 'error';
  outcomeCorrect: boolean;
  /* Answerable questions only: an expected document was among the sources sent to the model */
  retrievalHit?: boolean;
  /* Cited sources that come from an expected document, over all cited sources */
  citedCorrect: number;
  citedTotal: number;
  latencyMs: number;
  cached: boolean;
  error?: string;
}

const API_URL = (process.env.EVAL_API_URL ?? 'http://localhost:5000').replace(/\/$/, '');
const INDEX_TIMEOUT_MS = Number(process.env.EVAL_INDEX_TIMEOUT_MS ?? 600_000);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const evalFile = JSON.parse(readFileSync(join(__dirname, 'questions.json'), 'utf8')) as EvalFile;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/* Feeds every corpus file; a stable sourceId makes re-runs update instead of duplicating */
async function ingestCorpus(): Promise<void> {
  for (const { file, title } of evalFile.corpus) {
    const content = readFileSync(join(__dirname, 'corpus', file), 'utf8');
    await api('/api/v1/feed-knowledge', {
      method: 'POST',
      body: JSON.stringify({ title, content, sourceId: `eval-${file}` }),
    });
  }
}

async function waitUntilIndexed(): Promise<void> {
  const titles = new Set(evalFile.corpus.map((c) => c.title));
  const deadline = Date.now() + INDEX_TIMEOUT_MS;
  for (;;) {
    const docs = await api<{ title: string; syncStatus: string }[]>('/api/v1/documents');
    const pending = [...titles].filter((t) => !docs.some((d) => d.title === t && d.syncStatus === 'indexed'));
    if (pending.length === 0) return;
    if (Date.now() > deadline) throw new Error(`Not indexed in time: ${pending.join(', ')}`);
    process.stdout.write(`  waiting for indexing: ${pending.length} document(s) left\r`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/* Asks one question through the SSE endpoint and collects the events that matter for scoring */
async function ask(question: string): Promise<{ events: ChatStreamEvent[]; latencyMs: number }> {
  const startedAt = Date.now();
  const res = await fetch(`${API_URL}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message: question }),
  });
  if (!res.ok || !res.body) throw new Error(`POST /api/v1/chat -> ${res.status}`);

  const events: ChatStreamEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const data = buffer
        .slice(0, boundary)
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) events.push(JSON.parse(data) as ChatStreamEvent);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  return { events, latencyMs: Date.now() - startedAt };
}

async function evaluate(q: EvalQuestion): Promise<QuestionResult> {
  const expectRefusal = q.expectRefusal === true;
  const expected = new Set(q.expectDocuments ?? []);
  const base = { question: q.question, expectRefusal, citedCorrect: 0, citedTotal: 0, cached: false };
  try {
    const { events, latencyMs } = await ask(q.question);
    const meta = events.find((e) => e.type === 'meta');
    const sourcesEvent = events.find((e) => e.type === 'sources');
    const done = events.find((e) => e.type === 'done');
    const failure = events.find((e) => e.type === 'error');
    if (meta?.type === 'meta') {
      await api(`/api/v1/chat/${meta.conversationId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    if (done?.type !== 'done') {
      return { ...base, outcome: 'error', outcomeCorrect: false, latencyMs, error: failure?.type === 'error' ? failure.message : 'no done event' };
    }

    const sources: ChatSource[] = sourcesEvent?.type === 'sources' ? sourcesEvent.sources : [];
    const cited = sources.filter((s) => done.citedIndexes.includes(s.index));
    const run: RunDetails = done.run;
    return {
      ...base,
      outcome: done.outcome,
      outcomeCorrect: expectRefusal ? done.outcome === 'refused' : done.outcome === 'answered',
      ...(expectRefusal ? {} : { retrievalHit: sources.some((s) => expected.has(s.documentTitle)) }),
      citedCorrect: cited.filter((s) => expected.has(s.documentTitle)).length,
      citedTotal: cited.length,
      latencyMs,
      cached: Boolean(run.cachedFromMessageId),
    };
  } catch (err) {
    return { ...base, outcome: 'error', outcomeCorrect: false, latencyMs: 0, error: (err as Error).message };
  }
}

const ratio = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);
const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

async function main(): Promise<void> {
  console.log(`Evaluating against ${API_URL}`);
  if (!flag('--skip-ingest')) {
    console.log('Ingesting the evaluation corpus…');
    await ingestCorpus();
    await waitUntilIndexed();
  }

  const limit = Number(option('--limit') ?? evalFile.questions.length);
  const results: QuestionResult[] = [];
  for (const q of evalFile.questions.slice(0, limit)) {
    const result = await evaluate(q);
    results.push(result);
    const mark = result.outcomeCorrect && result.retrievalHit !== false ? 'PASS' : 'FAIL';
    console.log(
      `${mark}  ${result.outcome.padEnd(8)} ${String(result.latencyMs).padStart(6)}ms  ${q.question}` +
        (result.retrievalHit === false ? '  (expected document not retrieved)' : '') +
        (result.error ? `  (${result.error})` : ''),
    );
  }

  const answerable = results.filter((r) => !r.expectRefusal);
  const metrics = {
    retrievalHitRate: ratio(answerable.filter((r) => r.retrievalHit).length, answerable.length),
    citationPrecision: ratio(
      answerable.reduce((n, r) => n + r.citedCorrect, 0),
      answerable.reduce((n, r) => n + r.citedTotal, 0),
    ),
    outcomeAccuracy: ratio(results.filter((r) => r.outcomeCorrect).length, results.length),
    refusalAccuracy: ratio(
      results.filter((r) => r.expectRefusal && r.outcomeCorrect).length,
      results.filter((r) => r.expectRefusal).length,
    ),
    medianLatencyMs: [...results].sort((a, b) => a.latencyMs - b.latencyMs)[Math.floor(results.length / 2)]?.latencyMs ?? 0,
  };

  console.log('\nRetrieval hit rate   ', pct(metrics.retrievalHitRate), `(threshold ${pct(evalFile.thresholds.retrievalHitRate)})`);
  console.log('Citation precision   ', pct(metrics.citationPrecision), `(threshold ${pct(evalFile.thresholds.citationPrecision)})`);
  console.log('Outcome accuracy     ', pct(metrics.outcomeAccuracy), `(threshold ${pct(evalFile.thresholds.outcomeAccuracy)})`);
  console.log('Correct refusals     ', pct(metrics.refusalAccuracy));
  console.log('Median latency       ', `${metrics.medianLatencyMs}ms`);
  if (results.some((r) => r.cached)) {
    console.log('\nNote: some answers came from the answer cache; set CHAT_ANSWER_CACHE_TTL_SECONDS=0 on the backend for a full run.');
  }

  const out = option('--out');
  if (out) writeFileSync(out, JSON.stringify({ metrics, results }, null, 2));

  const failed = (Object.keys(evalFile.thresholds) as (keyof EvalFile['thresholds'])[]).filter(
    (k) => metrics[k] < evalFile.thresholds[k],
  );
  if (failed.length > 0) {
    console.error(`\nBelow threshold: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
