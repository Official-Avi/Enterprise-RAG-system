"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { secondaryButtonClass } from "./parts";

/** §6 delete confirmation: native <dialog>.showModal(), Cancel focused (§9 #10). */
export function ConfirmDelete({
  filename,
  busy,
  error,
  onCancel,
  onConfirm,
  fallbackFocus,
}: {
  /** The file to delete; null keeps the dialog closed. */
  filename: string | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Where focus goes on close when the element that opened the dialog is gone (the deleted
   *  row's "⋯" button). */
  fallbackFocus?: () => HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const open = filename !== null;
  // Keep the last name so the content doesn't blank out for a frame while the dialog closes.
  const [shownName, setShownName] = useState(filename);
  if (filename !== null && filename !== shownName) setShownName(filename);
  const refocus = useEffectEvent(() => {
    const d = dialog.current;
    const active = document.activeElement;
    if (!active || active === document.body || d?.contains(active)) fallbackFocus?.()?.focus();
  });

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancel.current?.focus();
    } else if (!open && d.open) {
      // close() returns focus to the opener when it still exists.
      d.close();
      refocus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        // Esc: keep the dialog while the request is in flight.
        if (busy) e.preventDefault();
      }}
      onClose={() => {
        if (open) onCancel();
      }}
      className={cx(
        "m-auto w-[min(calc(100%-32px),420px)] rounded-2xl border border-border bg-panel p-6 text-text shadow-elev-3",
        "backdrop:bg-black/40 transition-opacity duration-200 ease-[var(--ease-snappy)] starting:opacity-0",
      )}
    >
      {shownName !== null && (
        <>
          <h2 id={titleId} className="text-base font-semibold [overflow-wrap:anywhere]">
            Delete {shownName}?
          </h2>
          <p id={descId} className="mt-2 text-sm text-muted">
            You won&apos;t be able to ask about it any more.
          </p>
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button ref={cancel} type="button" onClick={onCancel} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onConfirm();
              }}
              className={cx(
                "inline-flex h-9 items-center justify-center rounded-lg border border-border-strong bg-panel px-4",
                "text-sm font-medium text-bad transition-colors duration-150 hover:bg-bad-soft pointer-coarse:h-11",
                "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
              )}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
