import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

/** /ask and /library share one client frame (§5.1), so moving between them keeps the sidebar,
 *  in-flight uploads and the dropped-file hand-off alive. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
