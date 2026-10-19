"use client";

import { useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@repo/ui/components/input-group";
import { Kbd } from "@repo/ui/components/kbd";

/* Mirrors the backend's input guardrail so oversized questions are blocked before sending. */
export const MAX_QUESTION_LENGTH = 2000;

interface ChatComposerProps {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/* Question input: Enter sends, Shift+Enter adds a line, and the send button becomes Stop while streaming. */
export function ChatComposer({ isStreaming, onSend, onStop }: ChatComposerProps) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const tooLong = text.length > MAX_QUESTION_LENGTH;
  const canSend = !isStreaming && trimmed.length > 0 && !tooLong;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <InputGroup className="bg-background">
        <InputGroupTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about engineering decisions, incidents, or company policies…"
          aria-label="Question"
          aria-invalid={tooLong}
          rows={2}
          className="max-h-48 min-h-14"
        />
        <InputGroupAddon align="block-end">
          <InputGroupText className="text-xs">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
          </InputGroupText>
          <InputGroupText className={`ml-auto font-mono text-[11px] ${tooLong ? "text-destructive" : ""}`}>
            {text.length}/{MAX_QUESTION_LENGTH}
          </InputGroupText>
          {isStreaming ? (
            <InputGroupButton variant="default" size="icon-xs" className="rounded-full" onClick={onStop} aria-label="Stop generating">
              <Square className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-xs"
              className="rounded-full"
              disabled={!canSend}
              aria-label="Send question"
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
