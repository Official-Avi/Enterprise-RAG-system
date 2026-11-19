"use client";

import Link from "next/link";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { ApiError } from "@/lib/api";
import { MeContext } from "@/lib/hooks";
import { Icon, type IconName } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

type Size = "md" | "sm";

// Keys (.key, .key-primary, .key-danger in globals.css) carry their own hover lift, press,
// disabled and busy states. md is 40px on desktop (the height of a field beside it; the ghost
// key keeps a quieter 36px); sm is the 32px table-row action. All grow to 44px under sm. Only one
// height class is ever emitted, since cx does not merge classes and min-h-10 would beat min-h-8.
const SIZE: Record<Size, string> = {
  md: "min-h-10 px-3 max-sm:min-h-11",
  sm: "min-h-8 px-3 text-xs max-sm:min-h-11",
};
const GHOST_MD = "min-h-9 px-3 max-sm:min-h-11";
const VARIANT: Record<Variant, string> = {
  primary: "key key-primary",
  secondary: "key",
  danger: "key key-danger hover:border-bad",
  ghost: cx(
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium text-text-2",
    "transition-colors duration-(--dur-micro) ease-out hover:bg-panel-2 hover:text-text active:bg-panel-3",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    "aria-busy:cursor-progress",
  ),
};

/** The confirming key of a destructive dialog: that dialog's one primary, red fill and panel ink. */
export const confirmDangerClass = "border-bad bg-bad text-panel hover:border-bad";

/** Ghost square icon control (dialog and sheet close, menu toggles). Needs an aria-label. */
export const iconButtonClass = cx(
  "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted max-sm:size-11",
  "transition-colors duration-(--dur-micro) ease-out hover:bg-panel-2 hover:text-text active:bg-panel-3",
);

/** Tertiary action: a text button in the accent that underlines on hover. */
export const textButtonClass = cx(
  "inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-accent sm:min-h-8",
  "underline-offset-4 decoration-1 hover:underline active:text-accent-hover",
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
);

/** Small spinner for busy keys and live statuses. `delay` holds it back so quick requests never flash. */
export function Spinner({ size = 16, delay = 0, className }: { size?: number; delay?: number; className?: string }) {
  const [shown, setShown] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const t = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  if (!shown) return null;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={cx("shrink-0 motion-safe:animate-spin", className)}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean }) {
  return (
    <button
      // aria-disabled keeps a focused control focusable (§9 #5); the caller guards the click.
      aria-busy={busy || undefined}
      className={cx(
        VARIANT[variant],
        variant === "ghost" && size === "md" ? GHOST_MD : SIZE[size],
        className,
      )}
      {...props}
    >
      {busy && <Spinner delay={300} />}
      {children}
    </button>
  );
}

// --border-strong keeps the control boundary at >= 3:1 (§9 #14); 16px text below md stops
// iOS zooming into a focused field (§10); touch tablets keep 16px at md too. The border never
// changes width: hover deepens its colour, focus adds the global ring, error turns it red.
export const inputClass = cx(
  "w-full min-h-10 pointer-coarse:min-h-11 rounded-input border border-border-strong bg-panel px-3 py-2 text-base text-text pointer-fine:md:text-sm",
  "placeholder:text-muted transition-colors duration-(--dur-micro) ease-out hover:border-text-2",
  "aria-invalid:border-bad hover:aria-invalid:border-bad",
  "disabled:cursor-not-allowed disabled:bg-panel-2 disabled:opacity-55 disabled:hover:border-border-strong",
);

type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "accent";

const toneStyles: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-panel-2 text-muted",
  accent: "bg-accent-soft text-accent",
};

/** Chip shape shared by StatusBadge, Badge and StatusPill: soft fill, no border, no dot. */
export const chipClass =
  "badge inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-chip px-2 text-xs font-medium";

export type StatusGlyphName = IconName | "spin";

