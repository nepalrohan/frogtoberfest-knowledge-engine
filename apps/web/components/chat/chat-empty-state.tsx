"use client";

import { BookOpenText } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@repo/ui/components/empty";

/* First screen of a new conversation. */
export function ChatEmptyState() {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpenText />
        </EmptyMedia>
        <EmptyTitle>Ask the knowledge base</EmptyTitle>
        <EmptyDescription>
          Answers come only from ingested docs and cite their sources. If the docs don&apos;t cover it, the assistant
          says so.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
