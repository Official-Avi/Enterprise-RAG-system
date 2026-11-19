"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { ApiError } from "@/lib/api";
import { AnswerBlock } from "./AnswerBlock";
import { AnswerErrorCard } from "./AnswerErrorCard";
import type { SavedTurn } from "./ask/helpers";
import { noteCitationActivated } from "./CitationChip";
import { NotFoundCard } from "./NotFoundCard";
import { WaitingIndicator } from "./WaitingIndicator";
import { useWorkspace } from "./WorkspaceContext";
import type { AnswerMode, AnswerView, Citation, NotFoundContext } from "./types";

export interface ThreadProps {
  turns: SavedTurn[];
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

// Not status 0: AnswerErrorCard reads 0 as "Can't reach RackFlow".
const FALLBACK_ERROR = new ApiError(500, "UNKNOWN", "Something went wrong on our side.", null);

// A quiet text button for the second choice next to a key (Cancel).
const textButton =
  "inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-text-2 transition-colors " +
  "duration-[var(--dur-micro)] ease-out hover:bg-panel-2 hover:text-text active:bg-panel-3 pointer-coarse:h-11";

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
  if (answer.evidence_status === "conversational") return `Reply: ${answer.text}`;
  if (answer.evidence_status === "insufficient") return "Answer ready. That's not covered in your documents.";
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

/** Turns as <article>s (§5.6): question, held note, waiting stages, answers, errors. Handles
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
      // The user just asked: show their question and the waiting row. Never animated (§8.4).
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
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
      // Answers rebuilt from history are never announced.
      if (t.status !== "answered" || !a || a.fromHistory || announced.has(a.id)) continue;
      announced.add(a.id);
      announce(readyMessage(a));
    }
  }, [turns, announce]);

  const busy = turns.some((t) => t.status === "held" || t.status === "waiting");
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
      style={{ scrollPaddingBottom: "16px" }}
    >
      <div className="mx-auto flex w-full max-w-[768px] flex-col px-4 pt-6 pb-10 md:px-6">
        {turns.map((turn, i) => (
          <TurnArticle
            key={turn.id}
            turn={turn}
            mode={mode}
            isLatest={i === latestAnswerIdx}
            busy={busy}
            activeMarker={turn.id === selectedId ? activeMarker : null}
            notFound={notFound}
            props={props}
          />
        ))}
      </div>
      {showPill && (
        <div className="pointer-events-none sticky bottom-0 h-0">
          {/* The composer sits below this scroller, so the scroller's bottom edge is its top edge. */}
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <button type="button" onClick={jumpToAnswer} className="key pointer-events-auto pointer-coarse:min-h-11">
              New answer
              <Icon name="arrowRight" width={16} height={16} className="rotate-90" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A saved answer hidden because its source is no longer open to this user. The note is the API's. */
function WithheldNote({ note, onAskAgain }: { note: string; onAskAgain: () => void }) {
  return (
    <div className="rounded-card border border-border bg-panel p-4">
      <div className="flex gap-3">
        <Icon name="lock" width={20} height={20} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="max-w-[72ch] text-sm leading-6 text-text text-pretty wrap-anywhere">{note}</p>
          <button type="button" onClick={onAskAgain} className="key mt-3 pointer-coarse:min-h-11">
            Ask again
          </button>
        </div>
      </div>
    </div>
  );
}

function TurnArticle({
  turn,
  mode,
  isLatest,
  busy,
  activeMarker,
  notFound,
  props,
}: {
  turn: SavedTurn;
  mode: AnswerMode;
  isLatest: boolean;
  busy: boolean;
  activeMarker: number | null;
  notFound: NotFoundContext;
  props: ThreadProps;
}) {
  const answer = turn.status === "answered" ? turn.answer : undefined;
  const hasAnswerArea =
    turn.status !== "held" && (turn.status !== "answered" || answer !== undefined || turn.withheldNote !== undefined);
  const answerHeading = useRef<HTMLHeadingElement>(null);

  function retry() {
    props.onRetry(turn.id);
    // The pressed button goes away with the card, so keep focus at this answer instead of <body>.
    answerHeading.current?.focus({ preventScroll: true });
  }

  return (
    // Turns read as a document: each question sets a short head over its answer, and a hairline
    // separates one exchange from the next.
    <article className="flex flex-col gap-4 border-t border-border pt-8 pb-8 first:border-t-0 first:pt-0 last:pb-0">
      <h3 className="sr-only">You asked</h3>
      <p
        className={
          "max-w-[60ch] font-display text-lg leading-7 font-medium tracking-head text-text text-pretty " +
          "whitespace-pre-wrap wrap-anywhere"
        }
      >
        {turn.question}
      </p>

      {turn.status === "held" && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted wrap-anywhere">
            Waiting for {joinFiles(turn.heldFor)} (usually under a minute)…
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => props.onAskWithoutHeld(turn.id)}
              className="key pointer-coarse:min-h-11"
            >
              Ask now without it
            </button>
            <button type="button" onClick={() => props.onCancelHeld(turn.id)} className={textButton}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {hasAnswerArea && (
        <div data-answer-for={turn.id}>
          <h3 ref={answerHeading} tabIndex={-1} className="sr-only">
            Answer
          </h3>
          {turn.status === "waiting" && (
            <WaitingIndicator startedAt={turn.startedAt} mode={mode} onStop={() => props.onStop(turn.id)} />
          )}
          {turn.withheldNote !== undefined && (
            <WithheldNote note={turn.withheldNote} onAskAgain={() => props.onRephrase(turn.question)} />
          )}
          {answer &&
            (answer.evidence_status === "conversational" ? (
              // A greeting, thanks or "what can you do": a plain reply, no search result to judge.
              <p className="max-w-[65ch] text-base leading-7 text-text" data-testid="conversational-reply">
                {answer.text}
              </p>
            ) : answer.evidence_status === "insufficient" ? (
              <NotFoundCard
                retrievedCount={answer.retrieved_count}
                context={{
                  ...notFound,
                  // Today's count says nothing about a search made earlier.
                  documentCount: answer.fromHistory ? 0 : notFound.documentCount,
                  narrowed: turn.searchedNarrowed ?? notFound.narrowed,
                  onSearchAll: () => notFound.onSearchAll(turn.question),
                }}
                onRephrase={() => props.onRephrase(turn.question)}
              />
            ) : (
              <AnswerBlock
                answer={answer}
                activeMarker={activeMarker}
                isLatest={isLatest}
                mode={mode}
                onCite={(c, viaKeyboard) => {
                  props.onCite(turn.id, c, viaKeyboard);
                  noteCitationActivated(c, viaKeyboard);
                }}
                onOpenSources={() => props.onOpenSources(turn.id)}
              />
            ))}
          {turn.status === "error" && (
            <AnswerErrorCard error={turn.error ?? FALLBACK_ERROR} busy={busy} onRetry={retry} />
          )}
          {/* Meta line and "Answered without report.pdf": on every outcome, not found included (§5.5). */}
          {turn.scopeLabel && turn.status !== "waiting" && (
            <p className="mt-4 text-xs text-muted wrap-anywhere">{turn.scopeLabel}</p>
          )}
        </div>
      )}
    </article>
  );
}
