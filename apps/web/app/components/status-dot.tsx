import { cn } from "@repo/ui";

export type StatusTone = "ok" | "warn" | "danger" | "idle";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  idle: "bg-border",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone], className)}
    />
  );
}
