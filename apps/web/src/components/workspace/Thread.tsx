"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { AnswerBlock } from "./AnswerBlock";
import { AnswerErrorCard } from "./AnswerErrorCard";
import { NotFoundCard } from "./NotFoundCard";
import { WaitingIndicator } from "./WaitingIndicator";
import { useWorkspace } from "./WorkspaceContext";
import type { AnswerMode, AnswerView, Citation, NotFoundContext, Turn } from "./types";

export interface ThreadProps {
  turns: Turn[];
  mode: AnswerMode;
  selectedTurnId: string | null;
  activeMarker: number | null;
  onCite: (turnId: string, citation: Citation, viaKeyboard: boolean) => void;
  onOpenSources: (turnId: string) => void;
  onRetry: (turnId: string) => void;
  onRephrase: (question: string) => void;
  onAskWithoutHeld: (turnId: string) => void;
  onCancelHeld: (turnId: string) => void;
  onStop: (turnId: string) => void;
  notFound: NotFoundContext;
}

const NEAR_BOTTOM_PX = 120;

// Answer ids already announced in this tab, so a remounted thread never repeats one (§9 #3).
const announced = new Set<string>();

const FALLBACK_ERROR = new ApiError(0, "UNKNOWN", "Something went wrong on our side.", null);

const heldButton =
  "inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors duration-150 " +
  "pointer-coarse:h-11";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function answerSelector(turnId: string): string {
  return `[data-answer-for="${CSS.escape(turnId)}"]`;
}

/** True once the top of the turn's answer is on screen, or already scrolled past. */
function answerTopVisible(scroller: HTMLElement, turnId: string): boolean {
  const target = scroller.querySelector<HTMLElement>(answerSelector(turnId));
  if (!target) return false;
  return target.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom - 48;
}

function readyMessage(answer: AnswerView): string {
  if (answer.evidence_status === "insufficient") return "Answer ready. Not found in your documents.";
  const n = answer.citations.length;
  if (n === 0) return "Answer ready. Found in your documents.";
  return `Answer ready. Found in your documents, ${n} ${n === 1 ? "source" : "sources"}.`;
}

function joinFiles(files: string[] | undefined): string {
  if (!files || files.length === 0) return "your file";
  if (files.length === 1) return files[0];
  if (files.length === 2) return `${files[0]} and ${files[1]}`;
  return `${files[0]}, ${files[1]} and ${files.length - 2} more`;
}

/** Turns as <article>s (§5.6): user bubble, held note, waiting stages, answers, errors. Handles
 *  scroll-to-answer and the "New answer ↓" pill. */
