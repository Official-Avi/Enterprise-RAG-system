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

/** §5.9 order: loading, auditor (E), operator_empty (D), upload_empty (A), reading (C), ready (B). */
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
          icon={<Icon name="lock" width={24} height={24} />}
          title="Auditors can't ask questions"
          description="Your role can see activity, file names and statuses, but not what's inside documents. This keeps reviews independent."
          fullPage
        >
          {consoleHref && (
            <ActionLink href={consoleHref} primary>
              Open admin console
            </ActionLink>
          )}
          {isDemo && <ActionLink href="/#demo">Switch persona</ActionLink>}
        </BlockedState>
      );
    case "operator_empty":
      return (
        <BlockedState
          icon={<Icon name="documents" width={24} height={24} />}
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
          icon={<Icon name="chat" width={24} height={24} />}
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

function Heading({ title, description }: { title: string; description: string }) {
  return (
    <div className="text-center">
      <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mx-auto mt-2 max-w-[560px] text-base text-muted text-pretty">{description}</p>
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
    <div role="status" className="flex flex-col items-center gap-3">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="h-9 w-full max-w-[420px] rounded-lg bg-panel-2 motion-safe:animate-pulse" />
      <div aria-hidden="true" className="h-5 w-full max-w-[320px] rounded-md bg-panel-2 motion-safe:animate-pulse" />
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
        "mx-auto flex w-full max-w-[520px] flex-col items-center justify-center px-4 py-12 text-center",
        fullPage && "min-h-[60dvh] flex-1",
      )}
    >
      <span className="grid size-12 place-items-center rounded-full bg-panel-2 text-muted">{icon}</span>
      <h1 className="mt-4 text-[28px] leading-9 font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mt-2 text-base text-muted text-pretty">{description}</p>
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}

function ActionLink({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium",
        "transition-colors duration-150 sm:min-h-10",
        primary
          ? "border-transparent bg-accent text-accent-contrast hover:opacity-90"
          : "border-border-strong bg-panel text-text hover:bg-panel-2",
      )}
    >
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
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center">
      <Heading
        title="Add a document to get started"
        description="Drop in a PDF, Word, text or Markdown file. Scanned PDFs work too."
      />
      <label
        className={cx(
          "group relative mt-6 flex h-[220px] w-full cursor-pointer flex-col items-center justify-center gap-2",
          "rounded-xl bg-accent-soft/50 px-4 text-center transition-colors duration-150",
          "hover:bg-accent-soft focus-within:bg-accent-soft",
        )}
      >
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
          {/* Stroke is centred on the edge and the outer half is clipped: 1.5px visible. */}
          <rect
            width="100%"
            height="100%"
            rx="12"
            ry="12"
            fill="none"
            strokeWidth="3"
            className={cx(
              "stroke-dropzone-border [stroke-dasharray:4_4] transition-colors duration-150",
              "group-hover:stroke-accent group-hover:[stroke-dasharray:none]",
              "group-focus-within:stroke-accent group-focus-within:[stroke-dasharray:none]",
            )}
          />
        </svg>
        <span className="grid size-10 place-items-center rounded-full bg-panel text-accent">
          <Icon name="upload" width={20} height={20} />
        </span>
        <span className="text-base font-semibold pointer-coarse:hidden">Drag a file here</span>
        <span className="text-sm text-muted pointer-coarse:hidden">or</span>
        <span className="hidden text-base font-semibold pointer-coarse:inline">Tap to choose a file</span>
        <button
          type="button"
          // The wrapping <label> would otherwise become the button's accessible name.
          aria-label="Choose a file"
          onClick={onUpload}
          className={cx(
            "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-panel px-4",
            "text-sm font-medium text-text transition-colors duration-150",
            "group-hover:border-transparent group-hover:bg-accent group-hover:text-accent-contrast",
            "pointer-coarse:h-12 pointer-coarse:w-full pointer-coarse:max-w-[360px]",
          )}
        >
          <Icon name="paperclip" />
          Choose a file
        </button>
        <span className="text-[13px] leading-5 text-muted">
          Up to {MAX_MB} MB each · {MAX_FILES} at a time
        </span>
      </label>
      <ol className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] leading-5 text-muted">
        {STEPS.map((step, i) => (
          <li key={step} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">·</span>}
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="grid size-5 place-items-center rounded-full bg-accent-soft text-xs font-semibold tabular-nums text-accent"
              >
                {i + 1}
              </span>
              {step}
            </span>
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
    <div className="mx-auto w-full max-w-[640px]">
      <Heading
        title="Reading your documents…"
        description="This usually takes 5 to 60 seconds. You can type your question now."
      />
      {shown.length > 0 && (
        <ul aria-label="Documents being read" className="mt-6 flex flex-col gap-2">
          {shown.map((doc) => {
            const since = Date.parse(doc.updated_at);
            return (
              <li
                key={doc.id}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-panel px-3 py-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-muted">
                  <Icon name="file" />
                </span>
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
      {more > 0 && <p className="mt-2 text-center text-[13px] text-muted">+{more} more being read</p>}
    </div>
  );
}
