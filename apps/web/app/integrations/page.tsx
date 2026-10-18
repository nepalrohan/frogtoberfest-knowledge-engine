import Link from "next/link";
import type { NotionConnectionStatus } from "@repo/api-client";
import { Alert, Button, Card } from "@repo/ui";
import { getNotionStatus } from "@/lib/api";
import { PageHeader } from "@/app/components/page-header";
import { StatusDot, type StatusTone } from "@/app/components/status-dot";
import { NotionActions } from "./components/notion-actions";
import { SourceRow } from "./components/source-row";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "Notion authorization expired or was invalid. Try connecting again.",
  missing_code: "Notion didn't return an authorization code. Try connecting again.",
  exchange_failed: "Couldn't finish connecting to Notion. Try again.",
  authorize_failed: "Couldn't start Notion authorization. Check that the backend is running.",
  disconnect_failed: "Couldn't disconnect Notion. Try again.",
};

type SearchParams = Record<string, string | string[] | undefined>;

/* Maps the OAuth callback / server action redirect query into a one-off banner */
function getBanner(params: SearchParams): { tone: StatusTone; text: string } | null {
  const workspace = typeof params.workspace === "string" ? params.workspace : null;
  switch (params.status) {
    case "success":
      return { tone: "ok", text: workspace ? `Notion workspace “${workspace}” connected.` : "Notion connected." };
    case "disconnected":
      return { tone: "ok", text: "Notion disconnected." };
    case "cancelled":
      return { tone: "warn", text: "Notion authorization was cancelled. No changes were made." };
    case "error":
      return {
        tone: "danger",
        text: ERROR_MESSAGES[String(params.message)] ?? "Something went wrong connecting to Notion.",
      };
    default:
      return null;
  }
}

function describeNotion(status: NotionConnectionStatus | null) {
  if (!status) {
    return {
      state: "Unavailable",
      tone: "danger" as const,
      description: "Couldn't reach the backend. Check BACKEND_URL and ADMIN_API_KEY.",
    };
  }
  if (!status.connected) {
    return { state: "Not connected", tone: "idle" as const, description: "Pages and databases from your workspace." };
  }
  const connectedOn = status.connectedAt
    ? ` · connected ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(status.connectedAt))}`
    : "";
  return {
    state: "Connected",
    tone: "ok" as const,
    description: `${status.workspaceName ?? "Workspace"}${connectedOn}`,
  };
}

export default async function SourcesPage({ searchParams }: PageProps<"/integrations">) {
  const [params, notion] = await Promise.all([searchParams, getNotionStatus()]);
  const banner = getBanner(params);
  const connected = Boolean(notion?.connected);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sources"
        description="Connect a workspace, then choose which pages the assistant can use."
      />

      {banner && (
        <Alert className="flex items-center gap-3">
          <StatusDot tone={banner.tone} className="size-2" />
          <span className="flex-1">{banner.text}</span>
          <Button variant="subtle" size="text" nativeButton={false} render={<Link href="/integrations" />}>
            Dismiss
          </Button>
        </Alert>
      )}

      <Card className="gap-0 py-0">
        <SourceRow name="Notion" connected={connected} {...describeNotion(notion)}>
          <NotionActions connected={connected} />
        </SourceRow>
        {/* No Confluence backend yet, so Connect stays disabled */}
        <SourceRow name="Confluence" state="Not connected" tone="idle" description="Spaces and pages from Confluence Cloud.">
          <Button disabled>Connect</Button>
        </SourceRow>
        <SourceRow name="Google Drive" state="Planned" tone="idle" description="Shared drives and folders.">
          <Button variant="outline" disabled>
            Coming soon
          </Button>
        </SourceRow>
      </Card>

      <p className="text-[12.5px] text-muted-foreground">
        Access tokens are encrypted on the server and never shown here.
      </p>
    </div>
  );
}
