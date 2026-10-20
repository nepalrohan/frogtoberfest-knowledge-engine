"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@repo/ui";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "Notion authorization expired or was invalid. Please try connecting again.",
  missing_code: "Notion did not return an authorization code.",
  exchange_failed: "Failed to complete Notion authorization. Please try again.",
  authorize_failed: "Could not initiate Notion authorization. Check that the backend is running.",
  disconnect_failed: "Could not disconnect Notion. Please try again.",
  invalid_token: "Invalid Notion token. Check that the integration secret is correct.",
  missing_token: "Please enter an integration secret.",
};

/* Listens to status query parameters after OAuth/Token redirects and triggers Sonner toasts */
export function IntegrationToaster() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const status = searchParams.get("status");
    if (!status) return;

    const workspace = searchParams.get("workspace");
    const message = searchParams.get("message");
    const error = searchParams.get("error");

    if (status === "success") {
      toast.success(
        workspace
          ? `Notion workspace “${workspace}” connected successfully`
          : "Notion connected successfully",
      );
    } else if (status === "disconnected") {
      toast.info("Notion workspace disconnected");
    } else if (status === "cancelled") {
      toast.warning("Notion authorization was cancelled. No changes were made.");
    } else if (status === "error") {
      const errText =
        (message && ERROR_MESSAGES[message]) ||
        error ||
        "Something went wrong connecting to Notion.";
      toast.error(errText);
    }

    /* Clean URL query without re-rendering or navigating away */
    const newUrl = window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }, [searchParams, router]);

  return null;
}
