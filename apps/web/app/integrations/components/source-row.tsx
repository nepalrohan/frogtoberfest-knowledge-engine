import type { ReactNode } from "react";
import { cn } from "@repo/ui";
import { StatusDot, type StatusTone } from "@/app/components/status-dot";

interface SourceRowProps {
  name: string;
  connected?: boolean;
  state: string;
  tone: StatusTone;
  description: string;
  helperText?: string;
  children: ReactNode;
}

export function SourceRow({
  name,
  connected = false,
  state,
  tone,
  description,
  helperText,
  children,
}: SourceRowProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b px-5 py-5 last:border-b-0 hover:bg-muted/10 transition-colors">
      <div className="flex items-start gap-4 min-w-0">
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg border text-base font-semibold shadow-xs",
            connected ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {name[0]}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="font-medium text-sm text-foreground">{name}</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot tone={tone} className="size-1.5" />
              {state}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-normal">{description}</p>
          {helperText && (
            <p className="text-[11.5px] text-muted-foreground/80 leading-normal">{helperText}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
        {children}
      </div>
    </div>
  );
}
