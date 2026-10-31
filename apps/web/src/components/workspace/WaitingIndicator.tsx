"use client";

import { useEffect, useState } from "react";
import type { AnswerMode } from "./types";

const SHOW_AFTER_MS = 500;
const STOP_AFTER_MS = 25_000;

function stageLabel(elapsedMs: number, mode: AnswerMode): string {
  if (elapsedMs >= STOP_AFTER_MS) return "This is taking longer than usual.";
  if (elapsedMs >= 12_000) return "Still working. Big collections take a little longer.";
  if (elapsedMs >= 5_000) return mode === "extractive" ? "Picking the exact quotes" : "Writing the answer";
  if (elapsedMs >= 2_500) return "Reading the best matches";
  return "Searching your documents";
}

/** Three dots + timed stage labels from 0.5s; Stop after 25s (§5.6). */
export function WaitingIndicator({
  startedAt,
  mode,
  onStop,
}: {
  startedAt: number;
  mode: AnswerMode;
  onStop?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // Reserve the row's height so the thread doesn't jump when the label appears.
  if (elapsed < SHOW_AFTER_MS) return <div aria-hidden="true" className="min-h-[26px]" />;

  const seconds = Math.floor(elapsed / 1000);

  return (
    <div
      className={
        "flex min-h-[26px] flex-wrap items-center gap-x-3 gap-y-2 transition-opacity duration-200 " +
        "ease-[var(--ease-snappy)] starting:opacity-0"
      }
    >
      <span aria-hidden="true" className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </span>
      <p role="status" className="text-sm text-muted">
        {stageLabel(elapsed, mode)}
        {/* The ticking seconds stay out of the accessibility tree so only stage changes are read. */}
        {elapsed >= 5_000 && (
          <span aria-hidden="true" className="tabular-nums">
            {` · ${seconds}s`}
          </span>
        )}
      </p>
      {elapsed >= STOP_AFTER_MS && onStop && (
        <button
          type="button"
          onClick={onStop}
          className={
            "inline-flex h-8 items-center rounded-md border border-border-strong bg-panel px-3 text-[13px] " +
            "font-medium text-text transition-colors duration-150 hover:bg-panel-2 pointer-coarse:h-11"
          }
        >
          Stop
        </button>
      )}
    </div>
  );
}
