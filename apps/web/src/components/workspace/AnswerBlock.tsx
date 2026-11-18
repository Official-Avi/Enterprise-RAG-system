"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { announce } from "@/lib/announce";
import { middleTruncate } from "@/lib/status";
import { Icon } from "../icons";
import { cx } from "../ui";
import {
  citationName,
  citationPlace,
  CitationChip,
  chipShape,
  chipTone,
  isDocumentDeleted,
  SOURCE_GONE,
  sourceNumbers,
  useCitationHover,
} from "./CitationChip";
import type { AnswerMode, AnswerView, Citation, ModelRef } from "./types";

const MARKER_RE = /\[(\d{1,3})\]/g;
const UNMATCHED_RE = /[ \t]*\[(\d{1,3})\]/g;
// The model sometimes writes Markdown. Only these two are rendered; never raw HTML.
const BOLD_RE = /\*\*(?=\S)([^\n]*?\S)\*\*/g;
const HEADING_RE = /^#{1,6}[ \t]+/gm;
const HEADING_LINE = /^#{1,6}[ \t]+/;
const BULLET_LINE = /^[ \t]*[-*+][ \t]+/;
const NUMBER_LINE = /^[ \t]*(\d{1,3})[.)][ \t]+/;

// The answer reads as a document: 16px on a 28px line, at most 72 characters wide.
const bodyText = "max-w-[72ch] text-base leading-7 text-text";
const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted " +
  "transition-colors duration-[var(--dur-micro)] ease-out hover:bg-panel-2 hover:text-text " +
  "active:bg-panel-3 pointer-coarse:h-11";

/** Keyboard activation of a <button> fires a click with detail 0. */
const viaKeyboard = (e: MouseEvent) => e.detail === 0;

/** What a written answer reads as without its Markdown, for Copy. */
function withoutMarkdown(text: string): string {
  return text.replace(HEADING_RE, "").replace(BOLD_RE, "$1");
}

/** Remove [n] markers that don't match a citation (and the space before them). */
function stripUnmatched(text: string, byMarker: Map<number, Citation>): string {
  return text.replace(UNMATCHED_RE, (m, n: string) => (byMarker.has(Number(n)) ? m : ""));
}

interface QuoteGroup {
  citation: Citation | null;
  /** The sentence's [n] has no citation any more: its source was removed from this answer. */
  lost: boolean;
  sentences: string[];
}

/** Extractive answers read "sentence [1] sentence [1] sentence [2]": each sentence belongs to the
 *  marker that follows it. Groups keep the order in which their source first appears. A marker with
 *  no citation still ends its sentence, so that text never joins the next source's quote. */
function groupQuotes(text: string, byMarker: Map<number, Citation>): QuoteGroup[] {
  const groups = new Map<number, QuoteGroup>();
  const order: QuoteGroup[] = [];
  let pending = "";
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    pending += text.slice(last, m.index);
    last = m.index + m[0].length;
    const marker = Number(m[1]);
    const citation = byMarker.get(marker) ?? null;
    const sentence = pending.trim();
    pending = "";
    if (!sentence) continue;
    let group = groups.get(marker);
    if (!group) {
      group = { citation, lost: !citation, sentences: [] };
      groups.set(marker, group);
      order.push(group);
    }
    group.sentences.push(sentence);
  }
  const tail = (pending + text.slice(last)).trim();
  if (tail) order.push({ citation: null, lost: false, sentences: [tail] });
  return order;
}

