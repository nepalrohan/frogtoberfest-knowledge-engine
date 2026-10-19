"use client";

import type { ReactNode } from "react";
import type { ChatSource } from "@repo/api-client";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@repo/ui/components/hover-card";

interface AnswerTextProps {
  text: string;
  sources?: ChatSource[];
  onCitationClick?: (sourceIndex: number) => void;
}

/* Citation chip with a hover preview of the cited chunk; clicking opens it in the inspector. */
function CitationChip({
  index,
  source,
  onClick,
}: {
  index: number;
  source?: ChatSource;
  onClick?: (sourceIndex: number) => void;
}) {
  const chip = (
    <button
      type="button"
      onClick={() => onClick?.(index)}
      className="mx-0.5 inline-flex h-4.5 min-w-4.5 -translate-y-px items-center justify-center rounded-md border border-border bg-muted px-1 align-middle font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      aria-label={`Source ${index}`}
    >
      {index}
    </button>
  );

  if (!source) {
    return chip;
  }

  return (
    <HoverCard>
      <HoverCardTrigger render={chip} />
      <HoverCardContent className="w-80 space-y-1.5" side="top">
        <p className="text-xs font-semibold">{source.documentTitle}</p>
        <p className="text-[11px] text-muted-foreground">{source.sectionHeaders.join(" › ")}</p>
        <p className="line-clamp-4 text-xs leading-relaxed">{source.snippet}</p>
      </HoverCardContent>
    </HoverCard>
  );
}

/* Renders **bold**, `code` and [Source N] markers inside one line of text. */
function renderInline(line: string, props: AnswerTextProps, keyPrefix: string): ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[Source \d+\])/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    const citation = part.match(/^\[Source (\d+)\]$/);
    if (citation) {
      const index = Number(citation[1]);
      return (
        <CitationChip
          key={key}
          index={index}
          source={props.sources?.find((s) => s.index === index)}
          onClick={props.onCitationClick}
        />
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

/* Minimal markdown renderer for answers: paragraphs, bullet and numbered lists, inline marks and citations. */
export function AnswerText(props: AnswerTextProps) {
  const blocks = props.text.split(/\n{2,}/);

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const isBullet = lines.length > 0 && lines.every((l) => /^\s*[-*] /.test(l));
        const isNumbered = lines.length > 0 && lines.every((l) => /^\s*\d+\. /.test(l));

        if (isBullet || isNumbered) {
          const ListTag = isNumbered ? "ol" : "ul";
          return (
            <ListTag key={blockIndex} className={`space-y-1 pl-5 ${isNumbered ? "list-decimal" : "list-disc"}`}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInline(line.replace(/^\s*([-*]|\d+\.) /, ""), props, `${blockIndex}-${lineIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={blockIndex} className="whitespace-pre-wrap">
            {renderInline(block, props, `${blockIndex}`)}
          </p>
        );
      })}
    </div>
  );
}
