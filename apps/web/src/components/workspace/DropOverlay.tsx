"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
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
        "pointer-events-none fixed inset-4 z-50 grid place-items-center rounded-3xl bg-accent/8 p-6 backdrop-blur-[2px]",
        "transition-[opacity,visibility] ease-(--ease-snappy)",
        dragging ? "visible opacity-100 duration-120" : "invisible opacity-0 duration-100",
      )}
    >
      <svg
        className={cx(
          "absolute top-px left-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible",
          canUpload ? "text-dropzone-border" : "text-border-strong",
        )}
      >
        <rect width="100%" height="100%" rx="23" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 8" />
      </svg>

      <div className="relative flex max-w-md flex-col items-center rounded-2xl bg-panel/90 px-8 py-7 text-center shadow-elev-3">
        <Icon
          name={canUpload ? "upload" : "lock"}
          width={48}
          height={48}
          strokeWidth={1.5}
          className={canUpload ? "text-accent" : "text-muted"}
        />
        {canUpload ? (
          <>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-text">Drop files to add them</p>
            <p className="mt-2 text-sm text-muted">
              {inChat ? "They go to My documents and this chat" : "They go to My documents"} · PDF, Word, text or
              Markdown · up to 25 MB each, 20 at a time
            </p>
          </>
        ) : (
          <>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-text">
              {roleLabel ? `${roleLabel}s can't add documents` : "Your role can't add documents"}
            </p>
            <p className="mt-2 text-sm text-muted">
              {me.permissions.includes("chat:use") ? "You can ask about documents already here. " : ""}
              An Engineer or Admin can add files.
            </p>
            {canSwitchToEngineer && (
              <p className="mt-4 rounded-full border border-demo-border bg-demo-bg px-3 py-1 text-[13px] text-demo-fg">
                <strong className="font-semibold">Switch to Engineer</strong> with Switch persona at the top of the page
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
