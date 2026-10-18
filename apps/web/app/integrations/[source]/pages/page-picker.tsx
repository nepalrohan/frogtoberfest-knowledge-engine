"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Checkbox, cn, Input } from "@repo/ui";
import { PageHeader } from "@/app/components/page-header";
import type { PageNode } from "@/lib/sample-data";

/* Ids of a node and every node nested under it; the tree is a flat depth-ordered list */
function withDescendants(tree: PageNode[], id: string): string[] {
  const index = tree.findIndex((node) => node.id === id);
  const ids = [id];
  for (let i = index + 1; i < tree.length && tree[i]!.depth > tree[index]!.depth; i++) {
    ids.push(tree[i]!.id);
  }
  return ids;
}

export function PagePicker({
  sourceName,
  tree,
  initialPicked,
}: {
  sourceName: string;
  tree: PageNode[];
  initialPicked: string[];
}) {
  const [picked, setPicked] = useState(() => new Set(initialPicked));
  const [query, setQuery] = useState("");

  const visible = tree.filter((node) => node.title.toLowerCase().includes(query.toLowerCase()));

  /* Selecting a page selects everything under it; deselecting clears the whole subtree */
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

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="subtle"
        size="text"
        className="self-start"
        nativeButton={false}
        render={<Link href="/integrations" />}
      >
        ← Sources
      </Button>
      <PageHeader
        title={`Choose pages · ${sourceName}`}
        description="Selected pages and everything under them are synced."
        actions={
          <>
            <Button variant="outline" size="compact" onClick={() => setPicked(new Set(tree.map((node) => node.id)))}>
              Select all
            </Button>
            {/* No backend endpoint to save the selection yet */}
            <Button disabled>Save · {picked.size} selected</Button>
          </>
        }
      />
      <Input
        placeholder="Filter pages"
        aria-label="Filter pages"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Card className="gap-0 py-0">
        {visible.map((node) => (
          <label
            key={node.id}
            className="flex cursor-pointer items-center gap-3 border-b py-2.75 pr-4 select-none hover:bg-muted"
            style={{ paddingLeft: 16 + node.depth * 24 }}
          >
            <Checkbox checked={picked.has(node.id)} onCheckedChange={() => toggle(node.id)} />
            <span className={cn("flex-1", node.depth === 0 && "font-semibold")}>{node.title}</span>
            <span className="text-xs text-muted-foreground">{node.meta}</span>
          </label>
        ))}
      </Card>
    </div>
  );
}
