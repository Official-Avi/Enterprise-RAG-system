"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { ApiError } from "@/lib/api";
import { Icon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-contrast hover:opacity-90 border-transparent",
    secondary: "bg-panel text-text border-border hover:bg-panel-2",
    danger: "bg-panel text-bad border-border hover:bg-bad-soft",
    ghost: "bg-transparent text-muted border-transparent hover:bg-panel-2 hover:text-text",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        // aria-disabled keeps a focused control focusable (§9 #5); the caller guards the click.
        "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

// --border-strong keeps the control boundary at >= 3:1 (§9 #14); 16px text below md stops
// iOS zooming into a focused field (§10).
export const inputClass =
  "w-full rounded-md border border-border-strong bg-panel px-3 py-1.5 text-base text-text md:text-sm " +
  "placeholder:text-muted";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "accent";

const toneStyles: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-panel-2 text-muted",
  accent: "bg-accent-soft text-accent",
};

const statusMap: Record<string, [Tone, string, string]> = {
  // status: [tone, glyph, label]  — glyph + label make status readable without colour.
  queued: ["neutral", "○", "Queued"],
  processing: ["info", "◐", "Processing"],
  running: ["info", "◐", "Running"],
  retry_wait: ["warn", "↻", "Retry wait"],
  indexed: ["ok", "✓", "Indexed"],
  succeeded: ["ok", "✓", "Succeeded"],
  supported: ["ok", "✓", "Evidence found"],
  healthy: ["ok", "✓", "Healthy"],
  failed: ["bad", "✕", "Failed"],
  insufficient: ["warn", "!", "Insufficient evidence"],
  stale: ["warn", "!", "Stale"],
  cancelled: ["neutral", "⊘", "Cancelled"],
  deleting: ["warn", "⌫", "Deleting"],
  deleted: ["neutral", "⌫", "Deleted"],
  stopped: ["neutral", "■", "Stopped"],
  skipped: ["neutral", "–", "Skipped"],
  abandoned: ["warn", "!", "Abandoned"],
  simulated: ["info", "◇", "Simulated"],
  manual: ["accent", "✎", "Configured"],
  integration: ["ok", "⇄", "Integration-reported"],
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [tone, glyph, text] = statusMap[status] ?? ["neutral", "•", status];
  return (
    <span
      className={cx(
        // `badge` gets a CanvasText border in forced-colors mode (globals.css).
        "badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        "whitespace-nowrap",
        toneStyles[tone],
      )}
    >
      <span aria-hidden="true">{glyph}</span>
      {label ?? text}
    </span>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("badge rounded px-1.5 py-0.5 text-xs font-medium", toneStyles[tone])}>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-border bg-panel", className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="py-8 text-center text-sm text-muted">
      {label}
    </div>
  );
}

/** Empty state. `children` stays the body for existing callers; the optional slots (§11) add an
 *  icon, a description and up to two actions. */
export function Empty({
  title,
  children,
  icon,
  description,
  primary,
  secondary,
  variant = "dashed",
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  variant?: "dashed" | "plain";
}) {
  const body = description ?? children;
  return (
    <div
      className={cx(
        "rounded-lg px-6 py-10 text-center",
        variant === "dashed" && "border border-dashed border-border",
      )}
    >
      {icon && (
        <div aria-hidden="true" className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-panel-2 text-muted">
          {icon}
        </div>
      )}
      <p className="font-medium">{title}</p>
      {body && <div className="mt-1 text-sm text-muted">{body}</div>}
      {(primary || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {primary}
          {secondary}
        </div>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const denied = e?.status === 403;
  return (
    <div role="alert" className="rounded-lg border border-border bg-bad-soft px-4 py-3 text-sm">
      <p className="font-medium text-bad">
        {denied ? "You don't have permission to view this." : (e?.message ?? "Something went wrong.")}
      </p>
      {e?.correlationId && (
        <p className="mt-0.5 font-mono text-xs text-muted">Correlation ID: {e.correlationId}</p>
      )}
      {onRetry && !denied && (
        <Button className="mt-2" onClick={onRetry}>
          <Icon name="refresh" /> Retry
        </Button>
      )}
    </div>
  );
}

const FIRST_FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Hand focus back to the opener, unless the page has already moved it somewhere on purpose. */
function restoreFocus(dialog: HTMLDialogElement, opener: RefObject<HTMLElement | null>) {
  const active = document.activeElement;
  const lost = !active || active === document.body || dialog.contains(active);
  if (lost && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
}

/** Native modal <dialog> (§9 #10, §11): showModal from an effect traps focus and makes the page
 *  behind inert. Initial focus: an element marked `data-autofocus`, else the first form field,
 *  else the heading. Esc closes and focus returns to the opener. Children render only while
 *  open, so a form starts fresh every time. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // A layout effect, so closing never paints an empty box between unmounting the children
  // and dialog.close().
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      dialog.showModal();
      const target =
        dialog.querySelector<HTMLElement>("[data-autofocus]") ??
        dialog.querySelector<HTMLElement>(FIRST_FIELD) ??
        headingRef.current;
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Pages unmount some dialogs while open (job details, run details). A removed <dialog> fires
  // no close event, so focus is handed back here. Strict Mode's rehearsal keeps the node
  // connected, which is why the check is isConnected rather than dialog.open.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog && !dialog.isConnected) restoreFocus(dialog, openerRef);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        const dialog = ref.current;
        if (dialog) restoreFocus(dialog, openerRef);
        // Esc closed it natively: tell the owner so its state follows. When the owner closed
        // it, `open` is already false here.
        if (open) onClose();
      }}
      className={cx(
        "m-auto mt-[8vh] max-h-[84vh] w-[calc(100%-2rem)] overflow-auto rounded-2xl border border-border",
        "bg-panel p-0 text-text shadow-elev-3 backdrop:bg-black/40",
        "transition-opacity duration-200 ease-[var(--ease-snappy)] starting:open:opacity-0",
        wide ? "max-w-3xl" : "max-w-md",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border py-1.5 pl-4 pr-1.5">
        <h2 ref={headingRef} id={titleId} tabIndex={-1} className="min-w-0 font-semibold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className={cx(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted",
            "transition-colors hover:bg-panel-2 hover:text-text max-sm:size-11",
          )}
        >
          <Icon name="close" />
        </button>
      </header>
      {open && <div className="p-4">{children}</div>}
    </dialog>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cx(
        "border-b border-border px-3 py-2 text-left text-xs font-medium uppercase",
        "tracking-wide text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("border-b border-border px-3 py-2 align-top", className)}>{children}</td>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-panel">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function UpdatedAt({ at }: { at?: number }) {
  if (!at) return null;
  return (
    <span className="text-xs text-muted">
      Updated {new Date(at).toLocaleTimeString()}
    </span>
  );
}
