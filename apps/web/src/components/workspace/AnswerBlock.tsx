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
  isDocumentDeleted,
  SOURCE_GONE,
  sourceNumbers,
  useCitationHover,
} from "./CitationChip";
import type { AnswerMode, AnswerView, Citation, ModelRef } from "./types";

const MARKER_RE = /\[(\d{1,3})\]/g;
const UNMATCHED_RE = /[ \t]*\[(\d{1,3})\]/g;

const bodyText = "text-[16px] leading-[26px] text-text";
const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted " +
  "transition-colors duration-150 hover:bg-panel-2 hover:text-text pointer-coarse:h-11";

/** Keyboard activation of a <button> fires a click with detail 0. */
const viaKeyboard = (e: MouseEvent) => e.detail === 0;

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
    if (model.provider === "extractive") return { label: "Exact quotes · no AI writing", extractive: true };
    if (model.provider === "anthropic") return { label: "Written by Claude", extractive: false };
    return { label: `Written by ${model.name}`, extractive: false };
  }
  if (mode === "extractive") return { label: "Exact quotes · no AI writing", extractive: true };
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
        "badge inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs font-medium",
        tone === "ok" ? "bg-ok-soft text-ok" : "bg-panel-2 text-muted",
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

function QuoteText({ tinted, muted, children }: { tinted?: boolean; muted?: boolean; children: ReactNode }) {
  return (
    <blockquote
      className={cx(
        bodyText,
        "whitespace-pre-line wrap-anywhere rounded-r-lg border-l-[3px] px-4 py-3",
        "transition-colors duration-150",
        muted ? "border-border-strong" : "border-accent",
        tinted && "bg-cite-hl",
      )}
    >
      {children}
    </blockquote>
  );
}

/** A quote and the link to its source, which cross-highlights with the source card. */
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
  return (
    <figure>
      <QuoteText tinted={active || hovered} muted={deleted}>
        {sentences.join(" ")}
      </QuoteText>
      <figcaption className="mt-1 pl-4">
        <button
          type="button"
          {...hoverProps}
          aria-current={active ? "true" : undefined}
          title={deleted ? SOURCE_GONE : name}
          onClick={(e) => onCite(citation, viaKeyboard(e))}
          className={cx(
            "inline-flex min-h-6 items-center rounded-lg text-left text-[13px] leading-5 underline-offset-2",
            "hover:underline pointer-coarse:min-h-11",
            deleted ? "text-muted" : "text-accent",
            (active || hovered) && "underline",
            active && "font-semibold",
          )}
        >
          <span className="sr-only">{`Source ${number}: `}</span>
          <span>
            {name && middleTruncate(name, 48)}
            {deleted ? `${name ? " · " : ""}${SOURCE_GONE}` : ` · ${citationPlace(citation)}`}
          </span>
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
          <figure key={`t${i}`}>
            <QuoteText muted={g.lost}>{g.sentences.join(" ")}</QuoteText>
            {g.lost && <figcaption className="mt-1 pl-4 text-[13px] leading-5 text-muted">{SOURCE_GONE}</figcaption>}
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
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    const citation = byMarker.get(Number(m[1]));
    if (!citation) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <CitationChip
        key={`c${m.index}`}
        citation={citation}
        number={numbers.get(citation.marker) ?? citation.marker}
        active={citation.marker === activeMarker}
        onActivate={onCite}
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className={cx(bodyText, "whitespace-pre-wrap wrap-anywhere")}>{parts}</p>;
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
        .join(" · ")
    : undefined;

  async function copy() {
    const ordered = [...citations].sort((a, b) => a.marker - b.marker);
    const body = text.replace(MARKER_RE, (m, n: string) => {
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
        fresh && "transition-[opacity,translate] duration-200 ease-[var(--ease-snappy)] starting:opacity-0 motion-safe:starting:translate-y-1",
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
            "inline-flex min-h-8 items-center gap-2 self-start rounded-lg text-[13px] text-muted",
            "transition-colors duration-150 hover:text-text pointer-coarse:min-h-11",
          )}
        >
          <span aria-hidden="true" className="flex items-center">
            {docs.slice(0, 3).map((d, i) => (
              <span
                key={d.document_id ?? `m${d.marker}`}
                className={cx(
                  "grid size-5 place-items-center rounded-lg border border-border bg-panel text-muted",
                  i > 0 && "-ml-1.5",
                )}
              >
                <Icon name="file" width={12} height={12} />
              </span>
            ))}
          </span>
          <span>
            {plural(citations.length, "passage", "passages")} from {plural(docs.length, "document", "documents")}
            {goneCount > 0 && ` · ${goneCount} no longer available`}
            <span aria-hidden="true"> ›</span>
          </span>
        </button>
      )}

      <div
        className={cx(
          "-ml-2 flex flex-wrap items-center gap-1",
          !isLatest &&
            "opacity-0 transition-opacity duration-150 group-hover/answer:opacity-100 group-focus-within/answer:opacity-100 [@media(hover:none)]:opacity-100",
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
