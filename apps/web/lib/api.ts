import { createHttpApiClient } from "@repo/api-client";

const getBaseUrl = () => {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:5003"
  );
};

const getAdminKey = () => {
  return (
    process.env.NEXT_PUBLIC_ADMIN_API_KEY ||
    process.env.ADMIN_API_KEY ||
    "supersecretkey"
  );
};

/* Unified HTTP API client powered by Axios from @repo/api-client */
export const api = createHttpApiClient({
  baseURL: `${getBaseUrl().replace(/\/+$/, "")}/api`,
  getAuthToken: getAdminKey,
  headers: {
    "x-admin-key": getAdminKey(),
  },
});

/* Retrieves non-sensitive active Notion connection status */
export const getNotionStatus = async () => {
  try {
    return await api.notion.getStatus();
  } catch (error) {
    console.error("Failed to load Notion status", error);
    return null;
  }
};

/* Retrieves live Notion workspace pages and currently selected IDs from the backend */
export const getNotionPages = async () => {
  try {
    return await api.notion.getPages();
  } catch (error) {
    console.error("Failed to load Notion pages", error);
    return { pages: [], selectedPageIds: [] };
  }
};
