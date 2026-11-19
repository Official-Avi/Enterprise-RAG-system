"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";
import { cx } from "@/components/ui";
import { middleTruncate, phaseFromDocument } from "@/lib/status";
import type { DocumentItem } from "@/lib/types";
import { MAX_FILE_BYTES, MAX_FILES } from "@/lib/workspace";
import type { AskStateKey } from "./types";

/** Opens the demo strip's Switch persona menu (§4.4), the one place that switches without a reload,
 *  and puts focus on a persona's row when one is named. */
export function openPersonaMenu(focusTitle?: string) {
  const strip = document.querySelector('[role="region"][aria-label="Demo account"]');
  const button = strip?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
  if (!button) return;
  if (button.getAttribute("aria-expanded") !== "true") button.click();
  if (!focusTitle) return;
  requestAnimationFrame(() => {
    strip?.querySelector<HTMLButtonElement>(`[role="menuitemradio"][data-title="${focusTitle}"]`)?.focus();
  });
}

/** Loading, auditor (E), not_found (F), operator_empty (D), upload_empty (A), reading (C), ready (B).
 *  §5.9 lists F last; it goes first so a missing chat never renders as state A or D. */
export function useAskState(input: {
  loading: boolean;
  canChat: boolean;
  canUpload: boolean;
  readyCount: number;
  pendingCount: number;
  notFound: boolean;
}): AskStateKey {
  const { loading, canChat, canUpload, readyCount, pendingCount, notFound } = input;
  if (loading) return "loading";
  if (!canChat) return "auditor";
  if (notFound) return "not_found";
  if (!canUpload && readyCount === 0) return "operator_empty";
  if (readyCount === 0 && pendingCount === 0) return "upload_empty";
  if (readyCount === 0) return "reading";
  return "ready";
}

/** Renders states A–F. For "ready" and "reading" it renders the heading block that sits above
 *  the centred composer; the page renders the composer itself. */
export function AskEmptyState({
  state,
  readyCount,
  readingDocs,
  onUpload,
  consoleHref,
  isDemo,
}: {
  state: AskStateKey;
  readyCount: number;
  readingDocs: DocumentItem[];
  onUpload: () => void;
  consoleHref: string | null;
  isDemo: boolean;
}) {
  switch (state) {
    case "loading":
      return <AskSkeleton />;
    case "auditor":
      return (
        <BlockedState
          icon={<Icon name="lock" width={20} height={20} />}
          title="Auditors can't ask questions"
          description="Your role can see activity, file names and statuses, but not what's inside documents. This keeps reviews independent."
          fullPage
        >
          {consoleHref && (
            <ActionLink href={consoleHref} primary>
              Open admin console
            </ActionLink>
          )}
          {isDemo && (
            <button
              type="button"
              onClick={() => openPersonaMenu()}
              className="key min-h-11 sm:min-h-10"
            >
              Switch persona
            </button>
          )}
        </BlockedState>
      );
    case "operator_empty":
      return (
        <BlockedState
          icon={<Icon name="documents" width={20} height={20} />}
          title="Nothing to ask about yet"
          description="Documents added by Engineers or Admins appear here once they're ready."
        >
          {/* /jobs is a console page; only offer it to roles that can open the console. */}
          {consoleHref && (
            <ActionLink href="/jobs" primary>
              Open job queue
            </ActionLink>
          )}
        </BlockedState>
      );
    case "not_found":
      return (
        <BlockedState
          icon={<Icon name="chat" width={20} height={20} />}
          title="This chat isn't available."
          description="It may have been deleted, or it belongs to another account."
        >
          <ActionLink href="/ask" primary>
            Start a new chat
          </ActionLink>
        </BlockedState>
      );
    case "upload_empty":
      return <UploadEmpty onUpload={onUpload} />;
    case "reading":
      return <ReadingState docs={readingDocs} />;
    case "ready":
      return (
        <Heading
          title="What would you like to know?"
          description={`I'll answer from your ${readyCount} ${readyCount === 1 ? "document" : "documents"} and show the exact passage.`}
        />
      );
  }
}

/** Left-aligned with the composer below it: the page reads like a document, not a centred splash. */
function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-1">
      <h1 className="text-2xl leading-tight">{title}</h1>
      <p className="mt-2 max-w-[60ch] text-base text-text-2 text-pretty">{description}</p>
    </div>
  );
}

/** Nothing renders for the first 300ms so a fast load never flashes a skeleton (or state A). */
function AskSkeleton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(t);
  }, []);
  if (!visible) return <div aria-hidden="true" className="h-[68px]" />;
  return (
    <div role="status" className="flex flex-col items-start gap-3 px-1">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="h-8 w-full max-w-[420px] rounded-sm bg-panel-3 motion-safe:animate-shimmer" />
      <div aria-hidden="true" className="h-5 w-full max-w-[320px] rounded-sm bg-panel-3 motion-safe:animate-shimmer" />
    </div>
  );
}

