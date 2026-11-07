"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

export type FileKind = "pdf" | "docx" | "txt" | "md";

export function fileKind(filename: string, fileType?: string | null): FileKind {
  const ext = (fileType || filename.slice(filename.lastIndexOf(".") + 1)).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "md" || ext === "markdown") return "md";
  return "txt";
}

export const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", docx: "DOCX", txt: "TXT", md: "MD" };

// §5.5 tile colours: PDF red, DOCX blue, TXT/MD slate. Tokens keep it right in dark mode.
const KIND_TONE: Record<FileKind, string> = {
  pdf: "bg-bad-soft text-bad",
  docx: "bg-info-soft text-info",
  txt: "bg-panel-2 text-muted",
  md: "bg-panel-2 text-muted",
};

/** Decorative file-type tile; the filename next to it already carries the extension. */
export function TypeTile({ kind }: { kind: FileKind }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-semibold tracking-tight",
        KIND_TONE[kind],
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

/** A clock that re-renders every `intervalMs`, for relative times and "after 30s" sub-labels. */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}

/** Relative time with the absolute date and time in `title`. */
export function RelativeTime({ ms, now }: { ms: number; now: number }) {
  const date = new Date(ms);
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    >
      {relativeTime(ms, now)}
    </time>
  );
}

export function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

/** Centred empty or explained state. */
export function EmptyBlock({
  icon,
  title,
  description,
  action,
  as: Heading = "h2",
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-panel-2 text-muted">{icon}</span>
      <Heading
        className={cx(
          "mt-4 font-semibold text-balance [overflow-wrap:anywhere]",
          Heading === "h1" ? "text-[28px]/9 tracking-tight" : "text-base",
        )}
      >
        {title}
      </Heading>
      {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** §5.9: nothing for the first 300ms, then a static skeleton (never flash an empty state). */
export function DelayedSkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="mt-6 space-y-2">
      <span className="sr-only">Loading your documents…</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden="true" className="flex h-[72px] items-center gap-3 rounded-xl border border-border bg-panel px-4">
          <span className="h-9 w-9 rounded-lg bg-panel-2" />
          <span className="h-3 w-1/3 rounded bg-panel-2" />
        </div>
      ))}
    </div>
  );
}

export const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium " +
  "text-accent-contrast transition-[opacity,scale] duration-150 hover:opacity-90 active:scale-[.98] active:duration-100 " +
  "pointer-coarse:h-11";

export const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-panel px-4 " +
  "text-sm font-medium text-text transition-colors duration-150 hover:bg-panel-2 pointer-coarse:h-11";
