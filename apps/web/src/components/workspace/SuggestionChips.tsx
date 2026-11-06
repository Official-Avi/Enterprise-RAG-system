"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { middleTruncate } from "@/lib/status";
import { suggestQuestions } from "@/lib/suggestions";
import type { DocumentItem } from "@/lib/types";
import type { AnswerMode } from "./types";

// Same breakpoint as the page's mobile layout, the only one that stacks the chips above the composer.
const MOBILE_QUERY = "(max-width: 767.98px)";
const COMPOSER_GAP = 8;
const MIN_LIST_HEIGHT = 44;

/** On mobile the composer is pinned to the bottom of <main>, and a short viewport (on-screen
 *  keyboard, long draft) leaves less room than the chips need. Limit the list to the room above the
 *  composer so it scrolls by itself, and hide it when not even one chip fits. */
function useFitAboveComposer(
  wrapRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLUListElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    const list = listRef.current;
    if (!active || !wrap || !list) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const main = document.getElementById("main");
    const ro = new ResizeObserver(() => fit());
    let form: HTMLFormElement | null = null;
    const fit = () => {
      // Looked up each time: a detached form measures 0 and would hide the chips for good.
      const current = document.getElementById("composer-input")?.closest("form") ?? null;
      if (current !== form) {
        if (form) ro.unobserve(form);
        if (current) ro.observe(current);
        form = current;
      }
      if (!mq.matches || !form) {
        list.style.maxHeight = "";
        list.style.overflowY = "";
        list.style.display = "";
        return;
      }
      const room = form.getBoundingClientRect().top - wrap.getBoundingClientRect().top - COMPOSER_GAP;
      list.style.display = room < MIN_LIST_HEIGHT ? "none" : "";
      list.style.maxHeight = `${Math.max(0, room)}px`;
      list.style.overflowY = "auto";
    };
    const onScroll = (e: Event) => {
      if (e.target !== list) fit();
    };
    fit();
    if (main) ro.observe(main);
    mq.addEventListener("change", fit);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", fit);
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [wrapRef, listRef, active]);
}

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useFitAboveComposer(wrapRef, listRef, suggestions.length > 0);

  if (suggestions.length === 0) return null;

  function pick(question: string, at: number) {
    // A double click must not send the same question twice before the chips unmount.
    if (lastPickAt.current && at - lastPickAt.current < 800) return;
    lastPickAt.current = at;
    onPick(question);
  }

  return (
    <div ref={wrapRef}>
      <ul
        ref={listRef}
        aria-label="Suggested questions"
        className="grid w-full grid-cols-1 gap-2 overscroll-contain transition-[opacity,translate] duration-200 ease-(--ease-snappy) starting:opacity-0 sm:grid-cols-2 motion-safe:starting:translate-y-1"
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
    </div>
  );
}
