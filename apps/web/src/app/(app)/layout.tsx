import type { Metadata } from "next";
import { Shell } from "@/components/Shell";

// Each console route has its own layout.tsx naming the page; its pages are client components.
export const metadata: Metadata = {
  title: { default: "Admin console · RackFlow AI", template: "%s · RackFlow AI" },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