function modeBadge(model: ModelRef | null, mode?: AnswerMode): { label: string; extractive: boolean } | null {
  if (model) {
    if (model.provider === "extractive") return { label: "Exact quotes, no AI writing", extractive: true };
    if (model.provider === "anthropic") return { label: "Written by Claude", extractive: false };
    return { label: `Written by ${model.name}`, extractive: false };
  }
  if (mode === "extractive") return { label: "Exact quotes, no AI writing", extractive: true };
  if (mode === "llm") return { label: "Written by Claude", extractive: false };
  return null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sourceLine(c: Citation, number: number): string {
  if (isDocumentDeleted(c)) return `[${number}] ${SOURCE_GONE}`;
  return `[${number}] ${citationName(c)}${citationPlace(c) === "section" ? "" : `, p. ${c.page}`}`;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Plain-http deployments have no async clipboard API.
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

function Badge({ tone, icon, children, title }: { tone: "ok" | "neutral"; icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "badge inline-flex h-6 items-center gap-1 rounded-chip px-2 text-xs font-medium",
        tone === "ok" ? "bg-ok-soft text-ok" : "bg-panel-2 text-text-2",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
    </svg>
  );
}

/** Where a passage sits: "p. 12" in mono (a machine value) or "Section" for files without pages.
 *  Screen readers hear ", page 12" or ", section" instead of the abbreviation. */
function PlaceRef({ citation }: { citation: Citation }) {
  const place = citationPlace(citation);
  return (
    <>
      <span className="sr-only">{`, ${place}`}</span>
      <span aria-hidden="true" className={cx("shrink-0 text-xs text-muted", place !== "section" && "font-mono")}>
        {place === "section" ? "Section" : `p. ${citation.page}`}
      </span>
    </>
  );
}

/** The quoted words in the cobalt marker. Each wrapped line keeps its own padding and corners. */
function Marked({ lit, children }: { lit: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "rounded-sm px-0.5 box-decoration-clone transition-colors duration-[var(--dur-micro)] ease-out",
        lit ? "bg-cite-hl-active" : "bg-cite-hl",
      )}
    >
      {children}
    </span>
  );
}

/** A quote and the link to its source, which cross-highlights with the source row. The number
 *  key on the left is the same object as the chip in written answers. */
function CitedQuote({
  citation,
  number,
  sentences,
  active,
  onCite,
}: {
  citation: Citation;
  number: number;
  sentences: string[];
  active: boolean;
  onCite: (citation: Citation, viaKeyboard: boolean) => void;
}) {
  const { hovered, hoverProps } = useCitationHover(citation);
  const deleted = isDocumentDeleted(citation);
  const name = citationName(citation);
  const lit = active || hovered;
  return (
    <figure {...hoverProps} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      {/* Pointer shortcut only: the caption button below is the keyboard and screen reader path. */}
      <span
        aria-hidden="true"
        onClick={() => onCite(citation, false)}
        className={cx(chipShape, "mt-1 cursor-pointer transition-colors duration-[var(--dur-micro)]", chipTone(citation, active))}
      >
        {number}
      </span>
      <blockquote className={cx(bodyText, "whitespace-pre-line wrap-anywhere", deleted && "text-muted")}>
        {deleted ? sentences.join(" ") : <Marked lit={lit}>{sentences.join(" ")}</Marked>}
      </blockquote>
      <figcaption className="col-start-2 mt-1">
        <button
          type="button"
          aria-current={active ? "true" : undefined}
          title={deleted ? SOURCE_GONE : name}
          onClick={(e) => onCite(citation, viaKeyboard(e))}
          className={cx(
            "group/cap -mx-1 inline-flex min-h-8 max-w-full items-baseline gap-2 rounded-md px-1 py-1.5 text-left",
            "transition-colors duration-[var(--dur-micro)] ease-out hover:bg-panel-2 active:bg-panel-3",
            "pointer-coarse:min-h-11",
          )}
        >
          <span className="sr-only">{`Source ${number}: `}</span>
          {name && (
            <span
              className={cx(
                "min-w-0 truncate text-sm font-medium underline-offset-2",
                deleted ? "text-muted line-through" : "text-accent group-hover/cap:underline",
                lit && !deleted && "underline",
              )}
            >
              {middleTruncate(name, 48)}
            </span>
          )}
          {deleted ? (
            <span className="shrink-0 text-xs text-muted">
              {name && <span className="sr-only">, </span>}
              {SOURCE_GONE}
            </span>
          ) : (
            <PlaceRef citation={citation} />
          )}
        </button>
      </figcaption>
    </figure>
  );
}

