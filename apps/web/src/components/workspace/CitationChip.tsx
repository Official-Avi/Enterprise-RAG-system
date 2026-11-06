"use client";

import { useEffect, useSyncExternalStore, type PointerEvent } from "react";
import { cx } from "@/components/ui";
import type { Citation } from "./types";

export const SOURCE_GONE = "Source no longer available";

const SECTION_EXT = /\.(txt|md|markdown)$/i;

/** True when the API says the cited document was deleted. Its filename, page and quote may be null. */
export function isDocumentDeleted(citation: Citation): boolean {
  return citation.document_deleted === true;
}

/** The filename, or "" when a deleted document's record no longer carries one. */
export function citationName(citation: Citation): string {
  return citation.filename || "";
}

/** Where the passage is: "page 12" or "section" (TXT/MD have no pages, §5.7). Every surface uses it. */
export function citationPlace(citation: Citation): string {
  if (citation.page == null || SECTION_EXT.test(citationName(citation))) return "section";
  return `page ${citation.page}`;
}

/** Markers come from the retrieved list, so an answer can cite only [2] and [5]. People see 1 and 2. */
export function sourceNumbers(citations: Citation[]): Map<number, number> {
  const markers = citations.map((c) => c.marker).sort((a, b) => a - b);
  return new Map(markers.map((marker, i) => [marker, i + 1]));
}

/** "Source 1: handbook.pdf, page 12". Starts with the visible number (§9 #8, WCAG 2.5.3). */
export function citationLabel(citation: Citation, number: number): string {
  const name = citationName(citation);
  if (isDocumentDeleted(citation)) return `Source ${number}: ${SOURCE_GONE}${name ? ` (${name})` : ""}`;
  return `Source ${number}: ${name}, ${citationPlace(citation)}`;
}

// ---------- Signals between the thread and the sources panel (§5.7) ----------
// Both surfaces hold the same Citation objects, so identity also says which answer is meant.

export interface CitationActivation {
  count: number;
  citation: Citation;
  viaKeyboard: boolean;
}

let hoveredCitation: Citation | null = null;
let lastActivation: CitationActivation | null = null;
const activationCounts = new WeakMap<Citation, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setHovered(citation: Citation | null) {
  if (hoveredCitation === citation) return;
  hoveredCitation = citation;
  listeners.forEach((l) => l());
}

/** Every activation counts, including pressing the chip that is already selected: §5.7's flash,
 *  centring and focus steps must run again then, though no selection state changes. */
export function noteCitationActivated(citation: Citation, viaKeyboard: boolean) {
  activationCounts.set(citation, (activationCounts.get(citation) ?? 0) + 1);
  lastActivation = { count: (lastActivation?.count ?? 0) + 1, citation, viaKeyboard };
  listeners.forEach((l) => l());
}

export function useLastCitationActivation(): CitationActivation | null {
  return useSyncExternalStore(
    subscribe,
    () => lastActivation,
    () => null,
  );
}

export function useCitationActivations(citation: Citation): number {
  return useSyncExternalStore(
    subscribe,
    () => activationCounts.get(citation) ?? 0,
    () => 0,
  );
}

/** Hovering a card highlights its chips, and the reverse (§5.7). Mouse only: touch has no hover. */
export function useCitationHover(citation: Citation) {
  const hovered = useSyncExternalStore(
    subscribe,
    () => hoveredCitation === citation,
    () => false,
  );
  useEffect(
    () => () => {
      if (hoveredCitation === citation) setHovered(null);
    },
    [citation],
  );
  return {
    hovered,
    hoverProps: {
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType === "mouse") setHovered(citation);
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType === "mouse") setHovered(null);
      },
    },
  };
}

/** The chip's colours, shared with the badge on the source card. */
export function chipTone(citation: Citation, active: boolean): string {
  if (isDocumentDeleted(citation)) {
    return active ? "bg-muted text-panel" : "bg-panel-2 text-muted ring-1 ring-border-strong";
  }
  return active ? "bg-cite-chip-active-bg text-cite-chip-active-fg" : "bg-cite-chip-bg text-cite-chip-fg";
}

/** Numbered source chip (§5.7). Grey and labelled "Source no longer available" for a deleted document. */
export function CitationChip({
  citation,
  number,
  active,
  onActivate,
}: {
  citation: Citation;
  number: number;
  active: boolean;
  onActivate: (citation: Citation, viaKeyboard: boolean) => void;
}) {
  const { hovered, hoverProps } = useCitationHover(citation);
  const deleted = isDocumentDeleted(citation);
  return (
    <button
      type="button"
      {...hoverProps}
      aria-label={citationLabel(citation, number)}
      aria-current={active ? "true" : undefined}
      title={deleted ? SOURCE_GONE : undefined}
      // detail is 0 for clicks synthesised from Enter/Space, so keyboard users get the card focused.
      onClick={(e) => onActivate(citation, e.detail === 0)}
      className={cx(
        "cite-chip relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px]",
        "align-[2px] text-[11px]/[18px] font-semibold tabular-nums transition-[color,background-color,box-shadow]",
        // Invisible hit area: 24x24 (WCAG 2.5.8), 44x44 on touch.
        "before:absolute before:-inset-[3px] before:content-[''] pointer-coarse:before:-inset-[13px]",
        chipTone(citation, active),
        !active && "hover:ring-1 hover:ring-cite-chip-fg",
        !active && hovered && "ring-1 ring-cite-chip-fg",
      )}
    >
      {number}
    </button>
  );
}
