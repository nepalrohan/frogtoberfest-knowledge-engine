"use client";

import { useState } from "react";
import { AlertCircle, BookOpen, Check, Copy, FileSearch, RotateCcw, SearchX, ShieldAlert, Square, TriangleAlert } from "lucide-react";
import type { PipelineStage, RefusalReason } from "@repo/api-client";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip";
import { STAGE_LABELS, formatMs } from "@/lib/chat/format";
import { AnswerText } from "./answer-text";
import { PipelineProgress } from "./pipeline-progress";
import type { StageState, UiMessage } from "./chat-provider";

export type InspectorTab = "sources" | "run";

interface MessageItemProps {
  message: UiMessage;
  onInspect: (messageId: string, tab: InspectorTab, sourceIndex?: number) => void;
  onRetry: (messageId: string) => void;
}

const REFUSAL_TITLES: Record<RefusalReason, string> = {
  insufficient_evidence: "Not enough evidence",
  out_of_scope: "Outside the knowledge base",
  unverifiable_citations: "Citations could not be verified",
};

/* Stage map for a message: live stages while streaming, or rebuilt from stored run details. */
function stagesOf(message: UiMessage): Partial<Record<PipelineStage, StageState>> {
  if (message.stages && Object.keys(message.stages).length > 0) {
    return message.stages;
  }
  return Object.fromEntries(
    (message.run?.stages ?? []).map((s) => [s.stage, { status: "completed" as const, durationMs: s.durationMs }]),
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMessage({ message }: { message: UiMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ message, onInspect, onRetry }: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const isStreaming = message.status === "streaming";
  const stages = stagesOf(message);
  const activeStage = (Object.entries(stages) as [PipelineStage, StageState][]).find(
    ([, s]) => s.status === "started",
  )?.[0];
  const sourceCount = message.sources?.length ?? 0;
  const citedCount = message.sources?.filter((s) => s.cited).length ?? 0;
  const summary = message.run
    ? `${message.outcome === "refused" ? "Refused" : "Answered"} in ${formatMs(message.run.totalLatencyMs)}${citedCount ? ` · ${citedCount} cited` : ""}${message.run.cachedFromMessageId ? " · from cache" : ""}`
    : "Pipeline steps";

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      <PipelineProgress stages={stages} isStreaming={isStreaming} summary={summary} />

      {isStreaming && !message.content && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          <span>{activeStage ? `${STAGE_LABELS[activeStage]}…` : "Thinking…"}</span>
        </div>
      )}

      {message.outcome === "refused" ? (
        <Alert>
          {message.refusalReason === "out_of_scope" ? <ShieldAlert /> : <SearchX />}
          <AlertTitle>{REFUSAL_TITLES[message.refusalReason ?? "insufficient_evidence"]}</AlertTitle>
          <AlertDescription>
            <AnswerText text={message.content} />
          </AlertDescription>
        </Alert>
      ) : (
        message.content && (
          <div>
            {!isStreaming && message.run?.citationsUnverified && (
              <Alert className="mb-3 border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400">
                <TriangleAlert />
                <AlertTitle>Citations can&apos;t be verified</AlertTitle>
                <AlertDescription>
                  This answer could not be matched to the retrieved sources. Check the sources before relying on it.
                </AlertDescription>
              </Alert>
            )}
            {!isStreaming && !message.run?.citationsUnverified && Boolean(message.run?.unsupportedCitations) && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="size-3.5" />
                Some citations couldn&apos;t be verified and were removed.
              </p>
            )}
            <AnswerText
              text={message.content}
              sources={message.sources}
              onCitationClick={(index) => onInspect(message.id, "sources", index)}
            />
            {isStreaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-middle" />}
          </div>
        )
      )}

      {message.status === "error" && message.error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            {message.error.message} <span className="font-mono text-[10px]">({message.error.code})</span>
          </AlertDescription>
          {message.error.retryable && (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={() => onRetry(message.id)}>
                <RotateCcw /> Retry
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}

      {message.status === "stopped" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Square className="size-3" /> Generation stopped
          <Button size="xs" variant="ghost" onClick={() => onRetry(message.id)}>
            <RotateCcw /> Regenerate
          </Button>
        </div>
      )}

      {message.status === "complete" && (
        <div className="flex items-center gap-1">
          {sourceCount > 0 && (
            <Button size="xs" variant="outline" onClick={() => onInspect(message.id, "sources")}>
              <BookOpen /> {sourceCount} {sourceCount === 1 ? "source" : "sources"}
            </Button>
          )}
          {message.run && (
            <IconAction label="Run details" onClick={() => onInspect(message.id, "run")}>
              <FileSearch />
            </IconAction>
          )}
          <IconAction label={copied ? "Copied" : "Copy answer"} onClick={copy}>
            {copied ? <Check /> : <Copy />}
          </IconAction>
        </div>
      )}
    </div>
  );
}

/* One conversation turn, rendered by role. */
export function MessageItem(props: MessageItemProps) {
  return props.message.role === "user" ? <UserMessage message={props.message} /> : <AssistantMessage {...props} />;
}
