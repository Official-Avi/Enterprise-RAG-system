"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/demo";
import { useFileDrop } from "@/lib/useFileDrop";
import { useUploads } from "./UploadsContext";
import { useWorkspace } from "./WorkspaceContext";

const COARSE_QUERY = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void): () => void {
  const mq = window.matchMedia(COARSE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** §10: touch devices get no drag overlay; they use the picker. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE_QUERY).matches,
    () => false,
  );
}

/** Full-window drag overlay (§5.5). Uses useFileDrop; sends files to useUploads().add, or shows
 *  the Operator explanation. No overlay on touch. */
export function DropOverlay() {
  const uploads = useUploads();
  const { me, persona, demo } = useWorkspace();
  const pathname = usePathname();
  const coarse = useCoarsePointer();
  const { dragging } = useFileDrop({
    enabled: uploads.canUpload,
    onFiles: (files) => void uploads.add(files),
  });

  // dropEffect "none" means no drop event, so the drag ending is the only signal an Operator gets.
  // Without upload rights pickFiles() leaves the explanation in the composer, where "Switch to
  // Engineer" can be a real control (nothing in this pointer-events-none overlay can be).
  const { canUpload: mayUpload, pickFiles } = uploads;
  const wasDragging = useRef(false);
  useEffect(() => {
    if (wasDragging.current && !dragging && !mayUpload) pickFiles();
    wasDragging.current = dragging;
  }, [dragging, mayUpload, pickFiles]);

  // Files still land on touch devices (e.g. iPad drag from Files); only the visual is skipped.
  if (coarse) return null;

  const canUpload = uploads.canUpload;
  const roleLabel = ROLE_LABEL[me.role];
  const canSwitchToEngineer = persona !== null && demo?.personas.some((p) => p.key === "engineer") === true;
  // The overlay also covers /library, where there is no chat to add the files to.
  const inChat = !pathname?.startsWith("/library");

  return (
    <div
      aria-hidden="true"
      className={cx(
        // The whole window becomes one dropzone: a dashed edge at 3:1 over a light accent wash.
        "pointer-events-none fixed inset-4 z-[var(--z-modal)] grid place-items-center rounded-card p-6",
        "border-2 border-dashed bg-[color-mix(in_oklab,var(--accent-soft)_70%,transparent)] backdrop-blur-[2px]",
        canUpload ? "border-dropzone-border" : "border-border-strong",
        "transition-[opacity,visibility] ease-out",
        dragging ? "visible opacity-100 duration-(--dur-micro)" : "invisible opacity-0 duration-(--dur-micro)",
      )}
    >
      <div className="cut relative flex w-full max-w-md flex-col items-start border border-border bg-panel px-8 py-7 shadow-elev-3">
        <Icon
          name={canUpload ? "upload" : "lock"}
          width={24}
          height={24}
          className={canUpload ? "text-accent" : "text-muted"}
        />
        {canUpload ? (
          <>
            <p className="mt-3 font-display text-xl font-semibold tracking-head text-text">Drop files to add them</p>
            <p className="mt-2 text-sm text-text-2">
              {inChat ? "They go to My documents and this chat." : "They go to My documents."}
            </p>
            <p className="mt-1 text-sm text-muted">PDF, Word, text or Markdown, up to 25 MB each, 20 at a time.</p>
          </>
        ) : (
          <>
            <p className="mt-3 font-display text-xl font-semibold tracking-head text-text">
              {roleLabel ? `${roleLabel}s can't add documents` : "Your role can't add documents"}
            </p>
            <p className="mt-2 text-sm text-text-2">
              {me.permissions.includes("chat:use") ? "You can ask about documents already here. " : ""}
              An Engineer or Admin can add files.
            </p>
            {canSwitchToEngineer && (
              <p className="mt-4 rounded-chip border border-demo-border bg-demo-bg px-3 py-1.5 text-sm text-demo-fg">
                <strong className="font-semibold">Switch to Engineer</strong> with Switch persona at the top of the page
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
