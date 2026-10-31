"use client";

import { useMemo, useRef } from "react";
import { middleTruncate } from "@/lib/status";
import { suggestQuestions } from "@/lib/suggestions";
import type { DocumentItem } from "@/lib/types";
import type { AnswerMode } from "./types";

/** Suggested questions (§5.11): a click sends immediately. */
export function SuggestionChips({
  docs,
  mode,
  onPick,
}: {
  docs: DocumentItem[];
  mode: AnswerMode;
  onPick: (question: string) => void;
}) {
  const suggestions = useMemo(() => suggestQuestions(docs, mode), [docs, mode]);
  const lastPickAt = useRef(0);

  if (suggestions.length === 0) return null;

  function pick(question: string, at: number) {
    // A double click must not send the same question twice before the chips unmount.
    if (lastPickAt.current && at - lastPickAt.current < 800) return;
    lastPickAt.current = at;
    onPick(question);
  }

  return (
    <ul
      aria-label="Suggested questions"
      className="grid w-full grid-cols-1 gap-2 transition-[opacity,translate] duration-200 ease-(--ease-snappy) starting:opacity-0 sm:grid-cols-2 motion-safe:starting:translate-y-1"
    >
      {suggestions.map((s) => (
        <li key={s.question} className="flex">
          <button
            type="button"
            onClick={(e) => pick(s.question, e.timeStamp)}
            className="flex min-h-11 w-full min-w-0 flex-col justify-center gap-0.5 rounded-xl border border-border bg-panel px-3 py-2 text-left transition-[background-color,border-color,scale] duration-150 hover:border-border-strong hover:bg-panel-2 motion-safe:active:scale-[.98]"
          >
            <span className="text-sm leading-5 text-text wrap-break-word">{s.question}</span>
            {s.filename && (
              <span className="truncate text-xs leading-4 text-muted" title={s.filename}>
                <span className="sr-only">From </span>
                {middleTruncate(s.filename, 40)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
