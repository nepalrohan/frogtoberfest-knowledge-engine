"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
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
  Spinner,
} from "@repo/ui";
import { connectNotion, disconnectNotion } from "../actions";

/* Connected: page selection + disconnect with confirmation. Otherwise: connect. */
export function NotionActions({ connected }: { connected: boolean }) {
  if (!connected) {
    return (
      <form action={connectNotion}>
        <ConnectButton />
      </form>
    );
  }

  return (
    <>
      <Button variant="outline" nativeButton={false} render={<Link href="/integrations/notion/pages" />}>
        Choose pages
      </Button>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive-outline" />}>
          Disconnect
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Notion?</AlertDialogTitle>
            <AlertDialogDescription>
              Syncing stops and the access token is deleted. Synced documents are
              removed from the assistant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={disconnectNotion}>
            <AlertDialogFooter>
              <AlertDialogCancel size="compact">Cancel</AlertDialogCancel>
              <DisconnectButton />
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* Pending stays true while the browser follows the redirect to Notion */
function ConnectButton() {
  const { pending } = useFormStatus();
  return (
    /* The reference keeps full opacity while connecting */
    <Button type="submit" disabled={pending} className="disabled:opacity-100">
      {pending && <Spinner data-icon="inline-start" />}
      {pending ? "Connecting…" : "Connect"}
    </Button>
  );
}

function DisconnectButton() {
  const { pending } = useFormStatus();
  return (
    <AlertDialogAction type="submit" variant="destructive" size="compact" disabled={pending}>
      {pending && <Spinner data-icon="inline-start" />}
      Disconnect
    </AlertDialogAction>
  );
}
