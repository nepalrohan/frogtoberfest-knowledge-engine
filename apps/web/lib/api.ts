import { cache } from "react";
import { createHttpApiClient } from "@repo/api-client";

/* Server-only client: the admin key authorizes every backend call and must never reach the browser */
export const api = createHttpApiClient({
  baseURL: `${process.env.BACKEND_URL ?? "http://localhost:5000"}/api`,
  getAuthToken: () => process.env.ADMIN_API_KEY,
});

/* Deduplicated per request so the sidebar and the Sources page share one call; null means the backend is unreachable */
export const getNotionStatus = cache(async () => {
  try {
    return await api.notion.getStatus();
  } catch (error) {
    console.error("Failed to load Notion status", error);
    return null;
  }
});
