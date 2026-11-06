"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";
import { cx } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { describeStatus, middleTruncate, type StatusContext, type UploadPhase } from "@/lib/status";
import { refreshDocStatus } from "@/lib/useDocStatus";
import { STILL_READING_COPY, STILL_READING_MS } from "@/lib/workspace";
import type { TrackedUpload } from "./types";
import { useUploads } from "./UploadsContext";

// The status sub-label changes once a phase has lasted this long (§5.4).
const SUB_LABEL_AFTER: Partial<Record<UploadPhase, number[]>> = {
  queued: [30_000],
  processing: [90_000],
};

/** §5.5's 3 minute note counts from when the file started being read: moving between waiting,
 *  reading and retrying doesn't restart it, but a failed file that is tried again does. */
function useStillReading(reading: boolean, phaseSince: number): boolean {
  const [since, setSince] = useState(reading ? phaseSince : null);
  if (reading && since === null) setSince(phaseSince);
  if (!reading && since !== null) setSince(null);
  const [passed, setPassed] = useState<number | null>(null);
  useEffect(() => {
    if (since === null) return;
    const id = window.setTimeout(() => setPassed(since), since + STILL_READING_MS - Date.now());
    return () => window.clearTimeout(id);
  }, [since]);
  return since !== null && passed === since;
}

/** Time spent in the current phase, re-rendering only when a sub-label threshold is crossed. */
function useElapsedMs(phase: UploadPhase, since: number): number {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const thresholds = SUB_LABEL_AFTER[phase];
    if (!thresholds) return;
    let id: number | undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const next = thresholds.find((ms) => ms > t - since);
      if (next !== undefined) id = window.setTimeout(tick, since + next - t + 50);
    };
    // The first tick also catches up a chip that mounts after a threshold already passed.
    id = window.setTimeout(tick, 0);
    return () => window.clearTimeout(id);
  }, [phase, since]);
  return Math.max(0, now - since);
}

// Text tiles (not images) so they survive forced colours and need no assets.
const TILES: Record<string, [label: string, bg: string]> = {
  pdf: ["PDF", "bg-bad"],
  docx: ["DOCX", "bg-info"],
  txt: ["TXT", "bg-muted"],
  md: ["MD", "bg-muted"],
  markdown: ["MD", "bg-muted"],
};

function TypeTile({ filename }: { filename: string }) {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  const [label, bg] = TILES[ext] ?? [ext.slice(0, 4).toUpperCase() || "FILE", "bg-muted"];
  return (
    <span
      aria-hidden="true"
      className={cx(
        // 12px is the type floor (§8.2); tracking-tighter keeps "DOCX" inside the 32px tile.
        "grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold tracking-tighter text-panel",
        bg,
      )}
    >
      {label}
    </span>
  );
}

const chipAction =
  "inline-flex min-h-6 items-center rounded text-xs font-medium text-accent underline underline-offset-2 hover:no-underline pointer-coarse:min-h-11";

/** 52px file chip: type tile, middle-truncated name, StatusPill line, cancel/remove (§5.5). It grows
 *  when it has a sentence to show or an action to offer (§5.4), since neither survives truncation. */
export function AttachmentChip({
  upload,
  onRemove,
  onRetried,
}: {
  upload: TrackedUpload;
  onRemove?: () => void;
  /** The Try again button just went away; the owner should put focus somewhere useful. */
  onRetried?: () => void;
}) {
  const uploads = useUploads();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const elapsedMs = useElapsedMs(upload.phase, upload.phaseSince);
  const stillReading = useStillReading(
    upload.phase === "queued" || upload.phase === "processing" || upload.phase === "retry_wait",
    upload.phaseSince,
  );
  const ctx: StatusContext = {
    progress: upload.progress,
    pageCount: upload.pageCount,
    elapsedMs,
    stage: upload.stage,
    reasonCode: upload.reasonCode,
    reasonMessage: upload.reasonMessage,
    subOverride: stillReading ? STILL_READING_COPY : null,
  };
  const status = describeStatus(upload.phase, ctx);
  const failed = upload.phase === "failed";
  const rejected = upload.phase === "rejected";
  const sentence = failed || rejected || ctx.subOverride ? status.sub : undefined;

  const retry = async () => {
    if (retrying || !upload.documentId) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await api(`/documents/${encodeURIComponent(upload.documentId)}/retry`, { method: "POST" });
      refreshDocStatus();
      onRetried?.();
    } catch (e) {
      // 409: already re-queued (another tab or person), so the next poll shows it reading.
      if (e instanceof ApiError && e.status === 409) refreshDocStatus();
      else setRetryError(errorText(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={cx(
        "relative flex min-h-13 w-[260px] max-w-full gap-2.5 overflow-hidden rounded-xl border border-border bg-panel pr-1 pl-2.5",
        sentence ? "items-start py-2" : "items-center",
        "transition-[opacity,translate] duration-200 ease-(--ease-snappy) starting:opacity-0 motion-safe:starting:translate-y-1",
      )}
    >
      <TypeTile filename={upload.filename} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-5 font-medium text-text" title={upload.filename}>
          {middleTruncate(upload.filename, 22)}
        </p>
        <p className="truncate leading-4" title={!sentence && status.sub ? `${status.label} · ${status.sub}` : status.label}>
          <StatusPill phase={upload.phase} ctx={ctx} variant="inline" showSub={!sentence} />
        </p>
        {sentence && <p className="mt-0.5 text-xs leading-4 text-pretty wrap-break-word text-muted">{sentence}</p>}
        {retryError && <p className="mt-0.5 text-xs leading-4 wrap-break-word text-bad">{retryError}</p>}
        {failed && upload.documentId && (
          <button type="button" onClick={() => void retry()} aria-disabled={retrying} className={chipAction}>
            {retrying ? "Trying again…" : "Try again"}
            <span className="sr-only"> {upload.filename}</span>
          </button>
        )}
        {rejected && uploads.canUpload && (
          <button type="button" onClick={() => uploads.pickFiles()} className={chipAction}>
            Choose another file
          </button>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${upload.phase === "uploading" ? "Cancel upload of" : "Remove"} ${upload.filename}`}
          title={upload.phase === "uploading" ? "Cancel" : undefined}
          className="grid size-6 shrink-0 place-items-center rounded-full! text-muted transition-colors hover:bg-panel-2 hover:text-text pointer-coarse:size-11"
        >
          <Icon name="close" width={14} height={14} />
        </button>
      )}
      {upload.phase === "uploading" && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-info-soft">
          <span
            className="block h-full origin-left bg-info transition-transform duration-200"
            style={{ transform: `scaleX(${Math.min(1, Math.max(0, upload.progress ?? 0))})` }}
          />
        </span>
      )}
    </div>
  );
}
