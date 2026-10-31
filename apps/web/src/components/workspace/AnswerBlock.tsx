"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { announce } from "@/lib/announce";
import { middleTruncate } from "@/lib/status";
import { Icon } from "../icons";
import { cx } from "../ui";
import { CitationChip } from "./CitationChip";
import type { AnswerMode, AnswerView, Citation, ModelRef } from "./types";

const MARKER_RE = /\[(\d{1,3})\]/g;
const UNMATCHED_RE = /[ \t]*\[(\d{1,3})\]/g;

const bodyText = "text-[16px] leading-[26px] text-text";
const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted " +
  "transition-colors duration-150 hover:bg-panel-2 hover:text-text pointer-coarse:h-11";

/** Keyboard activation of a <button> fires a click with detail 0. */
const viaKeyboard = (e: MouseEvent) => e.detail === 0;

/** Remove [n] markers that don't match a citation (and the space before them). */
function stripUnmatched(text: string, byMarker: Map<number, Citation>): string {
  return text.replace(UNMATCHED_RE, (m, n: string) => (byMarker.has(Number(n)) ? m : ""));
}

interface QuoteGroup {
  citation: Citation | null;
  sentences: string[];
}

/** Extractive answers read "sentence [1] sentence [1] sentence [2]": each sentence belongs to the
 *  marker that follows it. Groups keep the order in which their source first appears. */
function groupQuotes(text: string, byMarker: Map<number, Citation>): QuoteGroup[] {
  const groups = new Map<number, QuoteGroup>();
  const order: QuoteGroup[] = [];
  let pending = "";
  let last = 0;
  for (const m of text.matchAll(MARKER_RE)) {
    pending += text.slice(last, m.index);
    last = m.index + m[0].length;
    const citation = byMarker.get(Number(m[1]));
    if (!citation) continue; // unmatched: drop the marker, its text joins the next source
    const sentence = pending.trim();
    pending = "";
    if (!sentence) continue;
    let group = groups.get(citation.marker);
    if (!group) {
      group = { citation, sentences: [] };
      groups.set(citation.marker, group);
      order.push(group);
    }
    group.sentences.push(sentence);
  }
  const tail = (pending + text.slice(last)).trim();
  if (tail) order.push({ citation: null, sentences: [tail] });
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

function sourceLine(c: Citation): string {
  return `[${c.marker}] ${c.filename}${c.page !== null ? `, p. ${c.page}` : ""}`;
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

function QuoteBlocks({
  groups,
  activeMarker,
  onCite,
}: {
  groups: QuoteGroup[];
  activeMarker: number | null;
  onCite: (citation: Citation, viaKeyboard: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) => {
        const c = g.citation;
        const active = c !== null && c.marker === activeMarker;
        return (
          <figure key={c ? `m${c.marker}` : `t${i}`}>
            <blockquote
              className={cx(
                bodyText,
                "whitespace-pre-line wrap-anywhere rounded-r-md border-l-[3px] border-accent px-4 py-3",
                "transition-colors duration-150",
                active && "bg-cite-hl",
              )}
            >
              {g.sentences.join(" ")}
            </blockquote>
            {c && (
              <figcaption className="mt-1 pl-4">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  title={c.filename}
                  onClick={(e) => onCite(c, viaKeyboard(e))}
                  className={cx(
                    "rounded text-left text-[13px] leading-5 text-accent underline-offset-2 hover:underline",
                    "pointer-coarse:min-h-11",
                    active && "font-semibold underline",
                  )}
                >
                  <span className="sr-only">{`Source ${c.marker}: `}</span>
                  {middleTruncate(c.filename, 48)}
                  {c.page !== null && ` · page ${c.page}`}
                </button>
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}

function TextWithChips({
  text,
  byMarker,
  activeMarker,
  onCite,
}: {
  text: string;
  byMarker: Map<number, Citation>;
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
      <CitationChip key={`c${m.index}`} citation={citation} active={citation.marker === activeMarker} onActivate={onCite} />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className={cx(bodyText, "whitespace-pre-wrap wrap-anywhere")}>{parts}</p>;
}

/** One answer (§5.6): provenance badges, quote blocks (extractive) or text with chips, sources
 *  row, action row, meta line. */
export function AnswerBlock({
  answer,
  activeMarker,
  isLatest,
  scopeLabel,
  onCite,
  onOpenSources,
  mode,
}: {
  answer: AnswerView;
  activeMarker: number | null;
  isLatest: boolean;
  scopeLabel?: string;
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
  const text = stripUnmatched(answer.text, byMarker);
  const badge = modeBadge(answer.model, mode);
  const extractive = badge?.extractive ?? false;
  const fresh = answer.retrieved_count !== null;

  const docs = [...new Map(citations.map((c) => [c.document_id, c])).values()];
  const meta = answer.model
    ? [answer.model.provider, answer.model.name, answer.latency_ms !== null ? `${answer.latency_ms} ms` : null]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  async function copy() {
    const payload = citations.length ? `${text}\n\nSources: ${citations.map(sourceLine).join("; ")}` : text;
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
        {answer.evidence_status === "supported" && (
          <Badge tone="ok" icon={<Icon name="check" width={14} height={14} />}>
            Found in your documents
          </Badge>
        )}
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
        <QuoteBlocks groups={groupQuotes(text, byMarker)} activeMarker={activeMarker} onCite={onCite} />
      ) : (
        <TextWithChips text={text} byMarker={byMarker} activeMarker={activeMarker} onCite={onCite} />
      )}

      {citations.length > 0 && (
        <button
          type="button"
          onClick={onOpenSources}
          className={cx(
            "inline-flex min-h-8 items-center gap-2 self-start rounded-md text-[13px] text-muted",
            "transition-colors duration-150 hover:text-text pointer-coarse:min-h-11",
          )}
        >
          <span aria-hidden="true" className="flex items-center">
            {docs.slice(0, 3).map((d, i) => (
              <span
                key={d.document_id}
                className={cx(
                  "grid size-5 place-items-center rounded-md border border-border bg-panel text-muted",
                  i > 0 && "-ml-1.5",
                )}
              >
                <Icon name="file" width={12} height={12} />
              </span>
            ))}
          </span>
          <span>
            {plural(citations.length, "passage", "passages")} from {plural(docs.length, "document", "documents")}
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

      {scopeLabel && <p className="text-xs text-muted">{scopeLabel}</p>}
    </div>
  );
}
