"use client";

import { Button, InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@repo/ui";

/* Enter is reserved for sending (Shift+Enter adds a line), as in the reference; sending waits on a chat backend */
export function Composer({ documentCount }: { documentCount: number }) {
  return (
    <InputGroup>
      <InputGroupTextarea
        rows={2}
        aria-label="Ask about your docs"
        placeholder="Ask about your docs… (Enter to send, Shift+Enter for a new line)"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) event.preventDefault();
        }}
      />
      <InputGroupAddon align="block-end" className="justify-between pt-1.5 pr-2 pb-2 pl-3">
        <InputGroupText className="text-xs">Searching {documentCount} synced documents</InputGroupText>
        {/* The reference dims Send to 40% while it can't send */}
        <Button size="sm" disabled className="disabled:opacity-40">
          Send ↵
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
