"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { announce } from "@/lib/announce";
import { Icon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { cx } from "@/components/ui";
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

/** The props don't say how activeMarker changed, so track the last input: a chip pressed with
 *  Enter/Space moves focus to its card (§5.7 activation step 4, §9 #7); a click doesn't. */
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

function pageSuffix(c: Citation): string {
  return c.page != null ? `, page ${c.page}` : "";
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
  const openerRef = useRef<HTMLElement | null>(null);
  const lastInput = useLastInput();

  const sorted = useMemo(() => [...citations].sort((a, b) => a.marker - b.marker), [citations]);
  const bestMarker = useMemo(() => {
    let best: Citation | null = null;
    for (const c of sorted) if (c.score != null && (best?.score == null || c.score > best.score)) best = c;
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
  }, [open, docked]);

  useEffect(() => {
    const container = contentRef.current;
    const last = lastInput.current;
    if (!open || activeMarker == null || !container) return;
    if (!last.keyboard || Date.now() - last.at > 1000) return;
    // Paging inside the panel keeps focus on the pager.
    if (last.target instanceof Node && container.contains(last.target)) return;
    if (!(last.target instanceof Element) || !last.target.closest("button, a, [role='button']")) return;
    container
      .querySelector<HTMLElement>(`[data-marker="${activeMarker}"] [data-card-heading]`)
      ?.focus({ preventScroll: true });
  }, [open, activeMarker, lastInput]);

  const closeDocked = () => {
    const opener = openerRef.current;
    onClose();
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // The page may already have focused the chip; only fill the gap the unmounted aside left.
      if ((!active || active === document.body) && opener?.isConnected) opener.focus({ preventScroll: true });
    });
  };

  const list = (
    <ol className="flex flex-col gap-3">
      {sorted.map((c) => (
        <li key={`${c.marker}-${c.chunk_id ?? c.document_id}`}>
          <SourceCard
            citation={c}
            active={c.marker === activeMarker}
            isBest={c.marker === bestMarker}
            onSelect={() => onSelect(c.marker)}
          />
        </li>
      ))}
    </ol>
  );

  const empty = <p className="text-sm text-muted">This answer has no sources to show.</p>;

  if (docked) {
    if (!open) return null;
    return (
      <aside
        id="sources-panel"
        aria-label="Sources"
        ref={contentRef}
        className="flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-border bg-panel"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
          <h2 className="text-base font-semibold">{title}</h2>
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
          {sorted.length ? list : empty}
          <BackToAnswer onClick={closeDocked} />
        </div>
      </aside>
    );
  }

  if (drawer) {
    return (
      <Sheet open={open} onClose={onClose} title={title} side="right">
        <div id="sources-panel" ref={contentRef}>
          {sorted.length ? list : empty}
          <BackToAnswer onClick={onClose} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} side="bottom">
      <div id="sources-panel" ref={contentRef}>
        {sorted.length ? (
          <SheetPager citations={sorted} activeMarker={activeMarker} bestMarker={bestMarker} onSelect={onSelect} />
        ) : (
          empty
        )}
        <BackToAnswer onClick={onClose} />
      </div>
    </Sheet>
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
function SheetPager({
  citations,
  activeMarker,
  bestMarker,
  onSelect,
}: {
  citations: Citation[];
  activeMarker: number | null;
  bestMarker: number | null;
  onSelect: (marker: number) => void;
}) {
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
    announce(`${index + delta + 1} of ${total}. Source ${next.marker}: ${next.filename}${pageSuffix(next)}`);
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
          "inline-flex size-11 items-center justify-center rounded-lg border border-border text-xl leading-none",
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
        active={current.marker === activeMarker}
        isBest={current.marker === bestMarker}
        onSelect={() => onSelect(current.marker)}
      />
    </>
  );
}
