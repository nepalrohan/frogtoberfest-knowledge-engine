import { notFound, redirect } from "next/navigation";
import { getNotionStatus } from "@/lib/api";
import { INITIAL_PICKED, PAGE_TREES, SOURCE_NAMES } from "@/lib/sample-data";
import { PagePicker } from "./page-picker";

/* Page tree is reference sample data until the backend exposes the workspace's pages */
export default async function ChoosePagesPage({ params }: PageProps<"/integrations/[source]/pages">) {
  const { source } = await params;
  if (source !== "notion") notFound();

  /* The picker is only reachable from a connected source */
  const notion = await getNotionStatus();
  if (!notion?.connected) redirect("/integrations");

  return (
    <PagePicker sourceName={SOURCE_NAMES.notion} tree={PAGE_TREES.notion} initialPicked={INITIAL_PICKED.notion} />
  );
}
