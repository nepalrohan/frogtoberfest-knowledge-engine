"use client";

import { useState, useRef } from "react";
import { UploadCloud, File, AlertCircle, Loader2, CheckCircle2, X } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Badge } from "@repo/ui/components/badge";
import { apiClient } from "@/lib/api-client";
import type { IngestResponse } from "@repo/api-client";

interface FileUploaderProps {
  onSuccess: (result: IngestResponse) => void;
}

/* Minimal, professional document upload dropzone with validation and live feedback */
export function FileUploader({ onSuccess }: FileUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Drag & drop handlers */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  /* Validate file extension and size */
  const validateAndSetFile = (file: File) => {
    setError(null);
    setSuccessInfo(null);
    const validExtensions = [".md", ".markdown", ".txt", ".pdf", ".docx"];
    const hasValidExt = validExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidExt) {
      setError("Supported file types: .md, .txt, .pdf, .docx");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError("File exceeds maximum limit of 20MB");
      return;
    }

    setSelectedFile(file);
  };

  /* Upload file through API client and notify parent */
  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);
    setSuccessInfo(null);

    try {
      const response = await apiClient.ingestion.upload(selectedFile, selectedFile.name);
      setSuccessInfo(`Ingested "${response.title}" as version ${response.version}`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess(response);
    } catch (err: any) {
      setError(
        err?.message || "Upload failed. Please ensure the backend service is running."
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Dropzone container */}
      <div
        id="file-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`group relative flex flex-col items-center justify-center py-10 px-6 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
          isDragging
            ? "border-foreground bg-accent/40"
            : "border-border hover:border-foreground/30 bg-muted/20 hover:bg-muted/40"
        }`}
      >
        <input
          id="file-upload-input"
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.pdf,.docx"
          onChange={handleFileInput}
          className="hidden"
        />

        <div className="p-3 rounded-full bg-background border border-border shadow-xs text-foreground mb-3 group-hover:scale-105 transition-transform">
          <UploadCloud className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>

        <p className="text-xs font-medium text-foreground">
          Drag & drop your document here, or <span className="underline underline-offset-4 decoration-muted-foreground">browse files</span>
        </p>

        <div className="flex items-center gap-1.5 mt-2.5">
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground">.MD</Badge>
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground">.TXT</Badge>
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground">.PDF</Badge>
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground">.DOCX</Badge>
          <span className="text-[10px] text-muted-foreground ml-1">up to 20MB</span>
        </div>
      </div>

      {/* Selected File Details Bar */}
      {selectedFile && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card shadow-xs">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 rounded-md bg-muted text-foreground shrink-0">
              <File className="w-4 h-4" />
            </div>
            <div className="truncate">
              <p className="text-xs font-semibold text-foreground truncate">
                {selectedFile.name}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              id="clear-file-button"
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setSelectedFile(null)}
              title="Remove file"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </Button>

            <Button
              id="ingest-file-button"
              type="button"
              size="sm"
              onClick={handleUpload}
              disabled={isUploading}
              className="h-8 text-xs px-3"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  <span>Ingesting...</span>
                </>
              ) : (
                <span>Ingest Document</span>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Inline Feedback Alerts */}
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
    </div>
  );
}
