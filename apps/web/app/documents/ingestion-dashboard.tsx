"use client";

import { useCallback, useEffect, useState } from "react";
import { UploadCloud, FileText } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@repo/ui/components/card";
import { Button } from "@repo/ui/components/button";
import { Badge } from "@repo/ui/components/badge";
import { FileUploader } from "@/components/ingestion/file-uploader";
import { TextFeeder } from "@/components/ingestion/text-feeder";
import { IngestionHistory } from "@/components/ingestion/ingestion-history";
import type { DocumentSummary } from "@repo/api-client";
import { apiClient } from "@/lib/api-client";

/* How often the feed refreshes while any document is still being embedded */
const INDEXING_POLL_MS = 3000;

/* Document intake (file upload / structured text) beside the live ingestion feed */
export function IngestionDashboard() {
  const [activeTab, setActiveTab] = useState<"file" | "text">("file");
  const [history, setHistory] = useState<DocumentSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /* The feed reflects the server, so it survives reloads and shows indexing progress */
  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await apiClient.ingestion.listDocuments());
      setHistoryError(null);
    } catch {
      setHistoryError("Couldn't load documents. Is the backend running?");
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const isIndexing = history.some((doc) => doc.syncStatus === "pending_embedding");
  useEffect(() => {
    if (!isIndexing) return;
    const timer = setInterval(() => void refreshHistory(), INDEXING_POLL_MS);
    return () => clearInterval(timer);
  }, [isIndexing, refreshHistory]);

  const handleIngestionSuccess = () => {
    void refreshHistory();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Intake Card */}
      <div className="lg:col-span-7">
        <Card className="border border-border bg-card shadow-xs">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base font-semibold text-foreground">
                  Document Intake & Normalization
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-1">
                  Upload raw files or feed structured engineering decisions with deterministic SHA-256 deduplication.
                </CardDescription>
              </div>
            </div>

            {/* Segmented Mode Switcher */}
            <div className="grid grid-cols-2 p-1 bg-muted/60 rounded-lg border border-border gap-1">
              <Button
                id="tab-upload-file"
                type="button"
                variant={activeTab === "file" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("file")}
                className={`gap-2 text-xs h-8 cursor-pointer ${
                  activeTab === "file" ? "shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>File Upload (.md, .pdf)</span>
              </Button>

              <Button
                id="tab-feed-text"
                type="button"
                variant={activeTab === "text" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("text")}
                className={`gap-2 text-xs h-8 cursor-pointer ${
                  activeTab === "text" ? "shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Structured Text Feed</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {activeTab === "file" ? (
              <FileUploader onSuccess={handleIngestionSuccess} />
            ) : (
              <TextFeeder onSuccess={handleIngestionSuccess} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right Column: Live Feed Inspector Card */}
      <div className="lg:col-span-5">
        <Card className="border border-border bg-card shadow-xs">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold text-foreground">
                  Live Ingestion Feed
                </CardTitle>
                <Badge variant="secondary" className="text-[10px] font-mono py-0 px-2">
                  {history.length} {history.length === 1 ? "doc" : "docs"}
                </Badge>
              </div>

              <Button
                id="refresh-history-button"
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void refreshHistory()}
                className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Refresh
              </Button>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Latest documents with their version, SHA-256 hash, and indexing status.
            </CardDescription>
            {historyError && <p className="text-xs text-destructive mt-1">{historyError}</p>}
          </CardHeader>

          <CardContent>
            <IngestionHistory items={history} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
