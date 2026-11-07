"use client";

import Link from "next/link";
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cx } from "@/components/ui";
import { NETWORK_ERROR_COPY } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/demo";
import { formatBytes } from "@/lib/format";
import { middleTruncate } from "@/lib/status";
import { useFileDrop } from "@/lib/useFileDrop";
import { ACCEPT_ATTR, MAX_FILE_BYTES, MAX_FILES } from "@/lib/workspace";
import { fileKind, KIND_LABEL, TypeTile } from "@/components/workspace/library/parts";
import { isBusy, SIGN_IN_HREF, useHeroUpload, useRunActive, type HeroJob, type HeroState } from "./useHeroUpload";
import { useVisitor } from "./Visitor";

const MAX_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

const OUTLINE_ACTION =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong bg-panel px-4 " +
  "text-sm font-medium text-text transition-colors duration-150 hover:bg-panel-2";
const PRIMARY_ACTION =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium " +
  "text-accent-contrast transition-opacity duration-150 hover:opacity-90";

const SUBLINE: { word: string; tile: string; icon: IconName }[] = [
  { word: "PDF", tile: "bg-bad", icon: "file" },
  { word: "Word", tile: "bg-info", icon: "file" },
  { word: "Text", tile: "bg-muted", icon: "file" },
  { word: "Markdown", tile: "bg-muted", icon: "file" },
  { word: "Scanned PDFs", tile: "bg-accent", icon: "scan" },
];

