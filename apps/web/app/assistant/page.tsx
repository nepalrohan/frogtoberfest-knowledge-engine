import {
  Avatar,
  AvatarFallback,
  Bubble,
  BubbleContent,
  Button,
  Card,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui";
import { PageHeader } from "@/app/components/page-header";
import { getNotionStatus } from "@/lib/api";
import { ASSISTANT_GREETING, getAvailableDocuments, SUGGESTIONS } from "@/lib/sample-data";
import { Composer } from "./composer";

/* No chat backend yet: the thread shows the reference's opening message and sending is disabled */
export default async function AssistantPage() {
  const notion = await getNotionStatus();
  const documentCount = getAvailableDocuments(Boolean(notion?.connected)).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Assistant" description="Answers come only from synced documents, with sources." />
      <Card className="h-[calc(100vh-190px)] min-h-105 gap-0 py-0">
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent>
                <MessageScrollerItem messageId="greeting">
                  <Message align="start">
                    <MessageAvatar>
                      <Avatar className="size-7.5">
                        <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">
                          KE
                        </AvatarFallback>
                      </Avatar>
                    </MessageAvatar>
                    <MessageContent>
                      <Bubble variant="muted">
                        <BubbleContent>{ASSISTANT_GREETING}</BubbleContent>
                      </Bubble>
                      <MessageFooter>Assistant</MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
        <div className="flex flex-col gap-2.5 border-t p-3">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((text) => (
              <Button key={text} variant="chip" size="chip" disabled>
                {text}
              </Button>
            ))}
          </div>
          <Composer documentCount={documentCount} />
        </div>
      </Card>
    </div>
  );
}
