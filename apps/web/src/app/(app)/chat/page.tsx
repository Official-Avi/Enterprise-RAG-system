import { redirect } from "next/navigation";

// Chat moved to the /ask workspace (§7 #1). next.config.ts normally redirects /chat first.
export default function ChatPage() {
  redirect("/ask");
}
