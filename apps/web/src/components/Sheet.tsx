"use client";

import { useEffect, useId, useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

// Marks the history entry pushed while a bottom sheet is open, so browser Back closes it (§5.7).
const HISTORY_KEY = "__rackflowSheet";
// Entries this module has already backed out of. Landing on one (a back() still in flight when
// a new sheet opens) is not the user pressing Back.
const retired = new Set<string>();

const SIDE_CLASS = {
  bottom: cx(
    "inset-x-0 top-auto bottom-0 w-full max-w-none max-h-[85dvh] rounded-t-2xl border-t",
    "pb-[env(safe-area-inset-bottom)]",
    "translate-y-full open:translate-y-0 starting:open:translate-y-full",
  ),
  right: cx(
    "inset-y-0 right-0 left-auto h-dvh max-h-none w-[360px] max-w-full border-l",
    "translate-x-full open:translate-x-0 starting:open:translate-x-full",
  ),
} as const;

function isOutside(dialog: HTMLDialogElement, x: number, y: number): boolean {
  const r = dialog.getBoundingClientRect();
  return x < r.left || x > r.right || y < r.top || y > r.bottom;
}

/** Native <dialog> (showModal from an effect) as a bottom sheet or right drawer (§5.7, §9 #10).
 *  Initial focus goes to the title (long content); an element marked `data-autofocus` wins. */
export function Sheet({
  open,
  onClose,
  title,
  side = "bottom",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "bottom" | "right";
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const downOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
    openRef.current = open;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      dialog.showModal();
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? headingRef.current)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Unmounting while open (e.g. a breakpoint change) still hands focus back.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) restoreFocus(dialog, openerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || side !== "bottom") return;
    const token = Math.random().toString(36).slice(2);
    const href = window.location.href;
    // Spreading the router's own state keeps Next.js navigation intact for this entry.
    window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: token }, "");
    const onPop = () => {
      const current = window.history.state?.[HISTORY_KEY];
      if (current === token || (current && retired.has(current))) return;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way: drop our entry, unless the user has navigated somewhere else.
      if (window.history.state?.[HISTORY_KEY] === token && window.location.href === href) {
        retired.add(token);
        window.history.back();
      }
    };
  }, [open, side]);

  const onNativeClose = () => {
    const dialog = dialogRef.current;
    if (dialog) restoreFocus(dialog, openerRef.current);
    // Esc, or the browser forcing the dialog shut: tell the owner so its state follows.
    if (openRef.current) onCloseRef.current();
  };

  const onPointerDown = (e: PointerEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    downOnBackdrop.current = !!dialog && e.target === dialog && isOutside(dialog, e.clientX, e.clientY);
  };

  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    // Clicks on ::backdrop target the dialog itself; the rect test ignores its own padding.
    const backdrop = !!dialog && e.target === dialog && isOutside(dialog, e.clientX, e.clientY);
    if (backdrop && downOnBackdrop.current) onClose();
    downOnBackdrop.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onNativeClose}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cx(
        "fixed m-0 overflow-hidden border-border bg-panel text-text shadow-elev-3 backdrop:bg-black/40",
        "transition-[translate,overlay,display] transition-discrete duration-200 open:duration-[260ms]",
        "ease-[var(--ease-drawer)]",
        SIDE_CLASS[side],
      )}
    >
      <div
        className={cx(
          "flex flex-col",
          side === "bottom" ? "max-h-[calc(85dvh-env(safe-area-inset-bottom))]" : "h-full",
        )}
      >
        {side === "bottom" && (
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
        )}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-1.5">
          <h2
            ref={headingRef}
            id={titleId}
            tabIndex={-1}
            className="min-w-0 truncate text-base font-semibold"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cx(
              "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted",
              "transition-colors hover:bg-panel-2 hover:text-text",
            )}
          >
            <Icon name="close" width={20} height={20} />
          </button>
        </header>
        <div data-scroll-container className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {children}
        </div>
      </div>
    </dialog>
  );
}

function restoreFocus(dialog: HTMLDialogElement, opener: HTMLElement | null) {
  const active = document.activeElement;
  // Only when focus was left in the dialog or dropped to <body>; never steal it from a target
  // the page chose (e.g. "Back to answer" focusing the chip).
  const lost = !active || active === document.body || dialog.contains(active);
  if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
}
