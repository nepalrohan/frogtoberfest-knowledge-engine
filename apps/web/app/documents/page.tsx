import { PageHeader } from "@/app/components/page-header";
import { IngestionDashboard } from "./ingestion-dashboard";
import { apiBaseUrl } from "@/lib/api-client";

/* Intake for raw files and text, plus the live feed of documents and their indexing status */
export default function DocumentsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Documents"
        description="Upload or feed documents and watch them get indexed for the assistant."
        actions={
          <a
            id="swagger-docs-link"
            href={`${apiBaseUrl}/api/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Swagger API
          </a>
        }
      />
      <IngestionDashboard />
    </div>
  );
}
