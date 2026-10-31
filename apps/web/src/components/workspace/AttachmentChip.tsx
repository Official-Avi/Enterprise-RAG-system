"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";
import { cx } from "@/components/ui";
import { describeStatus, middleTruncate, type StatusContext, type UploadPhase } from "@/lib/status";
import { STILL_READING_COPY, STILL_READING_MS } from "@/lib/workspace";
import type { TrackedUpload } from "./types";

// The status sub-label changes once a phase has lasted this long (§5.4), and every reading
// phase switches to the "Still reading" note after 3 minutes (§5.5).
const SUB_LABEL_AFTER: Partial<Record<UploadPhase, number[]>> = {
  queued: [30_000, STILL_READING_MS],
  processing: [90_000, STILL_READING_MS],
  retry_wait: [STILL_READING_MS],
};

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

/** 52px file chip: type tile, middle-truncated name, StatusPill line, remove (§5.5). */
export function AttachmentChip({ upload, onRemove }: { upload: TrackedUpload; onRemove?: () => void }) {
  const elapsedMs = useElapsedMs(upload.phase, upload.phaseSince);
  const reading = upload.phase === "queued" || upload.phase === "processing" || upload.phase === "retry_wait";
  const ctx: StatusContext = {
    progress: upload.progress,
    pageCount: upload.pageCount,
    elapsedMs,
    stage: upload.stage,
    reasonCode: upload.reasonCode,
    reasonMessage: upload.reasonMessage,
    subOverride: reading && elapsedMs >= STILL_READING_MS ? STILL_READING_COPY : null,
  };
  const status = describeStatus(upload.phase, ctx);

  return (
    <div
      className={cx(
        "relative flex h-13 w-[260px] max-w-full items-center gap-2.5 overflow-hidden rounded-xl border border-border bg-panel pr-1 pl-2.5",
        "transition-[opacity,translate] duration-200 ease-(--ease-snappy) starting:opacity-0 motion-safe:starting:translate-y-1",
      )}
    >
      <TypeTile filename={upload.filename} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-5 font-medium text-text" title={upload.filename}>
          {middleTruncate(upload.filename, 22)}
        </p>
        <p className="truncate leading-4" title={status.sub ? `${status.label} · ${status.sub}` : status.label}>
          <StatusPill phase={upload.phase} ctx={ctx} variant="inline" showSub />
        </p>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${upload.filename}`}
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
