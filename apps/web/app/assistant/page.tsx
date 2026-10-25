import { redirect } from "next/navigation";

/* The assistant lives at /chat; kept so old links still land on it */
export default function AssistantPage() {
  redirect("/chat");
}
