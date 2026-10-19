import type { ChatApi } from "@repo/api-client";
import { apiClient } from "@/lib/api-client";
import { mockChatApi } from "./mock-chat-api";

/* Uses the in-browser mock until the query pipeline is live; set NEXT_PUBLIC_CHAT_API_MODE=live to hit the backend. */
export const isMockChat = process.env.NEXT_PUBLIC_CHAT_API_MODE !== "live";

export const chatApi: ChatApi = isMockChat ? mockChatApi : apiClient.chat;
