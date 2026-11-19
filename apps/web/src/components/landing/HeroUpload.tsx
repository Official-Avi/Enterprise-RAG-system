"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { NETWORK_ERROR_COPY } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/demo";
import { formatBytes } from "@/lib/format";
import { middleTruncate } from "@/lib/status";
import { useFileDrop } from "@/lib/useFileDrop";
import { ACCEPT_ATTR, MAX_FILE_BYTES, MAX_FILES } from "@/lib/workspace";
import { fileKind, KIND_LABEL } from "@/components/workspace/library/parts";
import { isBusy, SIGN_IN_HREF, useHeroUpload, useRunActive, type HeroJob, type HeroState } from "./useHeroUpload";
import { useVisitor } from "./Visitor";

const MAX_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

// Keycaps from the design system (design.md, Controls): 44px on touch, 40px with a pointer.
// `.key` carries its own hover, active, disabled and busy states and its transitions.
const OUTLINE_ACTION = "key min-h-11 sm:min-h-10";
const PRIMARY_ACTION = "key key-primary min-h-11 sm:min-h-10";

/** The warning triangle for refusals and errors, so status never rests on colour alone. */
function AlertGlyph({ className }: { className?: string }) {
  return <Icon name="alert" width={20} height={20} aria-hidden="true" className={cx("shrink-0", className)} />;
}

