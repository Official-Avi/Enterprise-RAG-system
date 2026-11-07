import type { Metadata } from "next";
import type { ReactNode } from "react";

// The chat routes replace this with the chat's title once it has loaded (ask page).
export const metadata: Metadata = { title: "Ask" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
