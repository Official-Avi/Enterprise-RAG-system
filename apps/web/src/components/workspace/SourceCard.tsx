"use client";

import { useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { announce } from "@/lib/announce";
import { MeContext } from "@/lib/hooks";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import {
  chipShape,
  chipTone,
  citationLabel,
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
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-text-2",
  "transition-colors duration-[var(--dur-micro)] ease-out hover:bg-panel-3 hover:text-text active:bg-panel-3",
  "pointer-coarse:h-11 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent",
);

/** One source row: chip, filename, Best match, page, highlighted quote, Copy quote, Download.
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
  const [nameStart, nameEnd] = splitName(name);

  return (
    <div
      ref={cardRef}
      {...hoverProps}
      data-marker={citation.marker}
      data-deleted={deleted ? "" : undefined}
      onClick={onCardClick}
      className={cx(
        "relative isolate px-4 py-4 transition-colors duration-[var(--dur-micro)] ease-out",
        active ? "bg-accent-soft" : hovered ? "bg-panel-2" : !deleted && "cursor-pointer hover:bg-panel-2",
      )}
    >
      {flash > flashDone && (
        <span
          key={flash}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 animate-flash motion-reduce:bg-accent/18"
        />
      )}

      <h3
        tabIndex={-1}
        data-card-heading
        className="flex min-w-0 items-center gap-2 rounded-md text-sm/5 font-medium focus-visible:outline-offset-4"
      >
        <span aria-hidden="true" className={cx(chipShape, chipTone(citation, active))}>
          {number}
        </span>
        <span className="sr-only">{citationLabel(citation, number)}</span>
        {deleted ? (
          <span aria-hidden="true" className="min-w-0 font-normal text-muted">
            {SOURCE_GONE}
          </span>
        ) : (
          <>
            <span aria-hidden="true" title={name} className="flex min-w-0 text-text">
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{nameStart}</span>
              <span className="shrink-0 whitespace-pre">{nameEnd}</span>
            </span>
            {isBest && (
              <span
                aria-hidden="true"
                className="badge inline-flex h-6 shrink-0 items-center gap-1 rounded-chip border border-border bg-panel px-2 text-xs font-medium text-text-2"
              >
                <Icon name="check" width={12} height={12} className="text-ok" />
                Best match
              </span>
            )}
            <span
              aria-hidden="true"
              className={cx("ml-auto shrink-0 pl-2 text-xs font-normal text-muted", place !== "section" && "font-mono")}
            >
              {place === "section" ? "Section" : `p. ${citation.page}`}
            </span>
          </>
        )}
      </h3>
      {isBest && !deleted && <p className="sr-only">Best match</p>}
      {deleted && name && (
        <p title={name} className="mt-1 truncate pl-7 text-xs text-muted line-through">
          {name}
        </p>
      )}

      {quote && (
        <p
          ref={quoteRef}
          className={cx(
            "mt-2 pl-7 whitespace-pre-line text-sm leading-6 wrap-anywhere",
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
                "box-decoration-clone rounded-sm px-0.5 text-text transition-colors duration-[var(--dur-micro)] ease-out",
                active || hovered ? "bg-cite-hl-active" : "bg-cite-hl",
              )}
            >
              {quote}
            </mark>
          )}
        </p>
      )}
      {!quote && deleted && (
        <p className="mt-2 pl-7 text-sm leading-6 text-muted">The document was removed, so this passage can&apos;t be shown.</p>
      )}
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={cx(
            "mt-1 ml-5 inline-flex min-h-8 items-center rounded-md px-2 text-sm font-medium text-accent underline-offset-2",
            "hover:underline active:text-accent-hover pointer-coarse:min-h-11",
          )}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-5 empty:hidden">
        {quote && (
          <button type="button" onClick={() => void onCopy()} className={actionClass}>
            <Icon name={copied ? "check" : "copy"} />
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
      {footer && <div className="pl-5">{footer}</div>}
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