function BlockedState({
  icon,
  title,
  description,
  fullPage,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  fullPage?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        // Left-aligned in the region (design.md empty states): a 20px muted icon, no tinted tile.
        "mx-auto flex w-full max-w-[560px] flex-col items-start justify-center px-4 py-12",
        fullPage && "min-h-[60dvh] flex-1",
      )}
    >
      <span className="text-muted">{icon}</span>
      <h1 className="mt-3 text-2xl leading-tight">{title}</h1>
      <p className="mt-2 max-w-[60ch] text-base text-text-2 text-pretty">{description}</p>
      {children && <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

function ActionLink({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={cx("key min-h-11 sm:min-h-10", primary && "key-primary")}>
      {children}
    </Link>
  );
}

const MAX_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));
const STEPS = ["Add", "We read it (under a minute)", "Ask and see the source"];

/** State A. The zone is a <label> around a real button, so a click anywhere in it opens the
 *  native picker; drops are handled by the workspace-wide overlay (§5.5). */
function UploadEmpty({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex w-full flex-col">
      <Heading
        title="Add a document to get started"
        description="Drop in a PDF, Word, text or Markdown file. Scanned PDFs work too."
      />
      <label
        className={cx(
          // Dashed dropzone edge at 3:1 (dropzone-border); hover and focus turn it solid accent.
          "group relative mt-6 flex min-h-[200px] w-full cursor-pointer flex-col items-start justify-center gap-3",
          "rounded-card border-[1.5px] border-dashed border-dropzone-border bg-accent-soft/40 px-6 py-6",
          "transition-colors duration-(--dur-micro)",
          "hover:border-solid hover:border-accent hover:bg-accent-soft",
          "focus-within:border-solid focus-within:border-accent focus-within:bg-accent-soft",
          "max-sm:items-stretch max-sm:px-4",
        )}
      >
        <span className="flex items-center gap-3">
          <Icon name="upload" width={20} height={20} className="shrink-0 text-accent" />
          <span className="font-display text-lg font-medium pointer-coarse:hidden">Drag a file here, or</span>
          <span className="hidden font-display text-lg font-medium pointer-coarse:inline">Tap to choose a file</span>
        </span>
        <button
          type="button"
          // The wrapping <label> would otherwise become the button's accessible name.
          aria-label="Choose a file"
          onClick={onUpload}
          // The one action that fills this state, so it is the primary key.
          className="key key-primary min-h-11 pointer-coarse:min-h-12 pointer-coarse:w-full pointer-coarse:max-w-[360px]"
        >
          <Icon name="paperclip" />
          Choose a file
        </button>
        <span className="text-sm text-muted">
          Up to {MAX_MB} MB each, {MAX_FILES} at a time
        </span>
      </label>
      {/* Three steps as a ruled row: numbers in the display face, no dots, no tinted circles. */}
      <ol className="mt-4 grid grid-cols-1 border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-border">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className="flex items-baseline gap-2 py-2.5 text-sm text-text-2 max-sm:border-b max-sm:border-border sm:px-3 sm:first:pl-1"
          >
            <span aria-hidden="true" className="font-display font-semibold tabular-nums text-muted">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

const MAX_READING_ROWS = 5;

/** Re-render on an interval so "Taking longer than usual" appears without a new poll result. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** State C. Hold-and-send lives in the composer; this is only the heading and the file rows. */
function ReadingState({ docs }: { docs: DocumentItem[] }) {
  const now = useNow(10_000);
  const shown = docs.slice(0, MAX_READING_ROWS);
  const more = docs.length - shown.length;
  return (
    <div className="w-full">
      <Heading
        title="Reading your documents…"
        description="This usually takes 5 to 60 seconds. You can type your question now."
      />
      {shown.length > 0 && (
        <ul aria-label="Documents being read" className="mt-6 flex flex-col border-t border-border">
          {shown.map((doc) => {
            const since = Date.parse(doc.updated_at);
            return (
              <li
                key={doc.id}
                className="flex min-h-12 items-center gap-3 border-b border-border px-1 py-2.5"
              >
                <Icon name="file" width={20} height={20} className="shrink-0 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium" title={doc.filename}>
                    {middleTruncate(doc.filename, 48)}
                  </span>
                  <StatusPill
                    phase={phaseFromDocument(doc.status, doc.latest_job?.status)}
                    ctx={{
                      pageCount: doc.page_count,
                      stage: doc.latest_job?.stage,
                      elapsedMs: Number.isNaN(since) ? 0 : Math.max(0, now - since),
                    }}
                    variant="inline"
                    showSub
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && <p className="mt-2 px-1 text-xs text-muted tabular-nums">+{more} more being read</p>}
    </div>
  );
}