function FileRow({ files }: { files: File[] }) {
  const total = files.reduce((n, f) => n + f.size, 0);
  const name = files.length === 1 ? files[0].name : `${files.length} files`;
  return (
    <div className="flex w-full min-w-0 items-start gap-3 text-left">
      <Icon name="file" width={20} height={20} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-medium text-text" title={name}>
          {middleTruncate(name, 44)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs leading-5 text-muted">
          <span>{files.length === 1 ? KIND_LABEL[fileKind(files[0].name)] : "Files"}</span>
          <span className="num font-mono">{formatBytes(total)}</span>
        </p>
      </div>
    </div>
  );
}

function Step({ done, meta, children }: { done: boolean; meta?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm text-text">
      <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center">
        {done ? (
          <Icon name="check" width={16} height={16} className="text-accent" />
        ) : (
          <span className="size-3.5 rounded-full border-2 border-accent border-t-transparent motion-safe:animate-spin" />
        )}
      </span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</span>
      {meta}
    </li>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  const percent = Math.round(fraction * 100);
  return (
    <div
      role="progressbar"
      aria-label="Upload progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 w-full overflow-hidden rounded-sm bg-panel-3"
    >
      {/* scaleX, not width: only transform and opacity animate. */}
      <div
        className="h-full origin-left bg-accent transition-transform duration-(--dur-short) ease-out"
        style={{ transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}

function Note({ tone, alert, children }: { tone: "bad" | "warn" | "plain"; alert?: boolean; children: ReactNode }) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cx(
        "flex w-full items-start gap-2 text-left text-sm [overflow-wrap:anywhere]",
        tone === "bad" && "rounded-md bg-bad-soft px-3 py-2 text-bad",
        tone === "warn" && "rounded-md bg-warn-soft px-3 py-2 text-warn",
        tone === "plain" && "text-text-2",
      )}
    >
      {tone !== "plain" && <AlertGlyph className="mt-0.5 size-4" />}
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-wrap items-center gap-2">{children}</div>;
}

/** Says what the server really holds after a stop, and how to take it back. */
function StoredPanel({
  state,
  hero,
  demoRunning,
}: {
  state: Extract<HeroState, { kind: "stored" }>;
  hero: ReturnType<typeof useHeroUpload>;
  demoRunning: boolean;
}) {
  const { stored, job } = state;
  const total = job.kind === "upload" ? job.files.length : stored.length;
  const one = stored.length === 1;
  const saved = one
    ? `${middleTruncate(stored[0].name, 44)} was`
    : `${stored.length === total ? stored.length : `${stored.length} of ${total}`} files were`;
  const lead = state.cause === "cancelled" ? "Upload stopped, but" : "The upload stopped partway, and";
  const audience = demoRunning ? "anyone using this demo can see" : "people with access can search";
  return (
    <>
      <Note tone="plain" alert>
        {lead} {saved} already saved to My documents. Until you remove {one ? "it" : "them"}, {audience}{" "}
        {one ? "it" : "them"}.
      </Note>
      {state.removeFailed && (
        <Note tone="bad" alert>
          {one ? "That file" : `${stored.length} files`} couldn&apos;t be removed. Try again, or delete{" "}
          {one ? "it" : "them"} in the{" "}
          <Link href="/library" className="font-medium underline underline-offset-2 hover:decoration-2 active:opacity-80">
            Library
          </Link>
          .
        </Note>
      )}
      <Actions>
        <button type="button" onClick={hero.removeStored} className={PRIMARY_ACTION}>
          {one ? "Remove saved file" : "Remove saved files"}
        </button>
        {stored.length < total && (
          <button type="button" onClick={hero.retry} className={OUTLINE_ACTION}>
            Upload the rest
          </button>
        )}
        <button type="button" onClick={hero.clear} className={OUTLINE_ACTION}>
          Keep and close
        </button>
      </Actions>
    </>
  );
}

interface PanelProps {
  state: Exclude<HeroState, { kind: "idle" | "rejected" | "server_rejected" }>;
  hero: ReturnType<typeof useHeroUpload>;
  demoRunning: boolean;
}

/** Everything the card says once it holds a job. Upload jobs show it in the dropzone, question jobs
 *  under the ask box, so it stays beside what the visitor just used. */
function JobPanel({ state, hero, demoRunning }: PanelProps) {
  const { job } = state;
  const isAsk = job.kind === "ask";
  const files = job.kind === "upload" ? job.files : [];
  const jobName = files.length === 1 ? files[0].name : `${files.length} files`;
  const cancel = (
    <button type="button" onClick={hero.cancel} className={OUTLINE_ACTION}>
      Cancel
    </button>
  );
  const remove = (
    <button type="button" onClick={hero.clear} className={OUTLINE_ACTION}>
      {isAsk ? "Dismiss" : "Remove"}
    </button>
  );
  const content = (): ReactNode => {
    switch (state.kind) {
      case "checking":
        return <Actions>{cancel}</Actions>;
      case "signing_in":
        return (
          <>
            <ul className="w-full space-y-2">
              <Step done={false}>Opening the Engineer demo account</Step>
            </ul>
            <Actions>{cancel}</Actions>
          </>
        );
      case "uploading": {
        const percent = Math.round(state.progress * 100);
        return (
          <>
            <ul className="w-full space-y-2">
              {state.demoStep && <Step done>Opening the Engineer demo account</Step>}
              <Step done={false} meta={<span className="num shrink-0 font-mono text-xs leading-5 text-muted">{percent}%</span>}>
                Uploading {jobName}
              </Step>
            </ul>
            <ProgressBar fraction={state.progress} />
            <Actions>
              {state.stopping ? (
                <button type="button" aria-disabled="true" aria-busy="true" className={OUTLINE_ACTION}>
                  Stopping…
                </button>
              ) : (
                cancel
              )}
            </Actions>
          </>
        );
      }
      case "opening":
        return (
          <ul className="w-full space-y-2">
            {state.demoStep && <Step done>Opening the Engineer demo account</Step>}
            {!isAsk && <Step done>Uploaded {jobName}</Step>}
            <Step done>Opening your chat…</Step>
          </ul>
        );
      case "kept":
        return (
          <>
            <Note tone="plain">
              {state.removed
                ? state.removed === 1
                  ? "Saved copy removed."
                  : "Saved copies removed."
                : "Upload cancelled."}{" "}
              {files.length > 1 ? "Your files are" : "Your file is"} still here.
            </Note>
            <Actions>
              <button type="button" onClick={hero.retry} className={PRIMARY_ACTION}>
                Upload
              </button>
              {remove}
            </Actions>
          </>
        );
      case "stored":
        return <StoredPanel state={state} hero={hero} demoRunning={demoRunning} />;
      case "removing":
        return (
          <ul className="w-full space-y-2">
            <Step done={false}>Removing the saved {state.stored.length === 1 ? "copy" : "copies"}</Step>
          </ul>
        );
      case "demo_off":
        return (
          <>
            {state.sessionEnded && (
              <Note tone="plain" alert>
                Your session has ended, so nothing was sent.
              </Note>
            )}
            {state.personaMissing && (
              <Note tone="plain" alert>
                The Engineer demo account isn&apos;t set up on this server.
              </Note>
            )}
            {isAsk ? (
              <Note tone="plain">Your question stays in this tab until you sign in.</Note>
            ) : (
              <div className="w-full text-left">
                <p className="font-display text-base font-medium text-text [overflow-wrap:anywhere]">
                  Sign in to ask about {jobName}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {files.length > 1 ? "Your files stay" : "Your file stays"} in this tab until you sign in.
                </p>
              </div>
            )}
            <Actions>
              <Link href={SIGN_IN_HREF} onClick={hero.keepForSignIn} className={PRIMARY_ACTION}>
                Sign in
              </Link>
              {remove}
            </Actions>
          </>
        );
      case "role_cannot_upload": {
        const label = ROLE_LABEL[state.role];
        const verb = isAsk ? "ask questions" : "upload documents";
        return (
          <>
            <Note tone="plain" alert>
              {label ? `You're signed in as ${label}, and ${label}s can't ${verb}.` : `This account can't ${verb}.`}
            </Note>
            <Actions>
              {state.demoOn ? (
                <>
                  <button type="button" onClick={hero.switchToEngineer} className={PRIMARY_ACTION}>
                    {isAsk ? "Switch to Engineer and ask" : "Switch to Engineer and upload"}
                  </button>
                  <button type="button" onClick={hero.clear} className={OUTLINE_ACTION}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <Link href={SIGN_IN_HREF} onClick={hero.keepForSignIn} className={PRIMARY_ACTION}>
                    Sign in with another account
                  </Link>
                  {remove}
                </>
              )}
            </Actions>
          </>
        );
      }
      case "rate_limited":
        return (
          <>
            {/* Not a live region: a ticking countdown would be read out every second. It is announced once. */}
            <Note tone="warn">
              {demoRunning ? "Lots of people are using the demo right now." : "RackFlow is busy right now."} Trying again
              in <span className="num">{state.seconds}</span>s…
            </Note>
            <Actions>{cancel}</Actions>
          </>
        );
      case "api_down":
        return (
          <>
            <Note tone="bad" alert>
              {NETWORK_ERROR_COPY}
            </Note>
            <Actions>
              <button type="button" onClick={hero.retry} className={PRIMARY_ACTION}>
                Try again
              </button>
              {remove}
            </Actions>
          </>
        );
      case "upload_failed":
        return (
          <>
            <Note tone="bad" alert>
              {state.message}
            </Note>
            <Actions>
              <button type="button" onClick={hero.retry} className={PRIMARY_ACTION}>
                Try again
              </button>
              {remove}
            </Actions>
          </>
        );
    }
  };
  return (
    <div className="flex w-full max-w-lg flex-col items-start gap-3">
      {files.length > 0 && <FileRow files={files} />}
      {content()}
    </div>
  );
}

/** Which card takes a window-level drop: the one most in view, so the result shows where the visitor is
 *  looking. Both instances work this out and only the winner keeps the files. */
function isDropTarget(card: HTMLElement | null): boolean {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-hero-card]"));
  const inView = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  };
  return cards.reduce<HTMLElement | null>((best, el) => (!best || inView(el) > inView(best) ? el : best), null) === card;
}

/** The landing page's working tool: drop a file or type a question (§3.1, §3.2). The flow itself lives
 *  in useHeroUpload. `compact` (closing band, §3.6) is the dropzone alone, with the same flow.
 *  It draws its own cut panel, so the page places it bare (never inside another card). */
export function HeroUpload({ variant = "full" }: { variant?: "full" | "compact" }) {
  const compact = variant === "compact";
  const { ready, me, demo, persona } = useVisitor();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hero = useHeroUpload(textarea);
  // Send rests flat (aria-disabled) while the ask box is empty, as the Composer's Send does, so the
  // fold has one filled primary at rest. Read on mount too: the browser may restore the box's text.
  const [hasQuestion, setHasQuestion] = useState(false);
  useEffect(() => {
    setHasQuestion(Boolean(textarea.current?.value.trim()));
  }, []);
  const { state } = hero;
  const busy = isBusy(state);
  const runActive = useRunActive();
  // The other card is running. This one can't take anything until it ends, and says so.
  const elsewhere = runActive && !busy;

  const card = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const { dragging } = useFileDrop({
    enabled: !runActive && !busy,
    onFiles: (files) => {
      if (isDropTarget(card.current)) hero.addFiles(files);
    },
  });

  // Actions unmount as the state changes, so focus would fall to <body>. Keep it near what was used,
  // and keep the result in view when the drop came from a window scrolled away from the zone.
  const shownKind = useRef(state.kind);
  const lastJob = useRef<HeroJob["kind"]>("upload");
  useEffect(() => {
    if (shownKind.current === state.kind) return;
    shownKind.current = state.kind;
    if ("job" in state) lastJob.current = state.job.kind;
    else if (state.kind !== "idle") lastJob.current = "upload";
    const target = lastJob.current === "ask" ? textarea.current : zone.current;
    if (document.activeElement === document.body) target?.focus({ preventScroll: true });
    if (state.kind !== "idle") target?.scrollIntoView({ block: "nearest" });
  }, [state]);

  const submitQuestion = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    hero.ask(String(new FormData(ev.currentTarget).get("q") ?? "").trim());
  };

  const onQuestionKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter that confirms an IME candidate belongs to the IME (§9 #4).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const pickable = !elsewhere && (state.kind === "idle" || state.kind === "rejected" || state.kind === "server_rejected");
  const refused = state.kind === "rejected" || state.kind === "server_rejected";
  const uploadPanel = "job" in state && state.job.kind === "upload" ? state : null;
  const askPanel = "job" in state && state.job.kind === "ask" ? state : null;
  const hot = pickable && dragging;
  const askBusy = askPanel !== null && busy;
  // The note about the shared account: a demo session is running, or about to be.
  const demoRunning = persona !== null || state.kind === "signing_in" || (state.kind === "uploading" && state.demoStep);
  const sharedNote = demoRunning && (state.kind === "signing_in" || state.kind === "uploading");
  const askFooter = elsewhere
    ? "Upload running. Ask when it finishes."
    : !ready
      ? "Press Enter to send."
      : me && !persona
        ? "Uses your documents. Press Enter to send."
        : demo?.enabled
          ? "Uses the demo documents. Press Enter to send."
          : "Sign in first. Press Enter to send.";

  const Zone = pickable ? "label" : "div";

  return (
    <>
      {!compact && (
        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none fixed inset-4 z-[var(--z-modal)] grid place-items-center p-6 pointer-coarse:hidden",
            "rounded-2xl border-2 border-dashed border-dropzone-border",
            "bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] backdrop-blur-[2px]",
            "transition-[opacity,visibility] ease-out",
            dragging && !busy && !runActive
              ? "visible opacity-100 duration-(--dur-micro)"
              : "invisible opacity-0 duration-(--dur-micro)",
          )}
        >
          <div className="cut flex max-w-md items-start gap-4 border border-border bg-panel px-8 py-6 text-left shadow-elev-3">
            <Icon name="upload" width={24} height={24} strokeWidth={1.75} className="mt-1 shrink-0 text-accent" />
            <div>
              <p className="font-display text-2xl font-semibold tracking-head text-text">Drop your file to start</p>
              <p className="mt-1 text-sm text-muted">PDF, Word, text or Markdown, up to {MAX_MB} MB each</p>
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <div
          ref={card}
          data-hero-card=""
          className="@container cut border border-border bg-panel p-4 shadow-elev-1 sm:p-6"
        >
          <div className={cx("grid gap-4", !compact && "@3xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]")}>
            {/* A programmatic focus target only (tabIndex -1): the controls inside carry the ring. */}
            <div
              ref={zone}
              tabIndex={-1}
              className="flex min-w-0 scroll-mt-20 flex-col focus-visible:outline-none!"
            >
              <Zone
                className={cx(
                  "relative flex flex-1 flex-col justify-center gap-3 rounded-lg border-2 px-4 py-4 text-left sm:px-6",
                  compact ? "min-h-30" : "min-h-40 @3xl:min-h-50",
                  "transition-colors duration-(--dur-micro) ease-out",
                  refused
                    ? "border-solid border-bad bg-bad-soft/40"
                    : hot
                      ? "border-solid border-accent bg-accent-soft"
                      : "border-dashed border-dropzone-border bg-accent-soft/40",
                  pickable &&
                    !refused &&
                    "cursor-pointer hover:border-solid hover:border-accent hover:bg-accent-soft focus-within:border-solid focus-within:border-accent focus-within:bg-accent-soft active:bg-accent-soft",
                  pickable && refused && "cursor-pointer",
                )}
              >
                {uploadPanel ? (
                  <JobPanel state={uploadPanel} hero={hero} demoRunning={demoRunning} />
                ) : (
                  <>
                    {elsewhere && !refused ? (
                      <span role="status" className="block max-w-md text-sm font-medium text-text [overflow-wrap:anywhere]">
                        Another upload is running on this page. You can add files here when it finishes.
                      </span>
                    ) : refused ? (
                      <div className="flex max-w-lg items-start gap-3">
                        <AlertGlyph className="mt-0.5 text-bad" />
                        <span role="alert" className="block text-sm font-medium text-bad [overflow-wrap:anywhere]">
                          {state.message}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <Icon
                          name="upload"
                          width={20}
                          height={20}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-accent"
                        />
                        <p className="min-w-0 font-display text-lg leading-6 font-medium text-text">
                          <span className="pointer-coarse:hidden">Drag a file here, or</span>
                          <span className="hidden pointer-coarse:inline">Tap to choose a file</span>
                        </p>
                      </div>
                    )}
                    {!elsewhere && (
                      <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2", !refused && "sm:pl-8")}>
                        <button
                          type="button"
                          // The wrapping <label> would otherwise become the button's accessible name.
                          aria-label={refused ? "Choose another file" : "Choose a file"}
                          onClick={() => input.current?.click()}
                          className={cx(
                            "key min-h-11 sm:min-h-10",
                            "pointer-coarse:min-h-12 pointer-coarse:w-full pointer-coarse:max-w-[360px]",
                            hot && "key-primary",
                          )}
                        >
                          {refused ? "Choose another file" : "Choose a file"}
                        </button>
                        <input
                          ref={input}
                          type="file"
                          multiple
                          accept={ACCEPT_ATTR}
                          className="sr-only"
                          tabIndex={-1}
                          aria-label="Choose files to add"
                          onChange={(e) => {
                            hero.addFiles(Array.from(e.target.files ?? []));
                            e.target.value = "";
                          }}
                        />
                      </div>
                    )}
                    {/* Types and limits follow the key, so "Drag a file here, or" leads straight to it. */}
                    {!elsewhere && !refused && (
                      <p className="flex flex-wrap gap-x-3 text-xs leading-5 text-muted sm:pl-8">
                        {!compact && <span>PDF, Word, text, Markdown and scanned PDFs</span>}
                        <span>
                          Up to <span className="num">{MAX_MB}</span> MB each, <span className="num">{MAX_FILES}</span>{" "}
                          at a time
                        </span>
                      </p>
                    )}
                  </>
                )}
              </Zone>
            </div>
            {!compact && (
              <form
                onSubmit={submitQuestion}
                aria-busy={askBusy || undefined}
                className={cx(
                  "flex flex-col rounded-input border border-border-strong bg-panel px-3 pt-3 pb-2",
                  "transition-colors duration-(--dur-micro) ease-out hover:border-text-2",
                  "has-[textarea:focus-visible]:border-accent has-[textarea:focus-visible]:outline-2",
                  "has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus",
                  "has-[textarea:focus-visible]:outline-solid",
                  "@3xl:min-h-50",
                )}
              >
                <label htmlFor="hero-question" className="sr-only">
                  Ask a question
                </label>
                <textarea
                  ref={textarea}
                  id="hero-question"
                  name="q"
                  maxLength={4000}
                  rows={2}
                  // A question on its way can't change under the visitor. Once it is held, an edit counts.
                  readOnly={askBusy}
                  placeholder="Or ask a question, e.g. How long are backups retained?"
                  // The ring is drawn on the whole box above (has-[textarea:focus-visible]).
                  className="min-h-12 flex-1 resize-none bg-transparent text-base leading-6 text-text placeholder:text-muted read-only:text-text-2 focus-visible:outline-none!"
                  onKeyDown={onQuestionKey}
                  onInput={(e) => setHasQuestion(e.currentTarget.value.trim() !== "")}
                />
                {askPanel && (
                  <div className="mt-3 scroll-mt-20 border-t border-border pt-3">
                    <JobPanel state={askPanel} hero={hero} demoRunning={demoRunning} />
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-xs leading-5 text-muted">{askFooter}</span>
                  <button
                    type="submit"
                    aria-label="Send question"
                    aria-disabled={busy || elsewhere || !hasQuestion || undefined}
                    aria-busy={askBusy || undefined}
                    // `.key` dims an aria-disabled key; the cursor says why: waiting, or not available.
                    className="key key-primary size-10 shrink-0 p-0 pointer-coarse:size-11 aria-disabled:cursor-not-allowed aria-busy:cursor-progress"
                  >
                    <Icon name="send" width={16} height={16} />
                  </button>
                </div>
              </form>
            )}
          </div>
          {elsewhere && (uploadPanel || askPanel) && (
            <p role="status" className="mt-3 text-sm text-muted">
              Another upload is running on this page. Try this one again when it finishes.
            </p>
          )}
        </div>
        <p className="mt-3 flex min-h-5 items-start gap-2 text-xs leading-5 text-muted">
          {ready && (
            <>
              <Icon name="lock" width={14} height={14} aria-hidden="true" className="mt-[3px] shrink-0" />
              <span>
                {demo?.enabled
                  ? "Demo files go to a shared workspace on this server. Please don't upload anything private."
                  : "Files are stored on the server running RackFlow."}
              </span>
            </>
          )}
        </p>
        {sharedNote && (
          <p className="mt-1 pl-6 text-xs leading-5 text-muted">
            You&apos;re using a shared demo account. Others using this demo can see what you upload.
          </p>
        )}
      </div>
    </>
  );
}
