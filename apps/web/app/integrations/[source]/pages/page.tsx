import { notFound, redirect } from "next/navigation";
import { getNotionPages, getNotionStatus } from "@/lib/api";
import { SOURCE_NAMES } from "@/lib/sample-data";
import { PagePicker } from "./page-picker";

/* Retrieves live Notion workspace pages and user selections from backend */
export default async function ChoosePagesPage({ params }: PageProps<"/integrations/[source]/pages">) {
  const { source } = await params;
  if (source !== "notion") notFound();

  /* The picker is only reachable from a connected source */
  const [notion, pagesData] = await Promise.all([getNotionStatus(), getNotionPages()]);
  if (!notion?.connected) redirect("/integrations");

  return (
    <PagePicker
      sourceName={SOURCE_NAMES.notion}
      workspaceName={notion.workspaceName ?? undefined}
      tree={pagesData.pages}
      initialPicked={pagesData.selectedPageIds}
    />
  );
}
