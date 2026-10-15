"use client";

import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Send, Tag } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Textarea } from "@repo/ui/components/textarea";
import { Badge } from "@repo/ui/components/badge";
import { apiClient } from "@/lib/api-client";
import type { IngestResponse } from "@repo/api-client";

interface TextFeederProps {
  onSuccess: (result: IngestResponse) => void;
}

const CATEGORIES = ["engineering", "architecture", "incident", "policies"] as const;

/* Structured text knowledge feeder for policies, guidelines, and engineering notes */
export function TextFeeder({ onSuccess }: TextFeederProps) {
  const [title, setTitle] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("engineering");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  /* Submission handler */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError("Document title and markdown content are required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessInfo(null);

    try {
      const response = await apiClient.ingestion.feedKnowledge({
        title: title.trim(),
        content: content.trim(),
        sourceId: sourceId.trim() || undefined,
        metadata: {
          category,
          characterCount: content.length,
          source: "web-console",
        },
      });

      setSuccessInfo(
        `Document "${response.title}" successfully ingested (version ${response.version})!`
      );
      setTitle("");
      setSourceId("");
      setContent("");
      onSuccess(response);
    } catch (err: any) {
      setError(
        err?.message || "Failed to feed knowledge. Verify backend service is reachable."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  /* Approximate token estimation */
  const estimatedTokens = Math.ceil(content.length / 4);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title & Optional Source ID */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="space-y-1.5">
          <label htmlFor="text-title-input" className="block text-xs font-medium text-foreground">
            Document Title <span className="text-destructive">*</span>
          </label>
          <Input
            id="text-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Incident Escalation Protocol"
            className="h-9 text-xs"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="text-source-id-input" className="block text-xs font-medium text-foreground">
            Source ID <span className="text-[10px] text-muted-foreground font-normal">(Optional)</span>
          </label>
          <Input
            id="text-source-id-input"
            type="text"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            placeholder="e.g. not-runbook-2026"
            className="h-9 text-xs"
          />
        </div>
      </div>

      {/* Category Selection */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5" /> Category:
        </span>
        <div className="flex items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              id={`category-btn-${cat}`}
              type="button"
              variant={category === cat ? "default" : "outline"}
              size="xs"
              onClick={() => setCategory(cat)}
              className="capitalize text-xs h-6 px-2.5"
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Content Field */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="text-content-textarea" className="block text-xs font-medium text-foreground">
            Markdown Content <span className="text-destructive">*</span>
          </label>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
            <span>~{estimatedTokens} tokens</span>
            <span>•</span>
            <span>{content.length} chars</span>
          </div>
        </div>
        <Textarea
          id="text-content-textarea"
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="## Summary&#10;Write markdown documentation, guidelines, code snippets, or architecture decisions here..."
          className="font-mono text-xs leading-relaxed resize-y min-h-[140px]"
          required
        />
      </div>

      {/* Actions Row */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-muted-foreground">
          Auto-hashed with deterministic SHA-256 for deduplication
        </span>

        <Button
          id="text-feed-submit-btn"
          type="submit"
          size="sm"
          disabled={isSubmitting || !title.trim() || !content.trim()}
          className="h-8 text-xs px-3.5"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              <span>Ingesting...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5 mr-1.5" />
              <span>Feed Knowledge</span>
            </>
          )}
        </Button>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-destructive/10 text-destructive text-xs border border-destructive/20 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successInfo && (
        <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs border border-emerald-500/20 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successInfo}</span>
        </div>
      )}
    </form>
  );
}
