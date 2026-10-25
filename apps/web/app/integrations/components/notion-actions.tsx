"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Input,
  Spinner,
  toast,
} from "@repo/ui";
import { api } from "@/lib/api";

/* Connected: page selection + disconnect with confirmation. Otherwise: OAuth or direct Token connect. */
export function NotionActions({
  connected,
  selectedPagesCount,
}: {
  connected: boolean;
  selectedPagesCount?: number;
}) {
  const router = useRouter();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  /* Token Modal State */
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [token, setToken] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [isSubmittingToken, setIsSubmittingToken] = useState(false);

  /* Standard API call to initiate OAuth redirect */
  async function handleOAuthConnect() {
    setIsAuthorizing(true);
    try {
      const response = await api.notion.authorize();
      window.location.href = response.authorizationUrl;
    } catch (error) {
      console.error("Failed to initiate Notion OAuth", error);
      toast.error("Could not initiate Notion authorization. Check that backend is running.");
      setIsAuthorizing(false);
    }
  }

  /* Standard API call to disconnect Notion */
  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await api.notion.disconnect();
      toast.info("Notion workspace disconnected");
      router.refresh();
    } catch (error) {
      console.error("Failed to disconnect Notion", error);
      toast.error("Could not disconnect Notion. Please try again.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  /* Standard API call to connect via Internal Integration Token */
  async function handleTokenConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      toast.error("Please enter a Notion Integration Secret");
      return;
    }

    setIsSubmittingToken(true);
    try {
      const res = await api.notion.connectWithToken(
        token.trim(),
        workspaceName.trim() || undefined,
      );
      toast.success(`Notion workspace “${res.workspaceName}” connected`);
      setIsTokenModalOpen(false);
      setToken("");
      setWorkspaceName("");
      router.refresh();
    } catch (error) {
      console.error("Failed to connect Notion with token", error);
      toast.error("Invalid Notion token or insufficient permissions");
    } finally {
      setIsSubmittingToken(false);
    }
  }

  if (!connected) {
    return (
      <div className="flex items-center gap-2">
        <Button
          onClick={handleOAuthConnect}
          disabled={isAuthorizing}
          size="compact"
        >
          {isAuthorizing && <Spinner data-icon="inline-start" />}
          {isAuthorizing ? "Connecting…" : "Connect"}
        </Button>

        <AlertDialog open={isTokenModalOpen} onOpenChange={setIsTokenModalOpen}>
          <AlertDialogTrigger render={<Button variant="outline" size="compact" />}>
            Connect with Token
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-md">
            <form onSubmit={handleTokenConnect} className="space-y-4">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base font-semibold">
                  Connect Notion with Integration Token
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
                  Use an Internal Integration Token from your Notion workspace to connect without
                  being forced to select documents upfront.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-3.5 py-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground block">
                    Internal Integration Secret <span className="text-destructive">*</span>
                  </label>
                  <Input
                    name="token"
                    type="password"
                    placeholder="secret_... or ntn_..."
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Generated in Notion Settings &amp; Members → Integrations.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground block">
                    Workspace Name <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Input
                    name="workspaceName"
                    type="text"
                    placeholder="e.g. Acme Workspace"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                  />
                </div>
              </div>

              <AlertDialogFooter className="pt-2">
                <AlertDialogCancel size="compact" disabled={isSubmittingToken}>
                  Cancel
                </AlertDialogCancel>
                <Button
                  type="submit"
                  size="compact"
                  disabled={isSubmittingToken}
                >
                  {isSubmittingToken && <Spinner data-icon="inline-start" />}
                  {isSubmittingToken ? "Connecting…" : "Connect Workspace"}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="compact"
        nativeButton={false}
        render={<Link href="/integrations/notion/pages" />}
      >
        Choose pages{selectedPagesCount !== undefined && selectedPagesCount > 0 ? ` (${selectedPagesCount})` : ""}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive-outline" size="compact" />}>
          Disconnect
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">Disconnect Notion?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Syncing stops and the access token is removed from secure storage.
              Previously indexed documents will be removed from the assistant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel size="compact" disabled={isDisconnecting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              variant="destructive"
              size="compact"
              disabled={isDisconnecting}
            >
              {isDisconnecting && <Spinner data-icon="inline-start" />}
              {isDisconnecting ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
