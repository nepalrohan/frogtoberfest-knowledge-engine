"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatStreamEvent, ConversationSummary, PipelineStage } from "@repo/api-client";
import { apiClient } from "@/lib/api-client";

const chatApi = apiClient.chat;

/* Thread key used for a conversation that has not been created on the server yet. */
export const NEW_THREAD_KEY = "__new__";

export type MessageStatus = "streaming" | "complete" | "stopped" | "error";

export interface StageState {
  status: "started" | "completed";
  durationMs?: number;
}

/* Client-side view of a message: the persisted shape plus live streaming state. */
export interface UiMessage extends Omit<ChatMessage, "status"> {
  status: MessageStatus;
  stages?: Partial<Record<PipelineStage, StageState>>;
  error?: { code: string; message: string; retryable: boolean };
}

export interface Thread {
  status: "loading" | "ready" | "error";
  messages: UiMessage[];
  title?: string;
}

interface ChatContextValue {
  conversations: ConversationSummary[];
  conversationsStatus: "loading" | "ready" | "error";
  threads: Record<string, Thread>;
  loadThread: (id: string) => Promise<void>;
  send: (conversationId: string | null, text: string) => Promise<void>;
  stop: (key: string) => void;
  retry: (key: string, assistantMessageId: string) => void;
  remove: (id: string) => Promise<void>;
  resetNewThread: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function toUiMessage(message: ChatMessage): UiMessage {
  return { ...message, status: message.status === "stopped" ? "stopped" : "complete" };
}

/* Owns conversations and live streams at layout level, so a stream survives the /chat -> /chat/[id] navigation. */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const requested = useRef(new Set<string>());

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await chatApi.listConversations());
      setConversationsStatus("ready");
    } catch {
      setConversationsStatus("error");
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const loadThread = useCallback(async (id: string) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    try {
      const conversation = await chatApi.getConversation(id);
      setThreads((prev) => ({
        ...prev,
        [id]: { status: "ready", title: conversation.title, messages: conversation.messages.map(toUiMessage) },
      }));
    } catch {
      requested.current.delete(id);
      setThreads((prev) => ({ ...prev, [id]: { status: "error", messages: [] } }));
    }
  }, []);

  const send = useCallback(
    async (conversationId: string | null, text: string) => {
      let key = conversationId ?? NEW_THREAD_KEY;
      const now = new Date().toISOString();
      let userId = `local-user-${Date.now()}`;
      let assistantId = `local-assistant-${Date.now()}`;

      setThreads((prev) => {
        const thread = prev[key] ?? { status: "ready" as const, messages: [] };
        return {
          ...prev,
          [key]: {
            ...thread,
            messages: [
              ...thread.messages,
              { id: userId, role: "user", content: text, createdAt: now, status: "complete" },
              { id: assistantId, role: "assistant", content: "", createdAt: now, status: "streaming", stages: {} },
            ],
          },
        };
      });

      const updateAssistant = (patch: (message: UiMessage) => UiMessage) => {
        setThreads((prev) => {
          const thread = prev[key];
          if (!thread) return prev;
          return {
            ...prev,
            [key]: { ...thread, messages: thread.messages.map((m) => (m.id === assistantId ? patch(m) : m)) },
          };
        });
      };

      const handleEvent = (event: ChatStreamEvent) => {
        switch (event.type) {
          case "meta": {
            const previousKey = key;
            const nextKey = event.conversationId;
            const previousUserId = userId;
            const previousAssistantId = assistantId;
            userId = event.userMessageId;
            assistantId = event.assistantMessageId;
            key = nextKey;
            if (previousKey !== nextKey) {
              requested.current.add(nextKey);
              const controller = controllers.current.get(previousKey);
              if (controller) {
                controllers.current.delete(previousKey);
                controllers.current.set(nextKey, controller);
              }
            }
            setThreads((prev) => {
              const { [previousKey]: thread, ...rest } = prev;
              if (!thread) return prev;
              const messages = thread.messages.map((m) =>
                m.id === previousUserId
                  ? { ...m, id: event.userMessageId }
                  : m.id === previousAssistantId
                    ? { ...m, id: event.assistantMessageId }
                    : m,
              );
              return { ...rest, [nextKey]: { ...thread, title: event.conversationTitle, messages } };
            });
            if (previousKey !== nextKey) {
              router.replace(`/chat/${nextKey}`);
            }
            break;
          }
          case "stage":
            updateAssistant((m) => ({
              ...m,
              stages: { ...m.stages, [event.stage]: { status: event.status, durationMs: event.durationMs } },
            }));
            break;
          case "sources":
            updateAssistant((m) => ({ ...m, sources: event.sources }));
            break;
          case "token":
            updateAssistant((m) => ({ ...m, content: m.content + event.delta }));
            break;
          case "done":
            updateAssistant((m) => ({
              ...m,
              /* The stored text wins over streamed tokens, e.g. a refusal replacing an unverifiable draft */
              content: event.content,
              status: "complete",
              outcome: event.outcome,
              refusalReason: event.refusalReason,
              run: event.run,
              sources: m.sources?.map((s) => ({ ...s, cited: event.citedIndexes.includes(s.index) })),
            }));
            break;
          case "error":
            updateAssistant((m) => ({
              ...m,
              status: "error",
              error: { code: event.code, message: event.message, retryable: event.retryable },
            }));
            break;
        }
      };

      const controller = new AbortController();
      controllers.current.set(key, controller);

      try {
        await chatApi.sendMessage(conversationId, { message: text }, { signal: controller.signal, onEvent: handleEvent });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          updateAssistant((m) => ({ ...m, status: "stopped" }));
        } else {
          updateAssistant((m) => ({
            ...m,
            status: "error",
            error: {
              code: "NETWORK_ERROR",
              message: err instanceof Error ? err.message : "Could not reach the server.",
              retryable: true,
            },
          }));
        }
      } finally {
        controllers.current.delete(key);
        void refreshConversations();
      }
    },
    [router, refreshConversations],
  );

  const stop = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
  }, []);

  /* Drops the failed or stopped turn and asks the same question again. */
  const retry = useCallback(
    (key: string, assistantMessageId: string) => {
      const thread = threads[key];
      if (!thread) return;
      const index = thread.messages.findIndex((m) => m.id === assistantMessageId);
      const question = thread.messages[index - 1];
      if (index < 1 || !question || question.role !== "user") return;

      setThreads((prev) => {
        const current = prev[key];
        if (!current) return prev;
        return {
          ...prev,
          [key]: { ...current, messages: current.messages.filter((m) => m.id !== assistantMessageId && m.id !== question.id) },
        };
      });
      void send(key === NEW_THREAD_KEY ? null : key, question.content);
    },
    [threads, send],
  );

  const remove = useCallback(
    async (id: string) => {
      await chatApi.deleteConversation(id);
      requested.current.delete(id);
      setThreads((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
      setConversations((prev) => prev.filter((c) => c.id !== id));
    },
    [],
  );

  const resetNewThread = useCallback(() => {
    if (controllers.current.has(NEW_THREAD_KEY)) return;
    setThreads((prev) => {
      const { [NEW_THREAD_KEY]: _draft, ...rest } = prev;
      return rest;
    });
  }, []);

  const value = useMemo(
    () => ({ conversations, conversationsStatus, threads, loadThread, send, stop, retry, remove, resetNewThread }),
    [conversations, conversationsStatus, threads, loadThread, send, stop, retry, remove, resetNewThread],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used inside ChatProvider");
  }
  return context;
}
