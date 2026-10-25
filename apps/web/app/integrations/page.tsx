import type { NotionConnectionStatus } from "@repo/api-client";
import { Button, Card } from "@repo/ui";
import { getNotionStatus } from "@/lib/api";
import { PageHeader } from "@/app/components/page-header";
import { NotionActions } from "./components/notion-actions";
import { SourceRow } from "./components/source-row";
import { IntegrationToaster } from "./components/integration-toaster";

function describeNotion(status: NotionConnectionStatus | null) {
  if (!status) {
    return {
      state: "Unavailable",
      tone: "danger" as const,
      description: "Could not reach the backend service.",
      helperText: "Check backend server status and API configuration.",
    };
  }
  if (!status.connected) {
    return {
      state: "Not connected",
      tone: "idle" as const,
      description: "Connect your Notion workspace to search across documentation, meeting notes, and knowledge bases.",
      helperText: "Grants read-only access to pages and databases you choose to share.",
    };
  }
  const connectedOn = status.connectedAt
    ? ` · connected ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(status.connectedAt))}`
    : "";
  const pagesText = status.selectedPagesCount !== undefined
    ? ` · ${status.selectedPagesCount} ${status.selectedPagesCount === 1 ? "page" : "pages"} selected`
    : "";

  return {
    state: "Connected",
    tone: "ok" as const,
    description: `${status.workspaceName ?? "Notion Workspace"}${connectedOn}${pagesText}`,
    helperText: "Read-only access active. You can choose documents now or update your selection anytime.",
  };
}

export default async function SourcesPage() {
  const notion = await getNotionStatus();
  const connected = Boolean(notion?.connected);

  return (
    <div className="flex flex-col gap-6">
      <IntegrationToaster />

      <PageHeader
        title="Knowledge Sources"
        description="Connect third-party workspaces. The assistant reads documents you choose to answer questions."
      />

      <Card className="gap-0 py-0 overflow-hidden shadow-xs">
        <SourceRow
          name="Notion"
          connected={connected}
          {...describeNotion(notion)}
        >
          <NotionActions
            connected={connected}
            selectedPagesCount={notion?.selectedPagesCount}
          />
        </SourceRow>

        <SourceRow
          name="Confluence"
          state="Not connected"
          tone="idle"
          description="Sync team spaces, requirements, and design docs from Confluence Cloud."
          helperText="Read-only space indexing coming soon."
        >
          <Button disabled size="compact">
            Connect
          </Button>
        </SourceRow>

        <SourceRow
          name="Google Drive"
          state="Planned"
          tone="idle"
          description="Index shared drives, folders, and Google Docs."
          helperText="Support planned in upcoming release."
        >
          <Button variant="outline" disabled size="compact">
            Coming soon
          </Button>
        </SourceRow>
      </Card>

      {/* Permission & Security Information */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="rounded-lg border bg-card/50 p-4 space-y-1.5">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <span>🔒</span> Read-Only Permissions
          </h4>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            The assistant only reads content from pages you select. It cannot modify, delete, or re-share any documents in your workspace.
          </p>
        </div>

        <div className="rounded-lg border bg-card/50 p-4 space-y-1.5">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <span>📑</span> Granular Document Choice
          </h4>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            You can connect your workspace first and choose documents later, select zero pages, or change your selections at any time.
          </p>
        </div>

        <div className="rounded-lg border bg-card/50 p-4 space-y-1.5">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <span>🛡️</span> Zero Browser Exposure
          </h4>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            All access tokens are encrypted with AES-256-GCM on the backend and are never sent to or stored in the browser.
          </p>
        </div>
      </div>
    </div>
  );
}
