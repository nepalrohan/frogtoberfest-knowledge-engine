"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import type { ChatSource, RunDetails } from "@repo/api-client";
import { Badge } from "@repo/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@repo/ui/components/empty";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { Separator } from "@repo/ui/components/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { STAGE_LABELS, formatMs } from "@/lib/chat/format";
import type { InspectorTab } from "./message-item";

interface InspectorPanelProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  sources: ChatSource[];
  run?: RunDetails;
  highlightedSource?: number;
}

function SourceCard({ source, highlighted }: { source: ChatSource; highlighted: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlighted]);

  return (
    <Card
      ref={ref}
      className={`gap-0 transition-shadow ${highlighted ? "ring-2 ring-ring" : ""} ${source.cited ? "" : "opacity-60"}`}
    >
      <CardHeader className="gap-1 p-4 pb-2">
        <div className="flex items-start gap-2">
          <Badge variant="secondary" className="font-mono">
            {source.index}
          </Badge>
          <CardTitle className="text-sm leading-snug">{source.documentTitle}</CardTitle>
          {source.sourceUrl && (
            <a
              href={source.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-muted-foreground hover:text-foreground"
              aria-label="Open original document"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{source.sectionHeaders.join(" › ")}</p>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        <p className="text-xs leading-relaxed">{source.snippet}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <Badge variant="outline">{source.sourceType}</Badge>
          <Badge variant="outline" className="font-mono">
            v{source.documentVersion}
          </Badge>
          <Badge variant="outline" className="font-mono">
            score {source.score.toFixed(2)}
          </Badge>
          {!source.cited && <span className="text-muted-foreground">not cited</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function RunRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono break-all">{value}</span>
    </div>
  );
}

function RunDetailsView({ run }: { run: RunDetails }) {
  const longest = Math.max(...run.stages.map((s) => s.durationMs), 1);

  return (
    <div className="space-y-4">
      <div>
        <RunRow label="Trace ID" value={run.traceId} />
        <RunRow label="Answer model" value={run.model} />
        <RunRow label="Embedding model" value={run.embeddingModel} />
        {run.rewrittenQuery && <RunRow label="Rewritten query" value={run.rewrittenQuery} />}
        {run.cachedFromMessageId && <RunRow label="Reused answer" value={run.cachedFromMessageId} />}
        <Separator className="my-1" />
        <RunRow label="Reranked" value={run.reranked ? "yes" : "no"} />
        <RunRow label="Candidates retrieved" value={run.candidatesRetrieved} />
        <RunRow label="Context tokens" value={run.contextTokens} />
        <RunRow label="Prompt / completion tokens" value={`${run.promptTokens} / ${run.completionTokens}`} />
        <RunRow label="Total latency" value={formatMs(run.totalLatencyMs)} />
        {run.historyDropped || run.sourcesDropped ? (
          <RunRow
            label="Trimmed to fit context"
            value={`${run.historyDropped ?? 0} history / ${run.sourcesDropped ?? 0} sources`}
          />
        ) : null}
        {run.unsupportedCitations ? (
          <RunRow label="Unsupported citations removed" value={run.unsupportedCitations} />
        ) : null}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">Stage timings</p>
        {run.stages.map((s) => (
          <div key={s.stage} className="space-y-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{STAGE_LABELS[s.stage]}</span>
              <span className="font-mono">{formatMs(s.durationMs)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(s.durationMs / longest) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Side panel showing the context chunks behind an answer and the run diagnostics. */
export function InspectorPanel({ tab, onTabChange, sources, run, highlightedSource }: InspectorPanelProps) {
  return (
    <Tabs value={tab} onValueChange={(value) => onTabChange(value as InspectorTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="mx-4 mt-3 w-auto">
        <TabsTrigger value="sources">Sources ({sources.length})</TabsTrigger>
        <TabsTrigger value="run">Run details</TabsTrigger>
      </TabsList>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <TabsContent value="sources" className="space-y-3">
            {sources.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No sources</EmptyTitle>
                  <EmptyDescription>Nothing from the knowledge base was used for this answer.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              sources.map((source) => (
                <SourceCard key={source.chunkId} source={source} highlighted={source.index === highlightedSource} />
              ))
            )}
          </TabsContent>
          <TabsContent value="run">
            {run ? (
              <RunDetailsView run={run} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No run details yet</EmptyTitle>
                  <EmptyDescription>Details appear once the answer finishes.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  );
}
