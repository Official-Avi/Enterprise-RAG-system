"use client";

import { useEffect } from "react";
import { NoAccess } from "@/components/Can";
import { LibraryView } from "@/components/workspace/library/LibraryView";
import { AuditorState } from "@/components/workspace/library/states";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";

/** /library, "My documents" (§6). Needs collection:read plus chat:use or document:upload (§2.1);
 *  auditors get the explained §5.9-E state pointing at the console's Documents page. */
export default function LibraryPage() {
  const { me, canChat, canUpload, persona } = useWorkspace();

  useEffect(() => {
    document.title = "My documents · RackFlow AI";
  }, []);

  if (me.permissions.includes("collection:read") && (canChat || canUpload)) return <LibraryView />;
  if (me.role === "auditor") return <AuditorState isDemo={persona !== null} />;
  return <NoAccess page="My documents" permission="chat:use" />;
}
