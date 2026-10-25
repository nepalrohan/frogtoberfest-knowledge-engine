/* Reference sample data for screens whose backend endpoints don't exist yet (page tree, documents, chat, user) */

export type SourceKey = "notion" | "confluence";

export const SOURCE_NAMES: Record<SourceKey | "drive", string> = {
  notion: "Notion",
  confluence: "Confluence",
  drive: "Google Drive",
};

export interface PageNode {
  id: string;
  title: string;
  depth: number;
  meta: string;
}

export const PAGE_TREES: Record<SourceKey, PageNode[]> = {
  notion: [
    { id: "n1", title: "Engineering", depth: 0, meta: "24 pages" },
    { id: "n2", title: "Runbooks", depth: 1, meta: "9 pages" },
    { id: "n3", title: "Release train", depth: 2, meta: "" },
    { id: "n4", title: "Hotfix & rollback", depth: 2, meta: "" },
    { id: "n5", title: "On-call handbook", depth: 1, meta: "" },
    { id: "n6", title: "People", depth: 0, meta: "12 pages" },
    { id: "n7", title: "Leave policy", depth: 1, meta: "" },
    { id: "n8", title: "Expense reimbursement", depth: 1, meta: "" },
    { id: "n9", title: "Meeting notes", depth: 0, meta: "140 pages" },
  ],
  confluence: [
    { id: "c1", title: "PLAT · Platform space", depth: 0, meta: "38 pages" },
    { id: "c2", title: "Architecture decisions", depth: 1, meta: "14 pages" },
    { id: "c3", title: "Service catalogue", depth: 1, meta: "" },
    { id: "c4", title: "SEC · Security space", depth: 0, meta: "11 pages" },
    { id: "c5", title: "Access requests", depth: 1, meta: "" },
  ],
};

export const INITIAL_PICKED: Record<SourceKey, string[]> = {
  notion: ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"],
  confluence: [],
};

export type DocumentStatus = "Synced" | "Syncing" | "Failed";

export interface SampleDocument {
  title: string;
  path: string;
  source: SourceKey;
  status: DocumentStatus;
  updated: string;
}

const DOCUMENTS: SampleDocument[] = [
  { title: "Release train", path: "Engineering / Runbooks", source: "notion", status: "Synced", updated: "2 h ago" },
  { title: "Hotfix & rollback", path: "Engineering / Runbooks", source: "notion", status: "Synced", updated: "5 h ago" },
  { title: "On-call handbook", path: "Engineering", source: "notion", status: "Syncing", updated: "just now" },
  { title: "Leave policy", path: "People", source: "notion", status: "Synced", updated: "yesterday" },
  { title: "Expense reimbursement", path: "People", source: "notion", status: "Failed", updated: "1 d ago" },
  { title: "Architecture decisions", path: "PLAT", source: "confluence", status: "Synced", updated: "3 d ago" },
  { title: "Service catalogue", path: "PLAT", source: "confluence", status: "Synced", updated: "3 d ago" },
];

/* As in the reference, only documents from connected sources are available; Confluence can't connect yet */
export function getAvailableDocuments(notionConnected: boolean): SampleDocument[] {
  return DOCUMENTS.filter((doc) => doc.source === "notion" && notionConnected);
}

export const ASSISTANT_GREETING = "Ask anything covered by your synced pages.";

export const SUGGESTIONS = [
  "How do I roll back a deploy?",
  "When is the release train?",
  "Who is on call this week?",
];

export const SAMPLE_USER = { initials: "AS", name: "Aarav Shrestha", email: "aarav@acme.internal" };
