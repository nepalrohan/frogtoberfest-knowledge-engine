import type { ReactNode } from "react";
import { cn } from "@repo/ui";
import { StatusDot, type StatusTone } from "@/app/components/status-dot";

interface SourceRowProps {
  name: string;
  connected?: boolean;
  state: string;
  tone: StatusTone;
  description: string;
  children: ReactNode;
}

export function SourceRow({
  name,
  connected = false,
  state,
  tone,
  description,
  children,
}: SourceRowProps) {
  return (
    <div className="flex items-center gap-3.5 border-b px-4.5 py-4">
      <div
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[9px] border text-base font-semibold",
          connected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {name[0]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{name}</span>
          <span className="inline-flex items-center gap-1.25 text-xs text-muted-foreground">
            <StatusDot tone={tone} />
            {state}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
