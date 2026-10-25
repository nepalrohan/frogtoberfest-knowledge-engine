"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, MoreHorizontal, SquarePen, Trash2 } from "lucide-react";
import type { ConversationSummary } from "@repo/api-client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import { Skeleton } from "@repo/ui/components/skeleton";
import { useChat } from "./chat-provider";

interface ConversationGroup {
  label: string;
  items: ConversationSummary[];
}

/* Buckets conversations into Today / Previous 7 days / Older, preserving server order. */
function groupConversations(conversations: ConversationSummary[]): ConversationGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = startOfToday.getTime() - 7 * 86_400_000;

  const groups: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const conversation of conversations) {
    const updated = new Date(conversation.updatedAt).getTime();
    const group = updated >= startOfToday.getTime() ? groups[0] : updated >= weekAgo ? groups[1] : groups[2];
    group?.items.push(conversation);
  }
  return groups.filter((g) => g.items.length > 0);
}

/* Conversation history navigation with new-chat entry point and delete confirmation. */
export function ChatSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { conversations, conversationsStatus, remove, resetNewThread } = useChat();
  /* Non-collapsible panel next to the app nav, so the header toggle shows/hides it outright */
  const { open } = useSidebar();
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await remove(pendingDelete.id);
      if (pathname === `/chat/${pendingDelete.id}`) {
        router.push("/chat");
      }
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <>
      <Sidebar collapsible="none" className={open ? "h-svh border-r" : "hidden"}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link href="/chat" onClick={resetNewThread} />}>
                <SquarePen />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {conversationsStatus === "loading" && (
            <SidebarGroup>
              <SidebarGroupLabel>Conversations</SidebarGroupLabel>
              <SidebarMenu>
                {["80%", "65%", "72%", "58%"].map((width) => (
                  <SidebarMenuItem key={width} className="flex h-8 items-center px-2">
                    <Skeleton className="h-4" style={{ width }} />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )}

          {conversationsStatus === "error" && (
            <p className="px-4 py-2 text-xs text-destructive">Couldn&apos;t load conversations.</p>
          )}

          {conversationsStatus === "ready" && conversations.length === 0 && (
            <p className="px-4 py-2 text-xs text-muted-foreground">No conversations yet.</p>
          )}

          {groupConversations(conversations).map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((conversation) => (
                    <SidebarMenuItem key={conversation.id}>
                      <SidebarMenuButton
                        isActive={pathname === `/chat/${conversation.id}`}
                        tooltip={conversation.lastMessagePreview}
                        render={<Link href={`/chat/${conversation.id}`} />}
                      >
                        <MessageSquare />
                        <span>{conversation.title}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label="Conversation actions" />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(conversation)}>
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </Sidebar>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; and all its messages will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={isDeleting} onClick={confirmDelete}>
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
