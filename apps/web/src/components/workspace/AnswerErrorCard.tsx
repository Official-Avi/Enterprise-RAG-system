"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { announce } from "@/lib/announce";

type Kind = "session" | "rate" | "network" | "timeout" | "model" | "search" | "other";

const COPY: Record<Kind, { title: string; body?: string }> = {
  session: { title: "Your session ended." },
  rate: {
    title: "You're asking faster than RackFlow can answer.",
    body: "Shared demo accounts share this limit.",
  },
  network: { title: "Can't reach RackFlow.", body: "Check that the server is running, then try again." },
  timeout: { title: "The answer took too long." },
  model: { title: "The AI model isn't available right now." },
  search: { title: "Search is busy or offline.", body: "Try again in a few seconds." },
  other: { title: "Something went wrong on our side." },
};

const FALLBACK_RETRY_SECONDS = 15;

function kindOf(error: ApiError): Kind {
  if (error.status === 401) return "session";
  if (error.status === 429 || error.code === "RATE_LIMITED") return "rate";
  // 502 means a proxy in front of the API could not reach it: same story as no network.
  if (error.status === 0 || error.code === "NETWORK_ERROR" || error.status === 502) return "network";
  if (error.code === "MODEL_TIMEOUT" || error.status === 504) return "timeout";
  if (error.code === "MODEL_OVERLOADED" || error.code === "MODEL_UNAVAILABLE") return "model";
  if (error.status === 503) return "search";
  return "other";
}

/** Seconds from a `retryAfter` field (Retry-After, BE SHOULD) when the client provides it. */
function retrySeconds(error: ApiError): number {
  const value = (error as ApiError & { retryAfter?: unknown }).retryAfter;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : FALLBACK_RETRY_SECONDS;
}

// Keys draw their own hover, press and aria-disabled states (globals.css).
const actionClass = "key pointer-coarse:min-h-11";

function AlertGlyph({ tone }: { tone: "warn" | "bad" }) {
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
      className={cx("mt-0.5 shrink-0", tone === "warn" ? "text-warn" : "text-bad")}
    >
      {tone === "warn" ? (
        <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01" />
      ) : (
        <path d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM9 9l6 6M15 9l-6 6" />
      )}
    </svg>
  );
}

/** Counts down from the limit window, then enables. Its accessible name stays "Try again" and the
 *  ticking text is aria-hidden, so the surrounding role="alert" isn't re-read every second. */
function RateLimitedRetry({ error, busy, onRetry }: { error: ApiError; busy: boolean; onRetry: () => void }) {
  const seconds = retrySeconds(error);
  const [remaining, setRemaining] = useState(seconds);
  const [trackedError, setTrackedError] = useState(error);
  if (trackedError !== error) {
    setTrackedError(error);
    setRemaining(seconds);
  }

  useEffect(() => {
    // A deadline (not a decrement per tick) stays right when a background tab throttles timers.
    const end = Date.now() + seconds * 1000;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [error, seconds]);

  const waiting = remaining > 0;
  const blocked = waiting || busy;
  return (
    <button
      type="button"
      aria-disabled={blocked || undefined}
      onClick={() => {
        if (!blocked) onRetry();
      }}
      className={cx(
        actionClass,
        "tabular-nums",
        blocked && "cursor-not-allowed",
      )}
    >
      <Icon name="refresh" />
      <span className="sr-only">Try again</span>
      <span aria-hidden="true">{waiting ? `Try again in ${remaining}s` : "Try again"}</span>
    </button>
  );
}

function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
    </svg>
  );
}

function CopyRef({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy(button: HTMLButtonElement) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(id);
      ok = true;
    } catch {
      // Plain http on a LAN address has no Clipboard API; fall back to a selection copy.
      const ta = document.createElement("textarea");
      ta.value = id;
      ta.setAttribute("readonly", "");
      ta.className = "fixed -left-[9999px] top-0 opacity-0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
      button.focus();
    }
    if (ok) {
      setCopied(true);
      announce("Reference copied");
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      {/* The label is words, so it is set in the body face; only the id itself is a machine value. */}
      <span className="break-all">
        Ref <span className="font-mono">{id}</span>
      </span>
      <button
        type="button"
        onClick={(e) => void copy(e.currentTarget)}
        className={cx(
          "inline-flex min-h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-text-2",
          "transition-colors duration-[var(--dur-micro)] ease-out hover:bg-panel hover:text-text active:bg-panel-2",
          "pointer-coarse:min-h-11",
        )}
      >
        {copied ? <Icon name="check" width={14} height={14} /> : <CopyGlyph />}
        <span className="sr-only">Copy reference</span>
        <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

/** Inline error / rate-limit card under the kept question (§5.6). Never a toast. */
export function AnswerErrorCard({
  error,
  busy = false,
  onRetry,
}: {
  error: ApiError;
  /** Another question is on its way: only one goes out at a time, so Try again has to wait. */
  busy?: boolean;
  onRetry: () => void;
}) {
  const kind = kindOf(error);
  const tone = kind === "session" || kind === "other" ? "bad" : "warn";
  const { title, body } = COPY[kind];

  return (
    <div role="alert" className={cx("rounded-card p-4 sm:p-6", tone === "warn" ? "bg-warn-soft" : "bg-bad-soft")}>
      <div className="flex gap-3">
        <AlertGlyph tone={tone} />
        <div className="min-w-0 flex-1">
          <p className={cx("font-display text-base leading-6 font-semibold", tone === "warn" ? "text-warn" : "text-bad")}>
            {title}
          </p>
          {body && <p className="mt-1 max-w-[65ch] text-sm leading-6 text-text">{body}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {kind === "session" ? (
              <SignInAgain />
            ) : kind === "rate" ? (
              <RateLimitedRetry error={error} busy={busy} onRetry={onRetry} />
            ) : (
              <button
                type="button"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) onRetry();
                }}
                className={actionClass}
              >
                <Icon name="refresh" />
                Try again
              </button>
            )}
          </div>
          {error.correlationId && <CopyRef id={error.correlationId} />}
        </div>
      </div>
    </div>
  );
}

/** Full navigation on purpose (auth was lost, discard client state). The page has already saved
 *  the draft to sessionStorage "rf.draft". */
function SignInAgain() {
  const pathname = usePathname();
  return (
    <a
      href={`/login?next=${encodeURIComponent(pathname)}`}
      onClick={(e) => {
        // Re-read at click time so the query (e.g. the open chat) survives the round trip too.
        const next = window.location.pathname + window.location.search;
        e.currentTarget.href = `/login?next=${encodeURIComponent(next)}`;
      }}
      className={actionClass}
    >
      <Icon name="arrowRight" />
      Sign in again
    </a>
  );
}
