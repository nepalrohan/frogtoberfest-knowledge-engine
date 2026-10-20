import type { Metadata } from "next";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { ChatProvider } from "@/components/chat/chat-provider";
import { ChatSidebar } from "@/components/chat/chat-sidebar";

export const metadata: Metadata = {
  title: "Chat — Knowledge Engine",
  description: "Ask grounded questions over ingested engineering docs, incidents, and policies.",
};

/* Chat shell: conversation sidebar plus the active conversation, sharing one stream-owning provider */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <TooltipProvider>
        <SidebarProvider>
          <ChatSidebar />
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </ChatProvider>
  );
}
