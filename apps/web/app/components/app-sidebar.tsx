import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui";
import { getNotionStatus } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { SAMPLE_USER } from "@/lib/sample-data";
import { SidebarNav } from "./sidebar-nav";

export async function AppSidebar() {
  /* Counts are best-effort: an unreachable backend shows 0 rather than breaking the shell */
  const [notion, documents] = await Promise.all([
    getNotionStatus(),
    apiClient.ingestion.listDocuments().catch(() => []),
  ]);
  const notionConnected = Boolean(notion?.connected);

  return (
    <nav className="sticky top-0 flex h-screen flex-col gap-0.5 border-r px-2.5 py-4">
      <div className="flex items-center gap-2.25 px-2.5 pb-4.5">
        <div className="size-4.5 rounded-[5px] bg-primary" />
        <span className="font-semibold">Knowledge Engine</span>
      </div>

      <SidebarNav
        sourceCount={notionConnected ? 1 : 0}
        documentCount={documents.length}
      />

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="h-auto w-full justify-start gap-2.5 p-2 text-left" />}
        >
          <UserAvatar bordered />
          <UserIdentity />
          <span aria-hidden className="text-[11px] text-muted-foreground">⌃</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" sideOffset={6}>
          <div className="flex items-center gap-2.5 p-2">
            <UserAvatar />
            <UserIdentity />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem>View profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {/* No auth backend yet, so there is nothing to log out of */}
            <DropdownMenuItem variant="destructive" disabled>
              Log out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

/* Square 32px avatar from the design; the trigger copy carries a border, the menu header doesn't */
function UserAvatar({ bordered = false }: { bordered?: boolean }) {
  return (
    <Avatar className={bordered ? "rounded-lg after:rounded-lg" : "rounded-lg after:hidden"}>
      <AvatarFallback className="rounded-lg text-xs font-semibold text-foreground">
        {SAMPLE_USER.initials}
      </AvatarFallback>
    </Avatar>
  );
}

function UserIdentity() {
  return (
    <div className="min-w-0 flex-1 leading-[1.3]">
      <div className="text-[13px] font-medium">{SAMPLE_USER.name}</div>
      <div className="truncate text-xs font-normal text-muted-foreground">{SAMPLE_USER.email}</div>
    </div>
  );
}