function QuoteBlocks({
  groups,
  numbers,
  activeMarker,
  onCite,
}: {
  groups: QuoteGroup[];
  numbers: Map<number, number>;
  activeMarker: number | null;
  onCite: (citation: Citation, viaKeyboard: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) =>
        g.citation ? (
          <CitedQuote
            key={`m${g.citation.marker}`}
            citation={g.citation}
            number={numbers.get(g.citation.marker) ?? g.citation.marker}
            sentences={g.sentences}
            active={g.citation.marker === activeMarker}
            onCite={onCite}
          />
        ) : (
          <figure key={`t${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
            {/* Keeps the text on the same left edge as the numbered quotes. */}
            <span aria-hidden="true" className="w-5" />
            <blockquote className={cx(bodyText, "whitespace-pre-line wrap-anywhere", g.lost && "text-muted")}>
              {g.sentences.join(" ")}
            </blockquote>
            {g.lost && <figcaption className="col-start-2 mt-1 text-xs text-muted">{SOURCE_GONE}</figcaption>}
          </figure>
        ),
      )}
    </div>
  );
}

function TextWithChips({
  text,
  byMarker,
  numbers,
  activeMarker,
  onCite,
}: {
  text: string;
  byMarker: Map<number, Citation>;
  numbers: Map<number, number>;
  activeMarker: number | null;
  onCite: (citation: Citation, viaKeyboard: boolean) => void;
}) {
  // `offset` keeps chip keys unique across lines and across the bold and plain runs.
  const withChips = (run: string, offset: number): ReactNode[] => {
    const nodes: ReactNode[] = [];
    let last = 0;
    for (const m of run.matchAll(MARKER_RE)) {
      const citation = byMarker.get(Number(m[1]));
      if (!citation) continue;
      if (m.index > last) nodes.push(run.slice(last, m.index));
      nodes.push(
        <CitationChip
          key={`c${offset + m.index}`}
          citation={citation}
          number={numbers.get(citation.marker) ?? citation.marker}
          active={citation.marker === activeMarker}
          onActivate={onCite}
        />,
      );
      last = m.index + m[0].length;
    }
    if (last < run.length) nodes.push(run.slice(last));
    return nodes;
  };

  // Bold never crosses a line (BOLD_RE stops at \n), so each line is rendered on its own.
  const withBold = (line: string, offset: number): ReactNode[] => {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of line.matchAll(BOLD_RE)) {
      parts.push(...withChips(line.slice(last, m.index), offset + last));
      parts.push(
        <strong key={`b${offset + m.index}`} className="font-semibold">
          {withChips(m[1], offset + m.index + 2)}
        </strong>,
      );
      last = m.index + m[0].length;
    }
    parts.push(...withChips(line.slice(last), offset + last));
    return parts;
  };

  const lines: ReactNode[] = [];
  let start = 0;
  for (const line of text.split("\n")) {
    const at = start;
    start += line.length + 1;
    const heading = line.match(HEADING_LINE);
    const bullet = line.match(BULLET_LINE);
    const numbered = line.match(NUMBER_LINE);
    if (!line.trim()) {
      // A blank line is a paragraph break: a fixed gap instead of an empty 28px line.
      lines.push(<span key={`l${at}`} aria-hidden="true" className="block h-3" />);
    } else if (heading) {
      const cut = heading[0].length;
      lines.push(
        <span key={`l${at}`} className="mt-2 block font-display text-lg font-semibold leading-7 text-text first:mt-0">
          {withBold(line.slice(cut), at + cut)}
        </span>,
      );
    } else if (bullet) {
      const cut = bullet[0].length;
      lines.push(
        <span key={`l${at}`} className="relative block pl-6">
          {/* A small square bullet, centred on the first 28px line. */}
          <span aria-hidden="true" className="absolute top-3 left-2 size-1 rounded-[1px] bg-muted" />

          {withBold(line.slice(cut), at + cut)}
        </span>,
      );
    } else if (numbered) {
      const cut = numbered[0].length;
      lines.push(
        <span key={`l${at}`} className="relative block pl-6">
          <span className="absolute left-0 font-display font-medium tabular-nums text-muted">{`${numbered[1]}.`}</span>
          {withBold(line.slice(cut), at + cut)}
        </span>,
      );
    } else {
      lines.push(
        <span key={`l${at}`} className="block">
          {withBold(line, at)}
        </span>,
      );
    }
  }
  return <p className={cx(bodyText, "whitespace-pre-wrap wrap-anywhere")}>{lines}</p>;
}

/** One answer (§5.6): provenance badges, quote blocks (extractive) or text with chips, sources
 *  row, action row. Thread renders the meta line, so not-found and error turns get it too. */
export function AnswerBlock({
  answer,
  activeMarker,
  isLatest,
  onCite,
  onOpenSources,
  mode,
}: {
  answer: AnswerView;
  activeMarker: number | null;
  isLatest: boolean;
  onCite: (citation: Citation, viaKeyboard: boolean) => void;
  onOpenSources: () => void;
  /** Fallback for answers whose model is unknown (older history rows). */
  mode?: AnswerMode;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const citations = answer.citations;
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  const numbers = sourceNumbers(citations);
  const text = stripUnmatched(answer.text, byMarker);
  const badge = modeBadge(answer.model, mode);
  const extractive = badge?.extractive ?? false;
  const fresh = !answer.fromHistory;

  // A deleted document may have lost its id, so it counts as its own document.
  const docs = [...new Map(citations.map((c) => [c.document_id ?? `m${c.marker}`, c])).values()];
  const goneCount = citations.filter(isDocumentDeleted).length;
  // Every source is gone (or was dropped from the saved answer): nothing backs "Found" any more.
  const sourcesGone = goneCount === citations.length && (goneCount > 0 || text !== answer.text);
  const meta = answer.model
    ? [answer.model.provider, answer.model.name, answer.latency_ms !== null ? `${answer.latency_ms} ms` : null]
        .filter(Boolean)
        .join(", ")
    : undefined;

  async function copy() {
    const ordered = [...citations].sort((a, b) => a.marker - b.marker);
    // Extractive answers are exact quotes, so their characters stay as the document has them.
    const body = (extractive ? text : withoutMarkdown(text)).replace(MARKER_RE, (m, n: string) => {
      const number = numbers.get(Number(n));
      return number ? `[${number}]` : m;
    });
    const lines = ordered.map((c, i) => sourceLine(c, i + 1));
    const payload = lines.length ? `${body}\n\nSources: ${lines.join("; ")}` : body;
    let next: "copied" | "failed" = "copied";
    try {
      await writeClipboard(payload);
      announce("Copied");
    } catch {
      next = "failed";
    }
    setCopyState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div
      className={cx(
        "group/answer flex flex-col gap-3",
        // Only answers that just arrived get the entrance; history renders still.
        fresh && "transition-opacity duration-[var(--dur-short)] ease-out starting:opacity-0",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {answer.evidence_status === "supported" &&
          (sourcesGone ? (
            <Badge tone="neutral" icon={<Icon name="file" width={14} height={14} />}>
              {SOURCE_GONE}
            </Badge>
          ) : (
            <Badge tone="ok" icon={<Icon name="check" width={14} height={14} />}>
              Found in your documents
            </Badge>
          ))}
        {badge && (
          <Badge
            tone="neutral"
            title={meta}
            icon={<Icon name={badge.extractive ? "quote" : "sparkle"} width={14} height={14} />}
          >
            {badge.label}
          </Badge>
        )}
      </div>

      {extractive ? (
        <QuoteBlocks
          groups={groupQuotes(answer.text, byMarker)}
          numbers={numbers}
          activeMarker={activeMarker}
          onCite={onCite}
        />
      ) : (
        <TextWithChips text={text} byMarker={byMarker} numbers={numbers} activeMarker={activeMarker} onCite={onCite} />
      )}

      {citations.length > 0 && (
        <button
          type="button"
          onClick={onOpenSources}
          className={cx(
            "-ml-2 inline-flex min-h-8 items-center gap-2 self-start rounded-md px-2 text-left text-sm text-text-2",
            "transition-colors duration-[var(--dur-micro)] ease-out hover:bg-panel-2 hover:text-text active:bg-panel-3",
            "pointer-coarse:min-h-11",
          )}
        >
          <Icon name="file" className="shrink-0 text-muted" />
          <span>
            {plural(citations.length, "passage", "passages")} from {plural(docs.length, "document", "documents")}
            {goneCount > 0 && `, ${goneCount} no longer available`}
          </span>
        </button>
      )}

      <div
        className={cx(
          "-ml-2 flex flex-wrap items-center gap-1",
          !isLatest &&
            "opacity-0 transition-opacity duration-[var(--dur-micro)] group-hover/answer:opacity-100 group-focus-within/answer:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <button type="button" onClick={copy} className={smallButton}>
          {copyState === "copied" ? <Icon name="check" /> : <CopyIcon />}
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy" : "Copy"}
        </button>
        {citations.length > 0 && (
          <button type="button" onClick={onOpenSources} className={smallButton}>
            <Icon name="quote" />
            Sources ({citations.length})
          </button>
        )}
      </div>
    </div>
  );
}
