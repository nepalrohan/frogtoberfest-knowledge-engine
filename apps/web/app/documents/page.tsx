import { PageHeader } from "@/app/components/page-header";
import { getNotionStatus } from "@/lib/api";
import { getAvailableDocuments } from "@/lib/sample-data";
import { DocumentsBrowser } from "./documents-browser";

/* Document list is reference sample data until the backend exposes synced documents */
export default async function DocumentsPage() {
  const notion = await getNotionStatus();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Documents" description="Pages currently available to the assistant." />
      <DocumentsBrowser documents={getAvailableDocuments(Boolean(notion?.connected))} />
    </div>
  );
}