export function Thread(props: ThreadProps) {
  const { turns, mode, selectedTurnId, activeMarker, notFound } = props;
  const { announce } = useWorkspace();

  const scrollRef = useRef<HTMLDivElement>(null);
  // Measured on every scroll, so it describes where the reader was before the thread changed.
  const nearBottomRef = useRef(true);
  const prevRef = useRef<{ firstId: string; lastId: string; lastStatus: string; count: number } | null>(null);
  const [pillFor, setPillFor] = useState<string | null>(null);

  const last = turns.at(-1);
  const firstId = turns[0]?.id ?? "";
  const lastId = last?.id ?? "";
  const lastStatus = last?.status ?? "";
  const count = turns.length;

  let latestAnswerIdx = -1;
  turns.forEach((t, i) => {
    if (t.status === "answered" && t.answer) latestAnswerIdx = i;
  });
  const selectedId = selectedTurnId ?? turns[latestAnswerIdx]?.id ?? null;

  const revealAnswer = useCallback((turnId: string, behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(answerSelector(turnId));
    const max = el.scrollHeight - el.clientHeight;
    if (!target) {
      el.scrollTo({ top: max, behavior });
      return;
    }
    // The answer's top lands near the top of the list, unless the whole answer already fits.
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16;
    el.scrollTo({ top: Math.max(0, Math.min(max, top)), behavior });
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevRef.current;
    prevRef.current = { firstId, lastId, lastStatus, count };
    if (!el || !lastId) return;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";

    if (!prev || prev.firstId !== firstId) {
      // First render or another chat: start at the latest answer, without animation. Revealing its
      // top (not the very bottom) also avoids a jump past a long answer if the page re-keys turns.
      revealAnswer(lastId, "auto");
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      return;
    }
    if (prev.lastId !== lastId) {
      // The user just asked: show their question and the waiting row.
      el.scrollTo({ top: el.scrollHeight, behavior });
      return;
    }
    if (prev.lastStatus === lastStatus || (lastStatus !== "answered" && lastStatus !== "error")) return;
    if (nearBottomRef.current) {
      revealAnswer(lastId, behavior);
    } else if (lastStatus === "answered" && !answerTopVisible(el, lastId)) {
      requestAnimationFrame(() => setPillFor(lastId));
    }
  }, [firstId, lastId, lastStatus, count, revealAnswer]);

  useEffect(() => {
    for (const t of turns) {
      const a = t.answer;
      // retrieved_count is null for answers rebuilt from history, which are never announced.
      if (t.status !== "answered" || !a || a.retrieved_count === null || announced.has(a.id)) continue;
      announced.add(a.id);
      announce(readyMessage(a));
    }
  }, [turns, announce]);

  const showPill = pillFor !== null && pillFor === lastId && lastStatus === "answered";

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    if (showPill && (nearBottomRef.current || answerTopVisible(el, lastId))) setPillFor(null);
  }

  function jumpToAnswer() {
    const el = scrollRef.current;
    revealAnswer(lastId, prefersReducedMotion() ? "auto" : "smooth");
    setPillFor(null);
    // The pill disappears, so hand focus to the answer heading instead of dropping it.
    el?.querySelector<HTMLElement>(`${answerSelector(lastId)} h3`)?.focus({ preventScroll: true });
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-thread-scroller=""
      className="relative min-h-0 flex-1 overflow-y-auto"
      style={{ scrollPaddingBottom: "calc(var(--composer-h, 0px) + 16px)" }}
    >
      <div className="mx-auto flex w-full max-w-[768px] flex-col gap-6 px-4 pt-6 pb-8 md:px-6">
        {turns.map((turn, i) => (
          <TurnArticle
            key={turn.id}
            turn={turn}
            mode={mode}
            isLatest={i === latestAnswerIdx}
            activeMarker={turn.id === selectedId ? activeMarker : null}
            notFound={notFound}
            props={props}
          />
        ))}
      </div>
      {showPill && (
        <div className="pointer-events-none sticky bottom-0 h-0">
          <div
            className="absolute inset-x-0 flex justify-center"
            style={{ bottom: "calc(var(--composer-h, 0px) + 12px)" }}
          >
            <button
              type="button"
              onClick={jumpToAnswer}
              className={
                "pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong " +
                "bg-panel px-4 text-sm font-medium text-text shadow-elev-3 transition-[opacity,translate,background-color] " +
                "duration-200 ease-[var(--ease-snappy)] hover:bg-panel-2 starting:opacity-0 " +
                "motion-safe:starting:translate-y-1 pointer-coarse:h-11"
              }
            >
              New answer <span aria-hidden="true">↓</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TurnArticle({
  turn,
  mode,
  isLatest,
  activeMarker,
  notFound,
  props,
}: {
  turn: Turn;
  mode: AnswerMode;
  isLatest: boolean;
  activeMarker: number | null;
  notFound: NotFoundContext;
  props: ThreadProps;
}) {
  const answer = turn.status === "answered" ? turn.answer : undefined;
  const hasAnswerArea = turn.status !== "held" && (turn.status !== "answered" || answer !== undefined);

  return (
    <article className="flex flex-col gap-4">
      <h3 className="sr-only">You asked</h3>
      <div
        className={
          "max-w-[85%] self-end rounded-[20px] bg-panel-2 px-4 py-2 text-[16px] leading-[26px] text-text " +
          "whitespace-pre-wrap wrap-anywhere sm:max-w-[75%]"
        }
      >
        {turn.question}
      </div>

      {turn.status === "held" && (
        <div className="flex max-w-[85%] flex-col items-end gap-2 self-end text-right sm:max-w-[75%]">
          <p className="text-sm text-muted wrap-anywhere">
            Waiting for {joinFiles(turn.heldFor)} (usually under a minute)…
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => props.onAskWithoutHeld(turn.id)}
              className={`${heldButton} border border-border-strong bg-panel text-text hover:bg-panel-2`}
            >
              Ask now without it
            </button>
            <button
              type="button"
              onClick={() => props.onCancelHeld(turn.id)}
              className={`${heldButton} text-muted hover:bg-panel-2 hover:text-text`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {hasAnswerArea && (
        <div data-answer-for={turn.id}>
          <h3 tabIndex={-1} className="sr-only">
            Answer
          </h3>
          {turn.status === "waiting" && (
            <WaitingIndicator startedAt={turn.startedAt} mode={mode} onStop={() => props.onStop(turn.id)} />
          )}
          {answer &&
            (answer.evidence_status === "insufficient" ? (
              <NotFoundCard
                retrievedCount={answer.retrieved_count}
                context={notFound}
                onRephrase={() => props.onRephrase(turn.question)}
              />
            ) : (
              <AnswerBlock
                answer={answer}
                activeMarker={activeMarker}
                isLatest={isLatest}
                scopeLabel={turn.scopeLabel}
                mode={mode}
                onCite={(c, viaKeyboard) => props.onCite(turn.id, c, viaKeyboard)}
                onOpenSources={() => props.onOpenSources(turn.id)}
              />
            ))}
          {turn.status === "error" && (
            <AnswerErrorCard error={turn.error ?? FALLBACK_ERROR} onRetry={() => props.onRetry(turn.id)} />
          )}
        </div>
      )}
    </article>
  );
}