function FileRow({ files }: { files: File[] }) {
  const total = files.reduce((n, f) => n + f.size, 0);
  const name = files.length === 1 ? files[0].name : `${files.length} files`;
  return (
    <div className="flex w-full min-w-0 items-center gap-3 text-left">
      <TypeTile kind={fileKind(files[0].name)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={name}>
          {middleTruncate(name, 44)}
        </p>
        <p className="text-[13px] leading-5 text-muted">
          {files.length === 1 ? KIND_LABEL[fileKind(files[0].name)] : "Files"} · {formatBytes(total)}
        </p>
      </div>
    </div>
  );
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center">
        {done ? (
          <Icon name="check" width={16} height={16} className="text-accent" />
        ) : (
          <span className="size-3.5 rounded-full border-2 border-accent border-t-transparent motion-safe:animate-spin" />
        )}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
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
      className="h-1 w-full overflow-hidden rounded-full bg-panel-2"
    >
      {/* scaleX, not width: §8.4 only animates transform and opacity. */}
      <div
        className="h-full origin-left rounded-full bg-accent transition-transform duration-200"
        style={{ transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}

function Note({ tone, alert, children }: { tone: "bad" | "warn" | "plain"; alert?: boolean; children: ReactNode }) {
  return (
    <p
      role={alert ? "alert" : undefined}
      className={cx(
        "w-full rounded-md px-3 py-2 text-left text-sm [overflow-wrap:anywhere]",
        tone === "bad" && "bg-bad-soft text-bad",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "plain" && "px-0 py-0",
      )}
    >
      {children}
    </p>
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
          <Link href="/library" className="underline">
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
            <ul className="w-full space-y-1.5">
              <Step done={false}>Opening the Engineer demo account</Step>
            </ul>
            <Actions>{cancel}</Actions>
          </>
        );
      case "uploading": {
        const percent = Math.round(state.progress * 100);
        return (
          <>
            <ul className="w-full space-y-1.5">
              {state.demoStep && <Step done>Opening the Engineer demo account</Step>}
              <Step done={false}>
                Uploading {jobName} · {percent}%
              </Step>
            </ul>
            <ProgressBar fraction={state.progress} />
            <Actions>
              {state.stopping ? (
                <button type="button" aria-disabled="true" className={cx(OUTLINE_ACTION, "cursor-wait opacity-60")}>
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
          <ul className="w-full space-y-1.5">
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
          <ul className="w-full space-y-1.5">
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
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">Sign in to ask about {jobName}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-muted">
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
              in {state.seconds}s…
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
    <div className="flex w-full max-w-md flex-col items-start gap-3">
      {files.length > 0 && <FileRow files={files} />}
      {content()}
    </div>
  );
}

function AlertWell() {
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-bad-soft text-bad">
      <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4 3 20h18zM12 10v4.5M12 17.5h.01" />
      </svg>
    </span>
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
 *  in useHeroUpload. `compact` (closing band, §3.6) is the dropzone alone, with the same flow. */
export function HeroUpload({ variant = "full" }: { variant?: "full" | "compact" }) {
  const compact = variant === "compact";
  const { ready, me, demo, persona } = useVisitor();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hero = useHeroUpload(textarea);
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
  // The note about the shared account: a demo session is running, or about to be.
  const demoRunning = persona !== null || state.kind === "signing_in" || (state.kind === "uploading" && state.demoStep);
  const sharedNote = demoRunning && (state.kind === "signing_in" || state.kind === "uploading");
  const askFooter = elsewhere
    ? "Upload running · ask when it finishes"
    : !ready
      ? "Press Enter"
      : me && !persona
        ? "Uses your documents · press Enter"
        : demo?.enabled
          ? "Uses the demo documents · press Enter"
          : "Sign in first · press Enter";

  const Zone = pickable ? "label" : "div";

  return (
    <>
      {!compact && (
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none fixed inset-4 z-50 grid place-items-center rounded-3xl bg-accent/8 p-6 backdrop-blur-[2px] pointer-coarse:hidden",
          "transition-[opacity,visibility] ease-(--ease-snappy)",
          dragging && !busy && !runActive ? "visible opacity-100 duration-120" : "invisible opacity-0 duration-100",
        )}
      >
        <svg className="absolute top-px left-px h-[calc(100%-2px)] w-[calc(100%-2px)] overflow-visible text-dropzone-border">
          <rect width="100%" height="100%" rx="23" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="10 8" />
        </svg>
        <div className="relative flex max-w-md flex-col items-center rounded-2xl bg-panel/90 px-8 py-7 text-center shadow-elev-3">
          <Icon name="upload" width={48} height={48} strokeWidth={1.5} className="text-accent" />
          <p className="mt-4 text-2xl font-semibold tracking-tight text-text">Drop your file to start</p>
          <p className="mt-2 text-sm text-muted">PDF, Word, text or Markdown · up to {MAX_MB} MB</p>
        </div>
      </div>
      )}

      {/* isolate: without its own stacking context the glow sits behind the page's opaque background. */}
      <div className="relative isolate">
        {!compact && (
          <div
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute top-[-50px] left-1/2 -z-10 h-[420px] w-[896px] -translate-x-1/2",
              "dark:opacity-50 [[data-theme=dark]_&]:opacity-50 [[data-theme=light]_&]:opacity-100",
            )}
            style={{
              filter: "blur(48px)",
              background:
                "radial-gradient(45% 60% at 30% 45%, rgb(15 107 102 / .14), transparent)," +
                "radial-gradient(45% 60% at 72% 60%, rgb(217 160 60 / .10), transparent)",
            }}
          />
        )}
        <div
          ref={card}
          data-hero-card=""
          className="rounded-2xl border border-border bg-panel px-5 pt-4 pb-5"
        >
          {!compact && (
            <p className="mb-4 text-center text-lg leading-7 font-semibold">
              {SUBLINE.map(({ word, tile, icon }, i) => (
                <span key={word}>
                  {i > 0 && " · "}
                  <span className="whitespace-nowrap">
                    <span
                      aria-hidden="true"
                      className={cx("mr-1 inline-grid size-4 place-items-center rounded-[4px] align-[-2px] text-panel", tile)}
                    >
                      <Icon name={icon} width={12} height={12} strokeWidth={2} />
                    </span>
                    {word}
                  </span>
                </span>
              ))}
            </p>
          )}
          <div className={cx("grid gap-4", !compact && "md:grid-cols-[7fr_5fr]")}>
            <div ref={zone} tabIndex={-1} className="flex min-w-0 scroll-mt-20 flex-col outline-none">
              <Zone
                className={cx(
                  "relative flex flex-1 flex-col items-center justify-center gap-2 rounded-xl px-4 py-3 text-center",
                  compact ? "min-h-[120px]" : "min-h-[180px] md:min-h-[200px]",
                  "transition-colors duration-150",
                  hot ? "bg-accent-soft" : "bg-accent-soft/50",
                  pickable && "group cursor-pointer hover:bg-accent-soft focus-within:bg-accent-soft",
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
                      "transition-colors duration-150",
                      refused
                        ? "stroke-bad"
                        : hot
                          ? "stroke-accent"
                          : "stroke-dropzone-border [stroke-dasharray:4_4]",
                      pickable &&
                        !refused &&
                        "group-hover:stroke-accent group-hover:[stroke-dasharray:none] group-focus-within:stroke-accent group-focus-within:[stroke-dasharray:none]",
                    )}
                  />
                </svg>

                {uploadPanel ? (
                  <JobPanel state={uploadPanel} hero={hero} demoRunning={demoRunning} />
                ) : (
                  <>
                    {elsewhere && !refused ? (
                      <span role="status" className="block max-w-md text-sm font-medium [overflow-wrap:anywhere]">
                        Another upload is running on this page. You can add files here when it finishes.
                      </span>
                    ) : refused ? (
                      <>
                        <AlertWell />
                        <span role="alert" className="block max-w-md text-sm font-medium text-bad [overflow-wrap:anywhere]">
                          {state.message}
                        </span>
                      </>
                    ) : (
                      <>
                        {!compact && (
                          <span className="grid size-10 place-items-center rounded-full bg-panel text-accent">
                            <Icon name="upload" width={20} height={20} />
                          </span>
                        )}
                        <span className="text-base font-semibold pointer-coarse:hidden">Drag a file here</span>
                        <span className="text-sm text-muted pointer-coarse:hidden">or</span>
                        <span className="hidden text-base font-semibold pointer-coarse:inline">Tap to choose a file</span>
                      </>
                    )}
                    {!elsewhere && (
                      <>
                        <button
                          type="button"
                          // The wrapping <label> would otherwise become the button's accessible name.
                          aria-label={refused ? "Choose another file" : "Choose a file"}
                          onClick={() => input.current?.click()}
                          className={cx(
                            "inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium",
                            "transition-colors duration-150",
                            "group-hover:border-transparent group-hover:bg-accent group-hover:text-accent-contrast",
                            "pointer-coarse:h-12 pointer-coarse:w-full pointer-coarse:max-w-[360px]",
                            hot
                              ? "border-transparent bg-accent text-accent-contrast"
                              : "border-border-strong bg-panel text-text",
                          )}
                        >
                          {refused ? "Choose another file" : "Choose a file"}
                        </button>
                        {!refused && (
                          <span className="text-[13px] leading-5 text-muted">
                            Up to {MAX_MB} MB each · {MAX_FILES} at a time
                          </span>
                        )}
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
                      </>
                    )}
                  </>
                )}
              </Zone>
            </div>
            {!compact && (
              <form
                onSubmit={submitQuestion}
                className="flex flex-col rounded-xl border border-border-strong bg-panel p-4 transition-colors duration-150 focus-within:border-accent md:min-h-[200px]"
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
                  readOnly={askPanel !== null && busy}
                  placeholder="Or ask a question, e.g. How long are backups retained?"
                  className="min-h-12 flex-1 resize-none bg-transparent text-base leading-6 outline-none placeholder:text-muted"
                  onKeyDown={onQuestionKey}
                />
                {askPanel && (
                  <div className="mt-3 scroll-mt-20">
                    <JobPanel state={askPanel} hero={hero} demoRunning={demoRunning} />
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] leading-5 text-muted">{askFooter}</span>
                  <button
                    type="submit"
                    aria-label="Send question"
                    aria-disabled={busy || elsewhere || undefined}
                    className={cx(
                      "grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-contrast transition-opacity duration-150",
                      "hover:opacity-90 aria-disabled:cursor-wait aria-disabled:opacity-60 pointer-coarse:size-11",
                    )}
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
        <p className="mt-3 flex min-h-5 items-start justify-center gap-1.5 text-center text-[13px] leading-5 text-muted">
          {ready && (
            <>
              <Icon name="lock" width={14} height={14} className="mt-[3px] shrink-0" />
              <span>
                {demo?.enabled
                  ? "Demo files go to a shared workspace on this server. Please don't upload anything private."
                  : "Files are stored on the server running RackFlow."}
              </span>
            </>
          )}
        </p>
        {sharedNote && (
          <p className="mt-1 text-center text-xs text-muted">
            You&apos;re using a shared demo account. Others using this demo can see what you upload.
          </p>
        )}
      </div>
    </>
  );
}
