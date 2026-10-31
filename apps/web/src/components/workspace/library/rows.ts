import { phaseFromDocument, type StatusContext, type UploadPhase } from "@/lib/status";
import type { DocumentItem } from "@/lib/types";
import type { TrackedUpload } from "../types";
import { fileKind, type FileKind } from "./parts";

/** One line in the library: a stored document, or an upload from this tab that has no
 *  document yet (still uploading, or not accepted). */
export interface LibraryRow {
  key: string;
  filename: string;
  kind: FileKind;
  collectionName: string;
  phase: UploadPhase;
  ctx: StatusContext;
  pageCount: number | null;
  addedAt: number;
  doc?: DocumentItem;
  upload?: TrackedUpload;
}

export type StatusFilter = "all" | "ready" | "pending" | "attention";

export const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "pending", label: "Getting ready" },
  { key: "attention", label: "Needs attention" },
];

/** Which chip a phase counts under ("Removing" rows only show under All). */
export function bucketOf(phase: UploadPhase): StatusFilter | null {
  switch (phase) {
    case "indexed":
    case "duplicate":
      return "ready";
    case "failed":
    case "rejected":
      return "attention";
    case "uploading":
    case "queued":
    case "processing":
    case "retry_wait":
      return "pending";
    default:
      return null;
  }
}

export function matchesFilter(row: LibraryRow, filter: StatusFilter): boolean {
  return filter === "all" || bucketOf(row.phase) === filter;
}

const parseTime = (iso: string, fallback: number) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? fallback : ms;
};

export function docRow(d: DocumentItem, now: number): LibraryRow {
  const phase = phaseFromDocument(d.status, d.latest_job?.status);
  const failed = phase === "failed";
  return {
    key: d.id,
    filename: d.filename,
    kind: fileKind(d.filename, d.file_type),
    collectionName: d.collection_name,
    phase,
    ctx: {
      pageCount: d.page_count,
      // updated_at moves with each status change, so it stands in for "time in this phase".
      elapsedMs: Math.max(0, now - parseTime(d.updated_at, now)),
      stage: d.latest_job?.stage ?? null,
      reasonCode: failed ? (d.latest_job?.error_code ?? null) : null,
      reasonMessage: failed ? (d.latest_job?.safe_error_message ?? null) : null,
    },
    pageCount: d.page_count,
    addedAt: parseTime(d.created_at, now),
    doc: d,
  };
}

/** Keyed by document id once the API accepted it, so the row keeps its DOM node when the
 *  document list catches up and replaces it. */
export function uploadRow(u: TrackedUpload, collectionName: string, now: number): LibraryRow {
  return {
    key: u.documentId ?? u.key,
    filename: u.filename,
    kind: fileKind(u.filename),
    collectionName,
    phase: u.phase,
    ctx: {
      progress: u.progress,
      pageCount: u.pageCount,
      elapsedMs: Math.max(0, now - u.phaseSince),
      stage: u.stage,
      reasonCode: u.reasonCode,
      reasonMessage: u.reasonMessage,
    },
    pageCount: u.pageCount ?? null,
    addedAt: u.phaseSince,
    upload: u,
  };
}

/** Rows per status chip. "All" includes "Removing" rows, which have no chip of their own. */
export function countRows(rows: LibraryRow[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: rows.length, ready: 0, pending: 0, attention: 0 };
  for (const row of rows) {
    const bucket = bucketOf(row.phase);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/** GET /documents for the library (§6): newest 200, optionally narrowed by name and collection.
 *  Status chips filter on the client so every chip can show its count. */
export function libraryPath(q: string, collectionId: string): string {
  const qs = new URLSearchParams({ limit: "200" });
  if (q) qs.set("q", q);
  if (collectionId !== "all") qs.set("collection_id", collectionId);
  return `/documents?${qs.toString()}`;
}

/** The search and collection that produced a libraryPath(). */
export function filtersOf(path: string): { q: string; collectionId: string } {
  const qs = new URLSearchParams(path.split("?")[1] ?? "");
  return { q: qs.get("q") ?? "", collectionId: qs.get("collection_id") ?? "all" };
}
