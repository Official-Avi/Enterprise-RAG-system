"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { announce } from "@/lib/announce";
import { Icon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { cx } from "@/components/ui";
import { citationLabel, isDocumentDeleted, sourceNumbers, useLastCitationActivation } from "./CitationChip";
import { SourceCard } from "./SourceCard";
import type { Citation } from "./types";

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

interface LastInput {
  keyboard: boolean;
  target: EventTarget | null;
  at: number;
}

/** Tells a keyboard press on a "Sources" button from a click or from the panel opening by itself
 *  when an answer arrives, which must never move focus (§5.7). */
function useLastInput(): RefObject<LastInput> {
  const ref = useRef<LastInput>({ keyboard: false, target: null, at: 0 });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") ref.current = { keyboard: true, target: e.target, at: Date.now() };
    };
    const onPointer = (e: PointerEvent) => {
      ref.current = { keyboard: false, target: e.target, at: Date.now() };
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
  return ref;
}

/** Sources (§5.7): docked aside >=1280px, right drawer 1024–1279px, bottom sheet below. */
export function SourcesPanel({
  citations,
  activeMarker,
  open,
  onClose,
  onSelect,
}: {
  citations: Citation[];
  activeMarker: number | null;
  open: boolean;
  onClose: () => void;
  onSelect: (marker: number) => void;
}) {
  const docked = useMediaQuery("(min-width: 1280px)");
  const drawer = useMediaQuery("(min-width: 1024px)");
  const contentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const lastInput = useLastInput();
  const activation = useLastCitationActivation();
  const handledActivation = useRef(activation?.count ?? 0);

  const sorted = useMemo(() => [...citations].sort((a, b) => a.marker - b.marker), [citations]);
  const numbers = useMemo(() => sourceNumbers(citations), [citations]);
  const bestMarker = useMemo(() => {
    let best: Citation | null = null;
    for (const c of sorted) {
      if (!isDocumentDeleted(c) && c.score != null && (best?.score == null || c.score > best.score)) best = c;
    }
    return best?.marker ?? null;
  }, [sorted]);
  const title = `Sources (${sorted.length})`;

  // Docked mode has no dialog to hand focus back, so remember where the user came from.
  useEffect(() => {
    if (!open || !docked) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !contentRef.current?.contains(active)) {
      openerRef.current = active;
    }
    // The aside comes last in the tab order, past the composer: bring keyboard users to it.
    const last = lastInput.current;
    if (
      last.keyboard &&
      Date.now() - last.at <= 1000 &&
      last.target instanceof Element &&
      last.target.closest("button:not([type='submit']), a")
    ) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [open, docked, lastInput]);

  // Declared after the effect above, so that a chip's card wins over the panel heading.
  useEffect(() => {
    const container = contentRef.current;
    if (!open || !container || !activation || activation.count === handledActivation.current) return;
    handledActivation.current = activation.count;
    // §5.7 activation step 4, §9 #7: a chip pressed with Enter/Space moves focus to its card.
    if (!activation.viaKeyboard) return;
    container
      .querySelector<HTMLElement>(`[data-marker="${activation.citation.marker}"] [data-card-heading]`)
      ?.focus({ preventScroll: true });
  }, [open, activation]);

  const closeDocked = () => {
    const opener = openerRef.current;
    onClose();
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // The page may already have focused the chip; only fill the gap the unmounted aside left.
      if ((!active || active === document.body) && opener?.isConnected) opener.focus({ preventScroll: true });
    });
  };

  // One "Back to answer": inside the selected card, so keyboard users needn't tab through the rest.
  const hasActiveCard = sorted.some((c) => c.marker === activeMarker);

  const empty = <p className="text-sm text-muted">This answer has no sources to show.</p>;

  if (docked) {
    if (!open) return null;
    return (
      <aside
        id="sources-panel"
        aria-label="Sources"
        ref={contentRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeDocked();
        }}
        className="flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-border bg-panel"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
          <h2 ref={headingRef} tabIndex={-1} className="rounded-lg text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close sources"
            onClick={closeDocked}
            className={cx(
              "inline-flex size-10 items-center justify-center rounded-lg text-muted",
              "transition-colors hover:bg-panel-2 hover:text-text",
            )}
          >
            <Icon name="close" width={18} height={18} />
          </button>
        </header>
        <div data-scroll-container className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {sorted.length ? (
            <SourceList
              citations={sorted}
              numbers={numbers}
              activeMarker={activeMarker}
              bestMarker={bestMarker}
              onSelect={onSelect}
              onBack={closeDocked}
            />
          ) : (
            empty
          )}
          {!hasActiveCard && <BackToAnswer onClick={closeDocked} />}
        </div>
      </aside>
    );
  }

  if (drawer) {
    return (
      <Sheet open={open} onClose={onClose} title={title} side="right">
        <div id="sources-panel" ref={contentRef}>
          {sorted.length ? (
            <SourceList
              citations={sorted}
              numbers={numbers}
              activeMarker={activeMarker}
              bestMarker={bestMarker}
              onSelect={onSelect}
              onBack={onClose}
            />
          ) : (
            empty
          )}
          {!hasActiveCard && <BackToAnswer onClick={onClose} />}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} side="bottom">
      <div id="sources-panel" ref={contentRef}>
        {sorted.length ? (
          <SheetPager
            citations={sorted}
            numbers={numbers}
            activeMarker={activeMarker}
            bestMarker={bestMarker}
            onSelect={onSelect}
            onBack={onClose}
          />
        ) : (
          empty
        )}
        {!hasActiveCard && <BackToAnswer onClick={onClose} />}
      </div>
    </Sheet>
  );
}

