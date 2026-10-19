import type { PipelineStage } from "@repo/api-client";

export const STAGE_LABELS: Record<PipelineStage, string> = {
  rewrite: "Rewriting question",
  embed: "Embedding",
  retrieve: "Searching knowledge base",
  rerank: "Reranking",
  select: "Building context",
  generate: "Generating answer",
  verify: "Verifying citations",
};

/* Short relative time such as "just now", "5m ago", "3h ago", or a date. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