const statusMap: Record<string, [Tone, StatusGlyphName, string]> = {
  // status: [tone, glyph, label]  — glyph + label make status readable without colour.
  queued: ["neutral", "circle", "Queued"],
  processing: ["info", "spin", "Processing"],
  running: ["info", "spin", "Running"],
  retry_wait: ["warn", "refresh", "Retry wait"],
  indexed: ["ok", "check", "Indexed"],
  succeeded: ["ok", "check", "Succeeded"],
  supported: ["ok", "check", "Evidence found"],
  healthy: ["ok", "check", "Healthy"],
  failed: ["bad", "cross", "Failed"],
  insufficient: ["warn", "alert", "Insufficient evidence"],
  conversational: ["neutral", "check", "Conversation"],
  stale: ["warn", "alert", "Stale"],
  cancelled: ["neutral", "ban", "Cancelled"],
  deleting: ["warn", "trash", "Deleting"],
  deleted: ["neutral", "trash", "Deleted"],
  stopped: ["neutral", "stop", "Stopped"],
  skipped: ["neutral", "minus", "Skipped"],
  abandoned: ["warn", "alert", "Abandoned"],
  // Provenance is metadata, not state: neutral chips, told apart by glyph and label.
  simulated: ["neutral", "diamond", "Simulated"],
  manual: ["neutral", "pencil", "Configured"],
  integration: ["neutral", "swap", "Integration-reported"],
};

