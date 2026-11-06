import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

// Each route's title comes from metadata: on a client navigation Next mounts the metadata <title>
// after the page's effects, so a document.title set in a mount effect is overwritten (§9 #17).
export const metadata: Metadata = {
  title: { default: "RackFlow AI", template: "%s · RackFlow AI" },
};

/** /ask and /library share one client frame (§5.1), so moving between them keeps the sidebar,
 *  in-flight uploads and the dropped-file hand-off alive. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
