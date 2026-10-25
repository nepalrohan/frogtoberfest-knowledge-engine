import { ChatView } from "@/components/chat/chat-view";

/* New conversation; the URL moves to /chat/[id] once the server assigns an id */
export default function NewChatPage() {
  return <ChatView conversationId={null} />;
}
