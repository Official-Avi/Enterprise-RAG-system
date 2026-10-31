"use client";

import { cx } from "@/components/ui";
import type { Citation } from "./types";

/** "Source 1: handbook.pdf, page 12". Starts with the visible number (§9 #8, WCAG 2.5.3). */
function citationLabel(citation: Citation): string {
  const page = citation.page != null ? `, page ${citation.page}` : "";
  return `Source ${citation.marker}: ${citation.filename}${page}`;
}

/** Numbered source chip (§5.7). */
export function CitationChip({
  citation,
  active,
  onActivate,
}: {
  citation: Citation;
  active: boolean;
  onActivate: (citation: Citation, viaKeyboard: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={citationLabel(citation)}
      aria-current={active ? "true" : undefined}
      // detail is 0 for clicks synthesised from Enter/Space, so keyboard users get the card focused.
      onClick={(e) => onActivate(citation, e.detail === 0)}
      className={cx(
        "cite-chip relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px]",
        "align-[2px] text-[11px]/[18px] font-semibold tabular-nums transition-[color,background-color,box-shadow]",
        // Invisible hit area: 24x24 (WCAG 2.5.8), 44x44 on touch.
        "before:absolute before:-inset-[3px] before:content-[''] pointer-coarse:before:-inset-[13px]",
        active
          ? "bg-cite-chip-active-bg text-cite-chip-active-fg"
          : "bg-cite-chip-bg text-cite-chip-fg hover:ring-1 hover:ring-cite-chip-fg",
      )}
    >
      {citation.marker}
    </button>
  );
}
