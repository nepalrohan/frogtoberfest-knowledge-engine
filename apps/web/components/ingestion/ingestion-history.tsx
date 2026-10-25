"use client";

import { useState } from "react";
import { Copy, Check, Hash, Clock, CircleCheck, CircleAlert, FileCheck2 } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import type { DocumentSummary } from "@repo/api-client";
import { formatRelativeTime } from "@/lib/chat/format";

interface IngestionHistoryProps {
  items: DocumentSummary[];
}

/* Indexing badge: documents are searchable in chat only once indexed */
function SyncStatusBadge({ status }: { status: string }) {
  if (status === "indexed") {
    return (
      <Badge variant="success" className="text-[10px] gap-1 py-0.5 px-2">
        <CircleCheck className="w-3 h-3" />
        Indexed
      </Badge>
    );
  }
  if (status === "pending_embedding" || status === "indexing") {
    return (
      <Badge variant="warning" className="text-[10px] gap-1 py-0.5 px-2">
        <Spinner className="w-3 h-3" />
        Indexing…
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-[10px] gap-1 py-0.5 px-2 capitalize">
      <CircleAlert className="w-3 h-3" />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

/* Feed of recently ingested documents with version, hash and indexing status */
export function IngestionHistory({ items }: IngestionHistoryProps) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  /* Copy SHA-256 hash to clipboard with temporary visual feedback */
  const handleCopy = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 rounded-xl border border-dashed border-border bg-muted/20 text-center">
        <div className="p-3 rounded-full bg-background border border-border shadow-xs text-muted-foreground mb-3">
          <FileCheck2 className="w-5 h-5" />
        </div>
        <p className="text-xs font-semibold text-foreground">No documents yet</p>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
          Uploaded files and text submissions appear here and show when they are ready to search in chat.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.documentId}
          className="p-3.5 rounded-lg border border-border bg-card shadow-xs transition-all space-y-2.5 animate-in fade-in"
        >
          {/* Header Row: Title & Version Badges */}
          <div className="flex items-start justify-between gap-2.5">
            <div className="space-y-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold text-foreground tracking-tight truncate">
                  {item.title}
                </h4>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono">
                  v{item.version}
                </Badge>
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 capitalize">
                  {item.sourceType}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate">
                ID: {item.documentId}
              </p>
            </div>

            <div className="shrink-0">
              <SyncStatusBadge status={item.syncStatus} />
            </div>
          </div>

          {/* Hash and Outbox Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1.5 border-t border-border/50 text-[10px]">
            {/* Hash preview */}
            <div className="flex items-center justify-between px-2.5 py-1 rounded bg-muted/50 font-mono text-muted-foreground">
              <span className="flex items-center gap-1.5 truncate">
                <Hash className="w-3 h-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.contentHash}</span>
              </span>
              <Button
                id={`copy-hash-${item.documentId}`}
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => handleCopy(item.contentHash)}
                title="Copy SHA-256 Hash"
                className="h-5 w-5 p-0 shrink-0 ml-1 text-muted-foreground hover:text-foreground"
              >
                {copiedHash === item.contentHash ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
            </div>

            {/* Last change */}
            <div className="flex items-center justify-between px-2.5 py-1 rounded bg-muted/50">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                Updated:
              </span>
              <span className="font-medium text-foreground">{formatRelativeTime(item.updatedAt)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
