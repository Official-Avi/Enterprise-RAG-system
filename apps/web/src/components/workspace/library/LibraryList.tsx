"use client";

import Link from "next/link";
import { StatusPill } from "@/components/StatusPill";
import { cx, Th } from "@/components/ui";
import { describeStatus, middleTruncate } from "@/lib/status";
import { KIND_LABEL, RelativeTime, TypeTile } from "./parts";
import { RowMenu, type RowAction } from "./RowMenu";
import type { LibraryRow } from "./rows";

export interface LibraryListProps {
  rows: LibraryRow[];
  /** sr-only table caption. */
  caption: string;
  now: number;
  flashing: ReadonlySet<string>;
  canAsk: boolean;
  /** org_admin/operator see raw error codes behind "Details for admins" (§5.4). */
  showAdminDetails: boolean;
  actionsFor: (row: LibraryRow, layout: "table" | "cards") => RowAction[];
}

const CELL = "border-b border-border px-3 py-3 align-middle";

function FileName({ name, max, className }: { name: string; max: number; className?: string }) {
  const short = middleTruncate(name, max);
  if (short === name) return <p className={className}>{name}</p>;
  return (
    <p className={className} title={name}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{name}</span>
    </p>
  );
}

function UploadBar({ progress }: { progress?: number }) {
  return (
    <div aria-hidden="true" className="mt-1.5 h-0.5 w-28 overflow-hidden rounded-full bg-panel-2">
      {/* scaleX, not width: §8.4 animates transforms only. */}
      <div
        className="h-full origin-left rounded-full bg-info transition-transform duration-200"
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress ?? 0))})` }}
      />
    </div>
  );
}

function Reason({ row }: { row: LibraryRow }) {
  if (row.phase !== "failed" && row.phase !== "rejected") return null;
  return <p className="mt-1 text-xs text-bad">{describeStatus(row.phase, row.ctx).sub}</p>;
}

function AdminDetails({ row }: { row: LibraryRow }) {
  const job = row.doc?.latest_job;
  if (row.phase !== "failed" || !job?.error_code) return null;
  return (
    <details className="mt-1 text-xs text-muted">
      <summary className="inline-block cursor-pointer py-1 hover:text-text">Details for admins</summary>
      <p className="font-mono [overflow-wrap:anywhere]">{job.error_code}</p>
      {job.safe_error_message && <p className="mt-0.5">{job.safe_error_message}</p>}
    </details>
  );
}

const isPending = (row: LibraryRow) =>
  row.phase === "queued" || row.phase === "processing" || row.phase === "retry_wait";

// Under reduced motion the flash keyframes end at once, so the row gets a static tint instead
// for as long as it is marked (§8.4).
const FLASH = "animate-flash motion-reduce:bg-accent-soft";

function AskLink({ id, filename }: { id: string; filename: string }) {
  return (
    <Link
      href={`/ask?doc=${encodeURIComponent(id)}`}
      className={cx(
        "inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-border-strong px-3 text-[13px]",
        "font-medium text-text transition-colors duration-150 hover:border-accent hover:bg-accent-soft hover:text-accent",
        "pointer-coarse:h-11",
      )}
    >
      Ask about this<span className="sr-only">: {filename}</span>
    </Link>
  );
}

/** The ≥ 768px table (§6). */
export function LibraryTable({ rows, caption, now, flashing, canAsk, showAdminDetails, actionsFor }: LibraryListProps) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-border bg-panel md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th className="w-44">Status</Th>
            <Th className="w-16 text-right">Pages</Th>
            <Th className="w-28">Added</Th>
            <Th className="w-40 text-right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {rows.map((row) => (
            <tr key={row.key} className={cx("hover:bg-panel-2", flashing.has(row.key) && FLASH)}>
              <td className={CELL}>
                <div className="flex items-center gap-3">
                  <TypeTile kind={row.kind} />
                  <div className="min-w-0">
                    <FileName name={row.filename} max={44} className="text-sm font-medium [overflow-wrap:anywhere]" />
                    {row.collectionName && <p className="truncate text-xs text-muted">{row.collectionName}</p>}
                  </div>
                </div>
              </td>
              <td className={CELL}>
                <StatusPill phase={row.phase} ctx={row.ctx} showSub={isPending(row)} />
                {row.phase === "uploading" && <UploadBar progress={row.ctx.progress} />}
                <Reason row={row} />
                {showAdminDetails && <AdminDetails row={row} />}
              </td>
              <td className={cx(CELL, "text-right tabular-nums")}>{row.pageCount ?? "–"}</td>
              <td className={cx(CELL, "whitespace-nowrap text-muted")}>
                <RelativeTime ms={row.addedAt} now={now} />
              </td>
              <td className={cx(CELL, "text-right")}>
                <div className="flex items-center justify-end gap-1">
                  {canAsk && row.doc && row.phase === "indexed" && <AskLink id={row.doc.id} filename={row.filename} />}
                  <RowMenu filename={row.filename} actions={actionsFor(row, "table")} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Below 768px: 72px card rows (§6). "Ask about this" moves into the ⋯ menu. */
export function LibraryCards({ rows, caption, now, flashing, showAdminDetails, actionsFor }: LibraryListProps) {
  return (
    <ul
      aria-label={caption}
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel md:hidden"
    >
      {rows.map((row) => (
        <li
          key={row.key}
          className={cx("flex min-h-[72px] items-center gap-3 py-2 pl-3 pr-1", flashing.has(row.key) && FLASH)}
        >
          <TypeTile kind={row.kind} />
          <div className="min-w-0 flex-1">
            <FileName name={row.filename} max={60} className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]" />
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill phase={row.phase} ctx={row.ctx} />
              <span className="text-xs text-muted">
                {KIND_LABEL[row.kind]}
                {row.pageCount ? ` · ${row.pageCount} ${row.pageCount === 1 ? "page" : "pages"}` : ""}
                {" · "}
                <RelativeTime ms={row.addedAt} now={now} />
              </span>
            </div>
            {row.phase === "uploading" && <UploadBar progress={row.ctx.progress} />}
            <Reason row={row} />
            {showAdminDetails && <AdminDetails row={row} />}
          </div>
          <RowMenu filename={row.filename} actions={actionsFor(row, "cards")} size="lg" />
        </li>
      ))}
    </ul>
  );
}
