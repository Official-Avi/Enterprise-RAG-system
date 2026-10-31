"use client";

import { Icon } from "@/components/icons";
import type { NotFoundContext } from "./types";

const actionClass =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-panel px-3 " +
  "text-sm font-medium text-text transition-colors duration-150 hover:bg-bg active:scale-[.98] " +
  "max-sm:min-h-11";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function SearchXIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-muted"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-5-5M13.5 8.5l-5 5M8.5 8.5l5 5" />
    </svg>
  );
}

/** Calm "Not found in your documents" card with recovery actions (§5.6). Neutral on purpose:
 *  an honest "not found" is a valid result, not an error, so no red and no citation chips. */
export function NotFoundCard({
  retrievedCount,
  context,
  onRephrase,
}: {
  retrievedCount: number | null;
  context: NotFoundContext;
  onRephrase: () => void;
}) {
  const { documentCount, readingCount, narrowed, canUpload, onSearchAll, onUpload } = context;
  const related = (retrievedCount ?? 0) > 0;

  const title = related ? "Your documents don't answer this" : "Not found in your documents";
  const body = related
    ? "I found related passages, but none answer the question directly."
    : documentCount > 0
      ? `I searched ${plural(documentCount, "document", "documents")} and found nothing about this.`
      : "I searched your documents and found nothing about this.";

  return (
    <div className="rounded-xl border border-border bg-panel-2 p-4">
      <div className="flex gap-3">
        <SearchXIcon />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-text">{title}</p>
          <p className="mt-1 text-sm text-muted">{body}</p>
          {readingCount > 0 && (
            <p className="mt-1 text-sm text-muted">
              {readingCount === 1
                ? "1 file is still being read. Try again in a minute."
                : `${readingCount} files are still being read. Try again in a minute.`}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={actionClass} onClick={onRephrase}>
              Rephrase
            </button>
            {narrowed && (
              <button type="button" className={actionClass} onClick={onSearchAll}>
                Search all documents
              </button>
            )}
            {canUpload && (
              <button type="button" className={actionClass} onClick={onUpload}>
                <Icon name="upload" />
                Upload a document
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
