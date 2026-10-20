"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
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
        {source.sourceUrl && (
          <a
            href={source.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2"
          >
            Open original <ExternalLink className="size-3" />
          </a>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/* Turns [Source N] markers into in-page links so the renderer hands them to CitationChip. */
const CITATION_HREF_PREFIX = "#source-";
const linkCitations = (text: string): string =>
  text.replace(/\[Source (\d+)\]/g, (_m, n: string) => `[${n}](${CITATION_HREF_PREFIX}${n})`);

/* Renders a streamed or stored answer as GitHub-flavoured Markdown with citation chips. */
export function AnswerText(props: AnswerTextProps) {
  const components: Components = {
    h1: ({ children }) => <h1 className="mt-5 mb-2 text-lg font-semibold first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h4>,
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="pl-0.5 [&>ol]:my-1 [&>ul]:my-1">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
    th: ({ children }) => <th className="border-b border-border px-2.5 py-1.5 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border-b border-border px-2.5 py-1.5 align-top">{children}</td>,
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
        {children}
      </pre>
    ),
    code: ({ children }) => (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    a: ({ href, children }) => {
      if (href?.startsWith(CITATION_HREF_PREFIX)) {
        const index = Number(href.slice(CITATION_HREF_PREFIX.length));
        return (
          <CitationChip
            index={index}
            source={props.sources?.find((s) => s.index === index)}
            onClick={props.onCitationClick}
          />
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {children}
        </a>
      );
    },
  };

  return (
    <div className="text-sm leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkCitations(props.text)}
      </ReactMarkdown>
    </div>
  );
}
