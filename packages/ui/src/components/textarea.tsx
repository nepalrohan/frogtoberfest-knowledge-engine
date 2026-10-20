import * as React from "react";
import { cn } from "../lib/utils";

/* Shadcn UI Textarea component */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-border placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring flex min-h-16 w-full rounded-lg border bg-background px-3 py-2 text-xs shadow-xs transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
