"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
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
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium",
        "disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export const inputClass =
  "w-full rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-text " +
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
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
    <span className={cx("rounded px-1.5 py-0.5 text-xs font-medium", toneStyles[tone])}>
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

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      if (ev.key === "Tab") {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[8vh]">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "max-h-[84vh] w-full overflow-auto rounded-lg border border-border bg-panel shadow-xl",
          wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
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
