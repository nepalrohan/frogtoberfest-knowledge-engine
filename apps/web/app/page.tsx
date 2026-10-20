"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  UploadCloud,
  FileText,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from "lucide-react";
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

/* Enterprise Document Ingestion & Vector Synchronization Dashboard */
export default function Home() {
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
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          {/* Brand & Version Badge */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center font-bold text-xs shadow-xs tracking-tight">
              KE
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Knowledge Engine
              </span>
              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground">
                v1.0
              </Badge>
            </div>
            <div className="hidden md:block h-4 w-px bg-border mx-1" />
            <span className="hidden md:block text-xs text-muted-foreground">
              Document Ingestion & Outbox Relay
            </span>
          </div>

          {/* Poller Status & API Documentation Link */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-border bg-muted/40 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-medium text-foreground">Outbox Poller: Active</span>
            </div>

            <Link
              id="chat-link"
              href="/chat"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Ask the knowledge base</span>
            </Link>

            <a
              id="swagger-docs-link"
              href="http://localhost:5000/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Swagger API</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
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
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-border py-4 text-xs text-muted-foreground bg-card/40 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px]">
          <span>Knowledge Engine — Enterprise Document Ingestion & Vector Synchronization Pipeline</span>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>PostgreSQL 16 (pgvector)</span>
            <span>•</span>
            <span>BullMQ + Redis 7</span>
            <span>•</span>
            <span>Transactional Outbox</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
