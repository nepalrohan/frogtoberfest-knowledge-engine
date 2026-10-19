"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PanelRight } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@repo/ui/components/empty";
import { Separator } from "@repo/ui/components/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@repo/ui/components/sheet";
import { SidebarTrigger } from "@repo/ui/components/sidebar";
import { Skeleton } from "@repo/ui/components/skeleton";
import { useIsMobile } from "@repo/ui/hooks/use-mobile";
import { NEW_THREAD_KEY, useChat } from "./chat-provider";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import { InspectorPanel } from "./inspector-panel";
import { MessageItem, type InspectorTab } from "./message-item";

interface InspectorState {
  messageId: string;
  tab: InspectorTab;
  sourceIndex?: number;
}

function ThreadSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/* Conversation screen: header, message thread, composer, and the sources / run inspector. */
export function ChatView({ conversationId }: { conversationId: string | null }) {
  const { threads, conversations, loadThread, send, stop, retry } = useChat();
  const isMobile = useIsMobile();
  const [inspector, setInspector] = useState<InspectorState | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const key = conversationId ?? NEW_THREAD_KEY;
  const thread = threads[key];
  const messages = thread?.messages ?? [];
  const isStreaming = messages.some((m) => m.status === "streaming");
  const isLoading = conversationId !== null && (!thread || thread.status === "loading");
  const title =
    thread?.title ?? conversations.find((c) => c.id === conversationId)?.title ?? (conversationId ? "" : "New chat");

  useEffect(() => {
    if (conversationId) {
      void loadThread(conversationId);
    }
  }, [conversationId, loadThread]);

  /* Keep the newest content in view as tokens stream in */
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, lastMessage?.content]);

  const inspected = messages.find((m) => m.id === inspector?.messageId);
  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  const openInspector = (messageId: string, tab: InspectorTab, sourceIndex?: number) =>
    setInspector({ messageId, tab, sourceIndex });

  const toggleInspector = () => {
    if (inspector) {
      setInspector(null);
    } else if (latestAssistant) {
      openInspector(latestAssistant.id, "sources");
    }
  };

  const panel = inspector && inspected && (
    <InspectorPanel
      tab={inspector.tab}
      onTabChange={(tab) => setInspector({ ...inspector, tab })}
      sources={inspected.sources ?? []}
      run={inspected.run}
      highlightedSource={inspector.sourceIndex}
    />
  );

  return (
    <div className="flex h-svh min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <h1 className="truncate text-sm font-medium">{title || <Skeleton className="h-4 w-40" />}</h1>
          <Button
            variant={inspector ? "secondary" : "ghost"}
            size="icon-sm"
            className="ml-auto"
            onClick={toggleInspector}
            disabled={!latestAssistant}
            aria-label="Toggle sources panel"
          >
            <PanelRight />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
            {isLoading && <ThreadSkeleton />}

            {thread?.status === "error" && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Conversation not found</EmptyTitle>
                  <EmptyDescription>It may have been deleted, or the server couldn&apos;t be reached.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" render={<Link href="/chat" />} nativeButton={false}>
                    Start a new chat
                  </Button>
                </EmptyContent>
              </Empty>
            )}

            {!isLoading && thread?.status !== "error" && messages.length === 0 && (
              <ChatEmptyState onPick={(question) => void send(conversationId, question)} />
            )}

            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                onInspect={openInspector}
                onRetry={(messageId) => retry(key, messageId)}
              />
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {thread?.status !== "error" && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-4">
            <ChatComposer
              isStreaming={isStreaming}
              onSend={(text) => void send(conversationId, text)}
              onStop={() => stop(key)}
            />
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Answers are generated from internal docs. Check the cited sources before acting on them.
            </p>
          </div>
        )}
      </div>

      {isMobile ? (
        <Sheet open={panel !== null && panel !== undefined} onOpenChange={(open) => !open && setInspector(null)}>
          <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
            <SheetHeader className="border-b border-border">
              <SheetTitle>Answer details</SheetTitle>
              <SheetDescription>Sources and pipeline diagnostics for this answer.</SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      ) : (
        panel && <aside className="flex w-96 shrink-0 flex-col border-l border-border">{panel}</aside>
      )}
    </div>
  );
}