interface SourceListProps {
  citations: Citation[];
  numbers: Map<number, number>;
  activeMarker: number | null;
  bestMarker: number | null;
  onSelect: (marker: number) => void;
  onBack: () => void;
}

function SourceList({ citations, numbers, activeMarker, bestMarker, onSelect, onBack }: SourceListProps) {
  return (
    <ol className="flex flex-col gap-3">
      {citations.map((c) => (
        <li key={`${c.marker}-${c.chunk_id ?? c.document_id}`}>
          <SourceCard
            citation={c}
            number={numbers.get(c.marker) ?? c.marker}
            active={c.marker === activeMarker}
            isBest={c.marker === bestMarker}
            onSelect={() => onSelect(c.marker)}
            footer={c.marker === activeMarker ? <BackToAnswer onClick={onBack} /> : undefined}
          />
        </li>
      ))}
    </ol>
  );
}

/** Focus going back to the chip is the page's job (it owns the chips). */
function BackToAnswer({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-accent",
        "transition-colors hover:bg-accent-soft pointer-coarse:h-11",
      )}
    >
      <span aria-hidden="true">←</span>
      Back to answer
    </button>
  );
}

/** Below 1024px: one card at a time behind "‹ 2 of 3 ›". */
function SheetPager({ citations, numbers, activeMarker, bestMarker, onSelect, onBack }: SourceListProps) {
  const index = Math.max(
    0,
    citations.findIndex((c) => c.marker === activeMarker),
  );
  const current = citations[index];
  const total = citations.length;

  const go = (delta: number) => {
    const next = citations[index + delta];
    if (!next) return;
    onSelect(next.marker);
    announce(`${index + delta + 1} of ${total}. ${citationLabel(next, numbers.get(next.marker) ?? next.marker)}`);
  };

  const pagerButton = (delta: -1 | 1) => {
    const unavailable = !citations[index + delta];
    return (
      <button
        type="button"
        aria-label={delta < 0 ? "Previous source" : "Next source"}
        // aria-disabled, not disabled: the button keeps focus at either end (§9 #5).
        aria-disabled={unavailable || undefined}
        onClick={() => go(delta)}
        className={cx(
          "inline-flex size-11 items-center justify-center rounded-lg border border-border-strong text-xl leading-none",
          "transition-colors",
          unavailable ? "cursor-not-allowed text-muted opacity-50" : "text-text hover:bg-panel-2",
        )}
      >
        <span aria-hidden="true">{delta < 0 ? "‹" : "›"}</span>
      </button>
    );
  };

  return (
    <>
      {total > 1 && (
        <div className="mb-3 flex items-center justify-center gap-3">
          {pagerButton(-1)}
          <span className="min-w-16 text-center text-sm font-medium tabular-nums">
            {index + 1} of {total}
          </span>
          {pagerButton(1)}
        </div>
      )}
      <SourceCard
        key={`${current.marker}-${current.chunk_id ?? current.document_id}`}
        citation={current}
        number={numbers.get(current.marker) ?? current.marker}
        active={current.marker === activeMarker}
        isBest={current.marker === bestMarker}
        onSelect={() => onSelect(current.marker)}
        footer={current.marker === activeMarker ? <BackToAnswer onClick={onBack} /> : undefined}
      />
    </>
  );
}