/** A status glyph at chip size. A live status spins; with reduced motion the ring stays still. */
export function StatusGlyph({ glyph }: { glyph: StatusGlyphName }) {
  if (glyph === "spin") return <Spinner size={12} />;
  return <Icon name={glyph} width={12} height={12} strokeWidth={2.2} className="shrink-0" />;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [tone, glyph, text] = statusMap[status] ?? (["neutral", "circle", status] as const);
  return (
    // `badge` gets a CanvasText border in forced-colors mode (globals.css).
    <span className={cx(chipClass, toneStyles[tone])}>
      <StatusGlyph glyph={glyph} />
      {label ?? text}
    </span>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx(chipClass, toneStyles[tone])}>{children}</span>;
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl wrap-anywhere">{title}</h1>
        {description && <p className="mt-1 max-w-[72ch] text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
    // min-w-0: as a grid item this must be able to shrink, so a wide table scrolls inside it
    // instead of pushing the page sideways.
    <section className={cx("min-w-0 rounded-card border border-border bg-panel", className)}>
      {title && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
          <h2 className="text-base">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    // A ruled cell, not a card: a row of these reads as one strip of figures, and it can sit
    // inside a Card without making a card in a card.
    <div className="min-w-0 border-t border-border-2 pt-3 pb-1">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl leading-tight font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    // A skeleton in the shape of a list; the label stays visible and is what gets announced.
    <div role="status" className="py-6">
      <p className="text-sm text-muted">{label}</p>
      <div aria-hidden="true" className="mt-4 space-y-3">
        <div className="h-3 w-2/5 rounded-sm bg-panel-3 motion-safe:animate-shimmer" />
        <div className="h-3 w-4/5 rounded-sm bg-panel-3 motion-safe:animate-shimmer" />
        <div className="h-3 w-3/5 rounded-sm bg-panel-3 motion-safe:animate-shimmer" />
      </div>
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
    // Left-aligned in its region: what belongs here, one sentence, the action that fills it.
    <div
      className={cx(
        "rounded-card py-8 text-left",
        variant === "dashed" ? "border border-dashed border-border-2 px-6" : "px-1",
      )}
    >
      {icon && (
        <div aria-hidden="true" className="mb-3 text-muted [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="font-display text-lg font-medium text-text">{title}</p>
      {body && <div className="mt-1 max-w-[60ch] text-sm text-text-2">{body}</div>}
      {(primary || secondary) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {primary}
          {secondary}
        </div>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const me = useContext(MeContext);
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 403) {
    // The page loaded fine and the API refused this role, so this is not an alert (§7 #4).
    const can = (p: string) => !!me?.permissions.includes(p);
    return (
      <div className="rounded-card border border-border bg-panel p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-text">
          <Icon name="lock" className="shrink-0 text-muted" /> Your role can&apos;t see this.
        </p>
        <p className="mt-1 text-text-2">An admin can change your role if you need it.</p>
        {can("chat:use") ? (
          <Link href="/ask" className={cx(textButtonClass, "mt-2")}>
            <Icon name="arrowLeft" /> Back to Ask
          </Link>
        ) : can("ops:read") ? (
          <Link href="/overview" className={cx(textButtonClass, "mt-2")}>
            Go to Overview <Icon name="arrowRight" />
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-card bg-bad-soft p-4 text-sm">
      <p className="flex items-start gap-2 font-medium text-bad">
        <Icon name="alert" className="mt-0.5 shrink-0" />
        {e?.message ?? "Something went wrong."}
      </p>
      {e?.correlationId && (
        <p className="mt-1 pl-6 text-xs text-text-2">
          Correlation ID: <span className="font-mono break-all">{e.correlationId}</span>
        </p>
      )}
      {onRetry && (
        <Button className="mt-3 ml-6" onClick={onRetry}>
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
        "cut m-auto mt-[8vh] max-h-[84vh] w-[calc(100%-2rem)] overflow-auto border border-border",
        "bg-panel p-0 text-text shadow-elev-3 backdrop:bg-[color-mix(in_oklab,var(--graphite)_55%,transparent)]",
        "transition-opacity duration-(--dur-short) ease-out starting:open:opacity-0",
        wide ? "max-w-3xl" : "max-w-md",
      )}
    >
      <header className="flex min-h-14 items-center justify-between gap-2 border-b border-border py-2 pr-2 pl-6">
        <h2 ref={headingRef} id={titleId} tabIndex={-1} className="min-w-0 text-lg">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className={iconButtonClass}
        >
          <Icon name="close" width={20} height={20} />
        </button>
      </header>
      {open && <div className="p-6">{children}</div>}
    </dialog>
  );
}

function ConfirmBody({
  children,
  confirmLabel,
  variant,
  onConfirm,
  onCancel,
}: {
  children: ReactNode;
  confirmLabel: string;
  variant: Variant;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="text-text-2">{children}</div>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-bad">
          <Icon name="alert" className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" data-autofocus onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          variant={variant}
          aria-disabled={busy || undefined}
          busy={busy}
          onClick={run}
          className={variant === "danger" ? confirmDangerClass : undefined}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** Confirm step for consequential actions (§9 #1, #10): a native dialog with Cancel focused.
 *  `onConfirm` closes it by clearing `open`; if it throws, the error shows here and it stays open. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  variant = "danger",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: Variant;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <ConfirmBody confirmLabel={confirmLabel} variant={variant} onConfirm={onConfirm} onCancel={onCancel}>
        {children}
      </ConfirmBody>
    </Dialog>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cx(
        "border-b border-border bg-panel-2 px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx("border-b border-border px-3 py-2.5 align-top", className)}>{children}</td>;
}

/** `relative` makes this box the containing block for anything position:absolute inside it, such
 *  as an sr-only "Actions" header; otherwise that text escapes the overflow clip and widens the
 *  page. While the table overflows, the box takes focus so arrow keys can scroll it (WCAG 2.1.1). */
export function TableWrap({ children, label = "Scrollable table" }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const box = ref.current;
    const table = box?.firstElementChild;
    if (!box || !table) return;
    // A ResizeObserver reports once on observe, so this also covers the first measurement.
    const observer = new ResizeObserver(() => setScrolls(box.scrollWidth > box.clientWidth));
    observer.observe(box);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={cx(
        "relative overflow-x-auto border-y border-border",
        // Row hover; the last row drops its rule because the wrapper's own border closes the table.
        "[&_tbody_tr]:transition-colors [&_tbody_tr]:duration-(--dur-micro) [&_tbody_tr:hover]:bg-panel-2",
        "[&_tbody_tr:last-child>td]:border-b-0",
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function UpdatedAt({ at }: { at?: number }) {
  if (!at) return null;
  return (
    <span className="text-xs text-muted">
      Updated <span className="font-mono tabular-nums">{new Date(at).toLocaleTimeString()}</span>
    </span>
  );
}
