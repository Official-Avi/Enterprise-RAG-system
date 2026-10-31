"use client";

import Link from "next/link";
import { useId } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { MAX_FILE_BYTES, MAX_FILES } from "@/lib/workspace";
import { EmptyBlock, primaryButtonClass, secondaryButtonClass } from "./parts";

const MAX_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));
const STEPS = ["Add", "We read it (under a minute)", "Ask and see the source"];

/** §5.9-A dropzone for upload roles with no documents yet. The zone is a <label> around a real
 *  button, so a click anywhere opens the native picker (§9 #12); drops are handled by the
 *  workspace-wide overlay (§5.5). The page already has its h1, so this heading is an h2. */
export function UploadDropzone({ onPick }: { onPick: () => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mx-auto mt-8 flex w-full max-w-[640px] flex-col items-center">
      <h2 id={headingId} className="text-center text-[28px]/9 font-semibold tracking-tight text-balance">
        Add a document to get started
      </h2>
      <p className="mx-auto mt-2 max-w-[560px] text-center text-base text-muted text-pretty">
        Drop in a PDF, Word, text or Markdown file. Scanned PDFs work too.
      </p>
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
          onClick={onPick}
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
    </section>
  );
}

/** §6 auditor pattern (§5.9-E copy variant): the whole page, with the console's Documents
 *  page as the way forward. */
export function AuditorState({ isDemo }: { isDemo: boolean }) {
  return (
    <div className="flex min-h-[60dvh] flex-1 items-center justify-center">
      <EmptyBlock
        as="h1"
        icon={<Icon name="lock" width={24} height={24} />}
        title="Auditors see file details in the admin console"
        description="Your role can see activity, file names and statuses, but not what's inside documents. This keeps reviews independent."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/documents" className={primaryButtonClass}>
              Open Documents
            </Link>
            {isDemo && (
              <Link href="/#demo" className={secondaryButtonClass}>
                Switch persona
              </Link>
            )}
          </div>
        }
      />
    </div>
  );
}

/** Plain-words copy for a failed list request (§5.6 error copy). */
function loadErrorCopy(error: ApiError | undefined): { title: string; body: string; temporary: boolean } {
  const status = error?.status ?? 0;
  if (status === 0) {
    return {
      title: "Can't reach RackFlow.",
      body: "Check that the server is running, then try again.",
      temporary: true,
    };
  }
  if (status === 429) {
    return { title: "Too many requests right now.", body: "Wait a few seconds, then try again.", temporary: true };
  }
  if (status >= 500) {
    return { title: "Couldn't load your documents.", body: "Something went wrong on our side.", temporary: true };
  }
  if (status === 403) {
    return { title: "Your role can't see this list.", body: "An Admin can change what your role can open.", temporary: false };
  }
  return { title: "Couldn't load your documents.", body: "Something went wrong on our side.", temporary: false };
}

/** The first load failed: a card in place of the list, never a toast. */
export function LoadError({ error, onRetry }: { error: ApiError | undefined; onRetry: () => void }) {
  const copy = loadErrorCopy(error);
  return (
    <div
      role="alert"
      className={cx(
        "mx-auto mt-6 max-w-lg rounded-xl border border-border p-4 text-sm",
        copy.temporary ? "bg-warn-soft" : "bg-bad-soft",
      )}
    >
      <p className="font-semibold text-text">{copy.title}</p>
      <p className="mt-1 text-text">{copy.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRetry} className={secondaryButtonClass}>
          <Icon name="refresh" />
          Try again
        </button>
        {error?.correlationId && (
          <span className="font-mono text-xs text-muted [overflow-wrap:anywhere]">Ref {error.correlationId}</span>
        )}
      </div>
    </div>
  );
}

/** A later poll failed: the list stays, with a quiet line above it. */
export function RefreshProblem({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const retrying = error.status === 0 || error.status >= 500;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-warn">
      <span>
        <span aria-hidden="true">⚠ </span>
        Couldn&apos;t refresh the list.{retrying ? " Trying again…" : ""}
      </span>
      {!retrying && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-6 items-center font-medium underline underline-offset-2 hover:text-text pointer-coarse:min-h-11"
        >
          Try again
        </button>
      )}
    </p>
  );
}
