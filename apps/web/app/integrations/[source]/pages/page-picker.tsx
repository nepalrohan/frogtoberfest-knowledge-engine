"use client";

import Link from "next/link";
import { useState } from "react";
import type { PageNode } from "@repo/api-client";
import { Badge, Button, Card, Checkbox, cn, Input, Spinner, toast } from "@repo/ui";
import { api } from "@/lib/api";

/* Finds IDs of a node and every nested descendant in depth-ordered tree */
function withDescendants(tree: PageNode[], id: string): string[] {
  const index = tree.findIndex((node) => node.id === id);
  if (index === -1) return [id];
  const ids = [id];
  for (let i = index + 1; i < tree.length && tree[i]!.depth > tree[index]!.depth; i++) {
    ids.push(tree[i]!.id);
  }
  return ids;
}

export function PagePicker({
  sourceName,
  workspaceName,
  tree,
  initialPicked,
}: {
  sourceName: string;
  workspaceName?: string;
  tree: PageNode[];
  initialPicked: string[];
}) {
  const [picked, setPicked] = useState(() => new Set(initialPicked));
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const visible = tree.filter((node) =>
    node.title.toLowerCase().includes(query.toLowerCase()),
  );

  /* Selecting a parent selects all descendants; deselecting clears the whole subtree */
  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      const on = !current.has(id);
      for (const nodeId of withDescendants(tree, id)) {
        if (on) next.add(nodeId);
        else next.delete(nodeId);
      }
      return next;
    });
  }

  /* Standard Axios API call to save user-selected pages */
  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await api.notion.savePages(Array.from(picked));
      if (result.success) {
        toast.success(
          `Saved ${result.selectedCount} ${
            result.selectedCount === 1 ? "document" : "documents"
          } to sync`,
        );
      } else {
        toast.error("Could not save page selection");
      }
    } catch (error) {
      console.error("Failed to save Notion pages", error);
      toast.error("An error occurred while saving. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full py-4">
      {/* Simple, clear back button to Sources */}
      <div>
        <Link
          href="/integrations"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1 group"
        >
          <span className="transition-transform group-hover:-translate-x-0.5">←</span>
          <span>Back to Sources</span>
        </Link>
      </div>

      {/* Header with generous breathing room */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2 border-b">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Choose pages · {sourceName}
            </h1>
            {workspaceName && (
              <Badge variant="outline" className="text-xs font-normal">
                {workspaceName}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Select the pages and databases you want to sync with the knowledge assistant.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {tree.length > 0 && (
            <>
              <Button
                variant="outline"
                size="compact"
                onClick={() => setPicked(new Set(tree.map((node) => node.id)))}
                disabled={isSaving}
              >
                Select all
              </Button>
              <Button
                variant="outline"
                size="compact"
                onClick={() => setPicked(new Set())}
                disabled={isSaving}
              >
                Clear all
              </Button>
            </>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="min-w-[130px]"
          >
            {isSaving && <Spinner data-icon="inline-start" />}
            {isSaving ? "Saving…" : `Save · ${picked.size} selected`}
          </Button>
        </div>
      </div>

      {/* Main Body */}
      {tree.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center shadow-xs">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-xl">
            📄
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <h3 className="font-medium text-sm text-foreground">No documents found</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              No pages have been shared with this integration yet. Open any page in Notion, click
              the <span className="font-medium text-foreground">•••</span> menu → Connections, and add Knowledge Engine.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Input
            placeholder="Filter pages by title…"
            aria-label="Filter pages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 text-xs"
          />

          <Card className="gap-0 py-0 overflow-hidden shadow-xs divide-y">
            {visible.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No pages match “{query}”.
              </div>
            ) : (
              visible.map((node) => (
                <label
                  key={node.id}
                  className="flex cursor-pointer items-center gap-3.5 py-3.5 pr-5 select-none hover:bg-muted/40 transition-colors"
                  style={{ paddingLeft: 20 + node.depth * 28 }}
                >
                  <Checkbox
                    checked={picked.has(node.id)}
                    onCheckedChange={() => toggle(node.id)}
                  />
                  {node.icon && (
                    <span className="text-base select-none shrink-0" aria-hidden="true">
                      {node.icon}
                    </span>
                  )}
                  <span
                    className={cn(
                      "flex-1 text-xs text-foreground",
                      node.depth === 0 ? "font-semibold" : "font-normal",
                    )}
                  >
                    {node.title}
                  </span>
                  {node.object === "database" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                      Database
                    </Badge>
                  )}
                  {node.meta && (
                    <span className="text-[11px] text-muted-foreground/80 shrink-0">
                      {node.meta}
                    </span>
                  )}
                </label>
              ))
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
