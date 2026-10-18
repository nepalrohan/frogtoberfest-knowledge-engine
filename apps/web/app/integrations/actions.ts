"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

/* Starts Notion OAuth; the backend callback redirects back to /integrations with the outcome */
export async function connectNotion() {
  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await api.notion.authorize());
  } catch {
    redirect("/integrations?status=error&message=authorize_failed");
  }
  redirect(authorizationUrl);
}

export async function disconnectNotion() {
  try {
    await api.notion.disconnect();
  } catch {
    redirect("/integrations?status=error&message=disconnect_failed");
  }
  /* The sidebar source count lives in the root layout, so refresh from the top */
  revalidatePath("/", "layout");
  redirect("/integrations?status=disconnected");
}
