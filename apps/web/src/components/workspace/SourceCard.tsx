"use client";

import { useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { announce } from "@/lib/announce";
import { MeContext } from "@/lib/hooks";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import {
  chipTone,
  citationName,
  citationPlace,
  isDocumentDeleted,
  SOURCE_GONE,
  useCitationActivations,
  useCitationHover,
} from "./CitationChip";
import type { Citation } from "./types";
import { WorkspaceContext } from "./WorkspaceContext";

/** Splits a name so its end stays on screen: only the first part truncates, at any width. */
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  const cut = dot > 0 ? Math.max(0, dot - 4) : name.length;
  return [name.slice(0, cut), name.slice(cut)];
}

// Works under either shell: the console provides MeContext, the workspace WorkspaceContext.
function useCanReadContent(): boolean {
  const me = useContext(MeContext);
  const workspace = useContext(WorkspaceContext);
  return (me ?? workspace?.me)?.permissions.includes("document:read_content") ?? false;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Centres the card inside its own scroll area without scrolling the page or the thread. */
function centreInScrollArea(el: HTMLElement) {
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  const area = el.closest<HTMLElement>("[data-scroll-container]");
  if (!area) {
    el.scrollIntoView({ block: "center", behavior });
    return;
  }
  const offset = el.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop;
  area.scrollTo({ top: offset - (area.clientHeight - el.offsetHeight) / 2, behavior });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Plain-http LAN installs have no async clipboard; fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

const actionClass = cx(
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted",
  "transition-colors hover:bg-panel-2 hover:text-text pointer-coarse:h-11",
);

/** One source card: chip, filename, page, highlighted quote, Best match, Copy quote, Download.
 *  A deleted document keeps its number and any quote we still have, but offers no download. */
export function SourceCard({
  citation,
  number,
  active,
  isBest,
  onSelect,
  footer,
}: {
  citation: Citation;
  number: number;
  active: boolean;
  isBest: boolean;
  onSelect: () => void;
  footer?: ReactNode;
}) {
  const deleted = isDocumentDeleted(citation);
  const name = citationName(citation);
  const quote: string = citation.quote || "";
  const { hovered, hoverProps } = useCitationHover(citation);
  const canDownload = useCanReadContent();
  const cardRef = useRef<HTMLDivElement>(null);
  const quoteRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [copied, setCopied] = useState(false);

  // Each activation bumps `flash`, which remounts the tint layer and replays the animation once.
  const [flash, setFlash] = useState(0);
  const [flashDone, setFlashDone] = useState(0);
  const [wasActive, setWasActive] = useState(false);
  // A chip pressed again changes nothing else, but still runs the flash and centring (§5.7).
  const activations = useCitationActivations(citation);
  const [seenActivations, setSeenActivations] = useState(activations);
  if (active !== wasActive || activations !== seenActivations) {
    setWasActive(active);
    setSeenActivations(activations);
    if ((active && !wasActive) || activations !== seenActivations) setFlash((n) => n + 1);
  }

  useEffect(() => {
    if (!flash) return;
    // Next frame: a sheet that opens in this same commit is laid out by then.
    const frame = requestAnimationFrame(() => {
      if (cardRef.current) centreInScrollArea(cardRef.current);
    });
    // The 1.2s flash, or the static tint shown instead under reduced motion, ends after 2s.
    const timer = window.setTimeout(() => setFlashDone(flash), 2000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [flash]);

  // ResizeObserver reports once on observe (and again when a closed sheet first lays out), so it
  // alone decides whether the 6-line clamp is hiding text.
  useEffect(() => {
    const el = quoteRef.current;
    if (!el || expanded) return;
    const observer = new ResizeObserver(() => setOverflows(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, quote]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onCopy = async () => {
    if (await copyText(quote)) {
      setCopied(true);
      announce("Quote copied");
    } else {
      announce("Couldn't copy the quote");
    }
  };

  // Pointer convenience only; keyboard users select through the chips and the pager.
  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    if (!active) onSelect();
  };

  const place = citationPlace(citation);
  const shownPlace = place === "section" ? "Section" : `Page ${citation.page}`;
  const [nameStart, nameEnd] = splitName(name);

  return (
    <div
      ref={cardRef}
      {...hoverProps}
      data-marker={citation.marker}
      data-deleted={deleted ? "" : undefined}
      onClick={onCardClick}
      className={cx(
        "relative isolate rounded-xl border bg-panel p-3 transition-colors",
        active ? "border-accent" : hovered ? "border-border-strong" : "border-border",
      )}
    >
      {flash > flashDone && (
        <span
          key={flash}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] animate-flash motion-reduce:bg-accent/18"
        />
      )}

      <h3
        tabIndex={-1}
        data-card-heading
        className="flex min-w-0 items-center gap-2 rounded-lg text-[13px]/5 font-medium"
      >
        <span
          aria-hidden="true"
          className={cx(
            "cite-chip inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px]",
            "text-[11px]/[18px] font-semibold tabular-nums",
            chipTone(citation, active),
          )}
        >
          {number}
        </span>
        <span className="sr-only">
          {deleted
            ? `Source ${number} · ${SOURCE_GONE}${name ? ` · ${name}` : ""}`
            : `Source ${number} · ${name} · ${place}`}
        </span>
        {deleted ? (
          <span aria-hidden="true" className="min-w-0 text-muted">
            {SOURCE_GONE}
          </span>
        ) : (
          <>
            <span aria-hidden="true" title={name} className="flex min-w-0 text-text">
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{nameStart}</span>
              <span className="shrink-0 whitespace-pre">{nameEnd}</span>
            </span>
            <span aria-hidden="true" className="ml-auto shrink-0 font-normal text-muted">
              {shownPlace}
            </span>
          </>
        )}
      </h3>
      {deleted && name && (
        <p title={name} className="mt-1 truncate text-[13px]/5 text-muted">
          {name}
        </p>
      )}

      {quote && (
        <p
          ref={quoteRef}
          className={cx(
            "mt-2 whitespace-pre-line text-sm/[22px]",
            deleted ? "text-muted" : "text-text",
            !expanded && "line-clamp-6",
          )}
        >
          <span className="sr-only">Quoted passage: </span>
          {deleted ? (
            quote
          ) : (
            <mark
              className={cx(
                "box-decoration-clone rounded-[4px] px-0.5 text-text transition-colors",
                active || hovered ? "bg-cite-hl-active" : "bg-cite-hl",
              )}
            >
              {quote}
            </mark>
          )}
        </p>
      )}
      {!quote && deleted && (
        <p className="mt-2 text-sm/[22px] text-muted">The document was removed, so this passage can&apos;t be shown.</p>
      )}
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex min-h-6 items-center rounded-lg text-[13px] font-medium text-accent hover:underline pointer-coarse:min-h-11"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1 empty:hidden">
        {isBest && !deleted && (
          <span className="badge mr-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
            <Icon name="check" width={12} height={12} />
            Best match
          </span>
        )}
        {quote && (
          <button type="button" onClick={() => void onCopy()} className={actionClass}>
            <Icon name={copied ? "check" : "quote"} />
            {copied ? "Copied" : "Copy quote"}
          </button>
        )}
        {canDownload && !deleted && citation.document_id && (
          <a
            href={`/api/v1/documents/${encodeURIComponent(citation.document_id)}/download`}
            download
            className={actionClass}
          >
            <DownloadGlyph />
            Download file
          </a>
        )}
      </div>
      {footer}
    </div>
  );
}

function DownloadGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
    </svg>
  );
}
