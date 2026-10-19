"use client";

import { BookOpenText } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@repo/ui/components/empty";
import { isMockChat } from "@/lib/chat/chat-api";

const SUGGESTIONS = [
  "What is our incident escalation process for a SEV1?",
  "How do I roll back a bad deploy?",
  "Why did we choose pgvector over a vector database?",
  "What's the on-call swap rule before taking leave?",
];

/* Scenarios that exercise the mock's non-happy paths. */
const MOCK_SCENARIOS = [
  { label: "Insufficient evidence", question: "How do we configure Kubernetes autoscaling?" },
  { label: "Out of scope", question: "What's the weather like today?" },
  { label: "LLM failure", question: "Simulate a fail during the deploy rollback answer" },
];

interface ChatEmptyStateProps {
  onPick: (question: string) => void;
}

/* First screen of a new conversation with starter questions. */
export function ChatEmptyState({ onPick }: ChatEmptyStateProps) {
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
      <EmptyContent className="max-w-xl">
        <div className="grid w-full gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((question) => (
            <Button
              key={question}
              variant="outline"
              className="h-auto justify-start py-2 text-left text-xs whitespace-normal"
              onClick={() => onPick(question)}
            >
              {question}
            </Button>
          ))}
        </div>
        {isMockChat && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2 text-xs text-muted-foreground">
            <span>Try mock scenarios:</span>
            {MOCK_SCENARIOS.map((scenario) => (
              <Button key={scenario.label} size="xs" variant="ghost" onClick={() => onPick(scenario.question)}>
                {scenario.label}
              </Button>
            ))}
          </div>
        )}
      </EmptyContent>
    </Empty>
  );
}
