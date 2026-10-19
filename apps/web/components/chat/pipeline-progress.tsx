"use client";

import { Check, ChevronRight } from "lucide-react";
import type { PipelineStage } from "@repo/api-client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/ui/components/collapsible";
import { Spinner } from "@repo/ui/components/spinner";
import { STAGE_LABELS, formatMs } from "@/lib/chat/format";
import type { StageState } from "./chat-provider";

const STAGE_ORDER: PipelineStage[] = ["rewrite", "embed", "retrieve", "rerank", "select", "generate", "verify"];

interface PipelineProgressProps {
  stages: Partial<Record<PipelineStage, StageState>>;
  isStreaming: boolean;
  summary: string;
}

/* Live list of pipeline stages; expanded while streaming, collapsed to a one-line summary afterwards. */
export function PipelineProgress({ stages, isStreaming, summary }: PipelineProgressProps) {
  const visible = STAGE_ORDER.filter((stage) => stages[stage]);
  if (visible.length === 0) {
    return null;
  }

  const list = (
    <ol className="space-y-1 border-l border-border pl-3">
      {visible.map((stage) => {
        const state = stages[stage]!;
        return (
          <li key={stage} className="flex items-center gap-2 text-xs text-muted-foreground">
            {state.status === "completed" ? (
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Spinner className="size-3.5" />
            )}
            <span className={state.status === "started" ? "text-foreground" : undefined}>{STAGE_LABELS[stage]}</span>
            {state.durationMs !== undefined && (
              <span className="ml-auto font-mono text-[10px]">{formatMs(state.durationMs)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );

  if (isStreaming) {
    return <div className="max-w-xs">{list}</div>;
  }

  return (
    <Collapsible className="max-w-xs">
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{list}</CollapsibleContent>
    </Collapsible>
  );
}
