"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { AlertIcon, secondaryButtonClass } from "./parts";

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
        // design.md, Dialogs: a cut panel on the elevated shadow.
        "cut m-auto w-[min(calc(100%-32px),440px)] border border-border bg-panel p-6 text-text shadow-elev-3",
        // Graphite rather than ink: ink is light in dark mode, and the wash must dim in both.
        "backdrop:bg-[color-mix(in_oklab,var(--graphite)_55%,transparent)]",
        "transition-opacity duration-[var(--dur-short)] ease-out starting:opacity-0",
      )}
    >
      {shownName !== null && (
        <>
          <h2 id={titleId} className="text-lg [overflow-wrap:anywhere]">
            Delete {shownName}?
          </h2>
          <p id={descId} className="mt-2 text-sm text-text-2">
            You won&apos;t be able to ask about it any more.
          </p>
          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
              <AlertIcon className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button ref={cancel} type="button" onClick={onCancel} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onClick={() => {
                if (!busy) onConfirm();
              }}
              // The dialog's one destructive key: solid error fill, panel ink (design.md, Buttons).
              className={cx(
                "key border-bad bg-bad text-panel pointer-coarse:min-h-11",
                "hover:border-bad hover:bg-[color-mix(in_oklab,var(--bad)_86%,var(--text))]",
                "active:bg-[color-mix(in_oklab,var(--bad)_78%,var(--text))]",
                "aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
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
