"use client";

import Link from "next/link";
import { useId } from "react";
import { openPersonaMenu } from "@/components/DemoStrip";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { MAX_FILE_BYTES, MAX_FILES } from "@/lib/workspace";
import { AlertIcon, EmptyBlock, primaryButtonClass, secondaryButtonClass } from "./parts";

const MAX_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));
const STEPS = ["Add", "We read it (under a minute)", "Ask and see the source"];

/** §5.9-A dropzone for upload roles with no documents yet. The zone is a <label> around a real
 *  button, so a click anywhere opens the native picker (§9 #12); drops are handled by the
 *  workspace-wide overlay (§5.5). The page already has its h1, so this heading is an h2. */
export function UploadDropzone({ onPick }: { onPick: () => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-6 w-full max-w-[720px] border-t border-border pt-6">
      <h2 id={headingId} className="text-xl text-pretty">
        Add a document to get started
      </h2>
      <p className="mt-2 max-w-[60ch] text-base text-text-2 text-pretty">
        Drop in a PDF, Word, text or Markdown file. Scanned PDFs work too.
      </p>
      <label
        className={cx(
          "group mt-6 flex min-h-[220px] w-full cursor-pointer flex-col items-start justify-center gap-3",
          "rounded-card border-2 border-dashed border-dropzone-border bg-accent-soft/40 p-6",
          "transition-colors duration-[var(--dur-micro)]",
          "hover:border-solid hover:border-accent hover:bg-accent-soft",
          "focus-within:border-solid focus-within:border-accent focus-within:bg-accent-soft",
        )}
      >
        <Icon name="upload" width={20} height={20} className="text-accent" />
        <span className="font-display text-lg font-medium pointer-coarse:hidden">Drag a file here, or</span>
        <span className="hidden font-display text-lg font-medium pointer-coarse:inline">Tap to choose a file</span>
        <button
          type="button"
          // The wrapping <label> would otherwise become the button's accessible name.
          aria-label="Choose a file"
          onClick={onPick}
          className="key pointer-coarse:min-h-12 pointer-coarse:w-full pointer-coarse:max-w-[360px]"
        >
          <Icon name="paperclip" />
          Choose a file
        </button>
        <span className="text-sm text-muted">
          Up to {MAX_MB} MB per file, {MAX_FILES} files at a time.
        </span>
      </label>
      <ol className="mt-6 grid gap-x-6 gap-y-3 text-sm text-text-2 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-baseline gap-2 border-t border-border pt-3">
            <span aria-hidden="true" className="font-display text-base font-semibold text-muted tabular-nums">
              {i + 1}
            </span>
            {step}
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
    <div className="mx-auto w-full max-w-[var(--container)] px-4 pt-6 pb-10 md:px-6 md:pt-10">
      <EmptyBlock
        as="h1"
        icon={<Icon name="lock" width={20} height={20} />}
        title="Auditors see file details in the admin console"
        description="Your role can see activity, file names and statuses, but not what's inside documents. This keeps reviews independent."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/documents" className={primaryButtonClass}>
              Open Documents
            </Link>
            {isDemo && (
              <Link
                href="/#demo"
                // In place when the strip is showing (§4.4); the link is the fallback when it isn't.
                onClick={(e) => {
                  if (openPersonaMenu()) e.preventDefault();
                }}
                className={secondaryButtonClass}
              >
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

/** The first load failed: a block in place of the list, never a toast. A temporary problem reads
 *  as a warning, a lasting one as an error (design.md, Errors). */
export function LoadError({ error, onRetry }: { error: ApiError | undefined; onRetry: () => void }) {
  const copy = loadErrorCopy(error);
  return (
    <div
      role="alert"
      className={cx("mt-6 max-w-[72ch] rounded-card p-4 text-sm", copy.temporary ? "bg-warn-soft" : "bg-bad-soft")}
    >
      <p className={cx("flex items-center gap-2 font-medium", copy.temporary ? "text-warn" : "text-bad")}>
        <AlertIcon className="shrink-0" />
        {copy.title}
      </p>
      <p className="mt-1 pl-6 text-text">{copy.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 pl-6">
        <button type="button" onClick={onRetry} className={secondaryButtonClass}>
          <Icon name="refresh" />
          Try again
        </button>
        {error?.correlationId && (
          <span className="text-xs text-muted [overflow-wrap:anywhere]">
            Ref <span className="font-mono">{error.correlationId}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** A later poll failed: the list stays, with a quiet line above it. */
export function RefreshProblem({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const retrying = error.status === 0 || error.status === 429 || error.status >= 500;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 text-sm text-warn">
      <span className="inline-flex items-center gap-1.5">
        <AlertIcon className="shrink-0" />
        Couldn&apos;t refresh the list.{retrying ? " Trying again…" : ""}
      </span>
      {!retrying && (
        <button
          type="button"
          onClick={onRetry}
          className={cx(
            "inline-flex min-h-6 cursor-pointer items-center rounded-sm font-medium text-text underline underline-offset-2",
            "transition-colors duration-[var(--dur-micro)] hover:text-accent pointer-coarse:min-h-11",
          )}
        >
          Try again
        </button>
      )}
    </p>
  );
}
