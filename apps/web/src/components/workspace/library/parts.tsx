"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
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

// File-type glyphs (design.md, Icons): PDF in the error ink, everything else muted. No tinted tile.
const KIND_TONE: Record<FileKind, string> = {
  pdf: "text-bad",
  docx: "text-muted",
  txt: "text-muted",
  md: "text-muted",
};

/** Decorative file-type glyph; the filename next to it already carries the extension. */
export function TypeTile({ kind }: { kind: FileKind }) {
  return (
    <span aria-hidden="true" className={cx("grid size-9 shrink-0 place-items-center", KIND_TONE[kind])}>
      <Icon name="file" width={20} height={20} />
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

/** Warning glyph for error and refresh notes (replaces the ⚠ emoji). */
export function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.1" />
    </svg>
  );
}

/** Empty or explained state: left-aligned in its region, a plain 20px glyph, the line that says
 *  what belongs here, one sentence and one key (design.md, Empty states). */
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
    // Under the page head it hangs from a hairline; as the page itself (h1) it stands alone.
    <div className={cx("max-w-[60ch]", Heading === "h2" && "mt-6 border-t border-border pt-6")}>
      <span className="block text-muted">{icon}</span>
      <Heading
        className={cx(
          "mt-3 text-pretty [overflow-wrap:anywhere]",
          Heading === "h1" ? "text-xl" : "text-lg",
        )}
      >
        {title}
      </Heading>
      {description && <p className="mt-2 text-sm text-text-2">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** §5.9: nothing for the first 300ms, then a skeleton in the shape of the list (never flash an
 *  empty state). */
export function DelayedSkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div role="status" className="mt-6 border-t border-border">
      <span className="sr-only">Loading your documents…</span>
      {[44, 32, 52, 38].map((w, i) => (
        <div key={i} aria-hidden="true" className="flex h-16 items-center gap-3 border-b border-border px-3">
          <span className="size-5 shrink-0 animate-shimmer rounded-sm bg-panel-3" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3 animate-shimmer rounded-sm bg-panel-3" style={{ width: `${w}%` }} />
            <span className="h-2.5 w-24 animate-shimmer rounded-sm bg-panel-3" />
          </span>
          <span className="hidden h-6 w-20 animate-shimmer rounded-sm bg-panel-3 md:block" />
        </div>
      ))}
    </div>
  );
}

/** Keycaps from globals.css (design.md, Buttons). The keys carry their own transitions. */
export const primaryButtonClass = "key key-primary pointer-coarse:min-h-11";

export const secondaryButtonClass = "key pointer-coarse:min-h-11";
