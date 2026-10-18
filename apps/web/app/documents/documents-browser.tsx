"use client";

import { useState } from "react";
import {
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@repo/ui";
import { StatusDot, type StatusTone } from "@/app/components/status-dot";
import { SOURCE_NAMES, type DocumentStatus, type SampleDocument, type SourceKey } from "@/lib/sample-data";

const STATUS_TONE: Record<DocumentStatus, StatusTone> = {
  Synced: "ok",
  Syncing: "warn",
  Failed: "danger",
};

type SourceFilter = "all" | SourceKey;

export function DocumentsBrowser({ documents }: { documents: SampleDocument[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");

  const visible = documents.filter(
    (doc) =>
      (source === "all" || doc.source === source) &&
      doc.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        <Input
          placeholder="Search documents"
          aria-label="Search documents"
          className="min-w-55 flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ToggleGroup
          variant="segmented"
          size="segmented"
          spacing={0.5}
          aria-label="Filter by source"
          value={[source]}
          /* One option is always active; pressing the active one keeps it. Values come only from the items below. */
          onValueChange={(value) => {
            const next = value[0] as SourceFilter | undefined;
            if (next) setSource(next);
          }}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="notion">{SOURCE_NAMES.notion}</ToggleGroupItem>
          <ToggleGroupItem value="confluence">{SOURCE_NAMES.confluence}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Card className="gap-0 py-0">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Source</TableHead>
              <TableHead className="w-33">Status</TableHead>
              <TableHead className="w-33 text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((doc) => (
              <TableRow key={doc.title}>
                <TableCell>
                  <div className="truncate font-medium">{doc.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{doc.path}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{SOURCE_NAMES[doc.source]}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-[13px]">
                    <StatusDot tone={STATUS_TONE[doc.status]} />
                    {doc.status}
                  </span>
                </TableCell>
                <TableCell className="text-right text-[13px] text-muted-foreground">{doc.updated}</TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No documents yet. Connect a source and choose pages.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
