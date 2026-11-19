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

// The skeleton is the shape of the answer on its way: three lines of a paragraph.
const LINES = ["w-[92%]", "w-[84%]", "w-[58%]"];

/** Timed stage labels from 0.5s over a skeleton of the coming answer; Stop after 25s (§5.6). */
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

  // Reserve the block's height so the thread doesn't jump when the label appears.
  if (elapsed < SHOW_AFTER_MS) return <div aria-hidden="true" className="min-h-24" />;

  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="flex min-h-24 flex-col gap-3 transition-opacity duration-[var(--dur-short)] ease-out starting:opacity-0">
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <p role="status" className="text-sm text-text-2">
          {stageLabel(elapsed, mode)}
        </p>
        {/* The ticking seconds stay out of the accessibility tree so only stage changes are read. */}
        {elapsed >= 5_000 && (
          <span aria-hidden="true" className="font-mono text-xs text-muted tabular-nums">
            {`${seconds}s`}
          </span>
        )}
        {elapsed >= STOP_AFTER_MS && onStop && (
          <button type="button" onClick={onStop} className="key pointer-coarse:min-h-11">
            Stop
          </button>
        )}
      </div>
      <div aria-hidden="true" className="flex max-w-[72ch] flex-col gap-2">
        {LINES.map((width, i) => (
          <span
            key={width}
            className={`h-3 rounded-sm bg-panel-3 motion-safe:animate-shimmer ${width}`}
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
