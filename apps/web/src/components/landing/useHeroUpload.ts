"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useSyncExternalStore, type RefObject } from "react";
import { announce } from "@/lib/announce";
import { api, ApiError, errorText, isAbortError, isNetworkError, UPLOAD_INTERRUPTED_COPY } from "@/lib/api";
import { pendingStore } from "@/lib/pendingStore";
import { reasonCopy } from "@/lib/status";
import type { Me, UploadItem } from "@/lib/types";
import {
  currentUser,
  ensureMyDocuments,
  fetchDemoInfo,
  fileRejection,
  partitionFiles,
  requestGroups,
  skippedNote,
  uploadInGroups,
} from "@/lib/workspace";
import { isUnreachable, useVisitor } from "./Visitor";

// The §3.2 hero flow. Every state that follows a pick, drop or Enter carries its job, so any failure
// can run again without the visitor choosing the file or typing the question a second time.

/** What the visitor asked for. `handOff` is every file this upload leaves out: /ask adds them through
 *  its own uploader, which lists the rejected ones in the skipped-files note (§3.2 mixed batch). */
export type HeroJob =
  | { kind: "upload"; files: File[]; handOff: File[] }
  | { kind: "ask"; question: string };

/** A file this run put on the server. `duplicate` results are not listed: those were already there. */
export interface StoredFile {
  id: string;
  name: string;
}

export type HeroState =
  | { kind: "idle" }
  | { kind: "rejected"; message: string }
  | { kind: "server_rejected"; message: string }
  /** Waiting on GET /auth/me, before anything can be said about the session. */
  | { kind: "checking"; job: HeroJob }
  | { kind: "signing_in"; job: HeroJob }
  /** `stopping`: Cancel came after the request's body had gone, so it waits for the server's answer. */
  | { kind: "uploading"; job: HeroJob; progress: number; demoStep: boolean; stopping: boolean }
  | { kind: "opening"; job: HeroJob; demoStep: boolean }
  /** Cancelled with nothing left on the server: the files stay on screen, ready to send again.
   *  `removed` counts the saved copies just taken back. */
  | { kind: "kept"; job: HeroJob; removed?: number }
  /** Stopped, by Cancel or a failure, after the server had already stored some files. */
  | { kind: "stored"; job: HeroJob; stored: StoredFile[]; cause: "cancelled" | "failed"; removeFailed?: boolean }
  | { kind: "removing"; job: HeroJob; stored: StoredFile[] }
  | { kind: "demo_off"; job: HeroJob; personaMissing: boolean; sessionEnded?: boolean }
  | { kind: "role_cannot_upload"; job: HeroJob; role: string; demoOn: boolean }
  | { kind: "rate_limited"; job: HeroJob; seconds: number }
  | { kind: "api_down"; job: HeroJob }
  | { kind: "upload_failed"; job: HeroJob; message: string };

type ActiveState = Exclude<HeroState, { kind: "idle" }>;

type HeroEvent =
  | { type: "reset" }
  | { type: "progress"; fraction: number }
  | { type: "stopping" }
  | { type: "enter"; state: ActiveState };

const IDLE: HeroState = { kind: "idle" };

function reducer(state: HeroState, event: HeroEvent): HeroState {
  switch (event.type) {
    case "reset":
      return IDLE;
    case "enter":
      return event.state;
    case "progress":
      // A progress event can land just after the upload was cancelled.
      return state.kind === "uploading" ? { ...state, progress: event.fraction } : state;
    case "stopping":
      return state.kind === "uploading" ? { ...state, stopping: true } : state;
  }
}

const BUSY_KINDS: ReadonlySet<HeroState["kind"]> = new Set([
  "checking",
  "signing_in",
  "uploading",
  "opening",
  "rate_limited",
  "removing",
]);

export function isBusy(state: HeroState): boolean {
  return BUSY_KINDS.has(state.kind);
}

/** Sign-in that comes back to /ask with whatever is waiting in the pending store. */
export const SIGN_IN_HREF = "/login?next=/ask&resume=1";
const RETRY_AFTER_FALLBACK_S = 20;
/** §3.2: each step stays on screen at least this long. */
const MIN_STEP_MS = 500;
/** From here on the server may get the whole body however fast we abort, and an aborted request never
 *  says what the server did. Waiting for the answer costs little, so it starts just short of 100%. */
const BODY_SENT_FRACTION = 0.98;

const abortedError = () => new ApiError(0, "ABORTED", "The request was cancelled.", null);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortedError());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Stop waiting for a call that takes no signal. The call itself carries on. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// The hero and the closing band are separate instances, and both can receive a pick. One run at a
// time keeps a second drop from racing the first through the demo login.
let activeRun: AbortController | null = null;
const runListeners = new Set<() => void>();

function claimRun(run: AbortController): boolean {
  if (activeRun) return false;
  activeRun = run;
  runListeners.forEach((listener) => listener());
  return true;
}

function releaseRun(run: AbortController): void {
  if (activeRun !== run) return;
  activeRun = null;
  runListeners.forEach((listener) => listener());
}

function subscribeToRuns(listener: () => void): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

/** Whether either card is running, so the one that is not can say so instead of taking a file it
 *  would have to refuse. */
export function useRunActive(): boolean {
  return useSyncExternalStore(
    subscribeToRuns,
    () => activeRun !== null,
    () => false,
  );
}

const ANOTHER_RUN_COPY = "Another upload is running on this page. Add this file again when it finishes.";

/** The question or files wait in the pending store while the visitor signs in. A question is restored
 *  into the composer unsent (§3.2 Ask box). */
function storeForSignIn(job: HeroJob): void {
  if (job.kind === "ask") pendingStore.set({ question: job.question, autoSend: false });
  else pendingStore.set({ files: [...job.files, ...job.handOff] });
}

function serverRejectedCopy(rejected: UploadItem[]): string {
  const reason = reasonCopy(rejected[0]?.error?.code);
  return rejected.length > 1 ? `${rejected.length} files weren't accepted. ${reason}` : reason;
}

/** One run's progress through the steps, kept across automatic retries after a 429. */
interface RunContext {
  phase: "session" | "upload";
  /** Log out first ("Switch to Engineer"). Cleared once the old session is gone. */
  switching: boolean;
  loggedOut: boolean;
  /** The demo login went out. A cancel may still land on the server, so the top bar asks again. */
  signInSent: boolean;
  signedIn: boolean;
  /** This run showed the demo sign-in step, so the checklist keeps it, checked. */
  demoStep: boolean;
  stepAt: number | null;
  user: Me | null;
  /** What the server holds from this run, across groups and retries. */
  stored: StoredFile[];
  /** The current request's body has gone, so aborting it could no longer say what the server did. */
  bodySent: boolean;
  /** Cancel pressed while bodySent: stop as soon as that request answers. */
  cancelWanted: boolean;
}

/** Where a failure lands in the §3.2 table. */
function failureState(e: unknown, job: HeroJob, ctx: RunContext, demoOn: boolean): ActiveState {
  if (!(e instanceof ApiError)) return { kind: "upload_failed", job, message: errorText(e) };
  if (isNetworkError(e)) {
    return e.message === UPLOAD_INTERRUPTED_COPY
      ? { kind: "upload_failed", job, message: UPLOAD_INTERRUPTED_COPY }
      : { kind: "api_down", job };
  }
  if (ctx.phase === "session") {
    return isUnreachable(e) ? { kind: "api_down", job } : { kind: "upload_failed", job, message: e.message };
  }
  // Upload step. A session that ended a moment ago is checked again by Try again.
  if (e.status >= 500 || e.status === 401) return { kind: "upload_failed", job, message: UPLOAD_INTERRUPTED_COPY };
  if (e.status === 403 && ctx.user) return { kind: "role_cannot_upload", job, role: ctx.user.role, demoOn };
  return { kind: "server_rejected", message: reasonCopy(e.code) };
}

/** `questionBox` is the ask box: a held question is read back from it, since it stays editable. */
export function useHeroUpload(questionBox?: RefObject<HTMLTextAreaElement | null>) {
  const { demo, me, persona, reload, signInAs } = useVisitor();
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, IDLE);
  const controller = useRef<AbortController | null>(null);
  const liveRun = useRef<RunContext | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const enter = (next: ActiveState) => dispatch({ type: "enter", state: next });

  const holdStep = async (ctx: RunContext, signal: AbortSignal) => {
    if (ctx.stepAt !== null) await sleep(Math.max(0, ctx.stepAt + MIN_STEP_MS - Date.now()), signal);
    ctx.stepAt = Date.now();
  };

  /** Steps 2 and 3: the existing session, else the Engineer demo. Null when the run stops here. */
  const resolveSession = async (job: HeroJob, ctx: RunContext, signal: AbortSignal): Promise<Me | null> => {
    if (ctx.switching) {
      enter({ kind: "signing_in", job });
      await api<void>("/auth/logout", { method: "POST", noAuthRedirect: true, signal }).catch((e: unknown) => {
        // A session that already ended is as good as a logout.
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      });
      ctx.switching = false;
      ctx.loggedOut = true;
    } else {
      const user = await currentUser(signal);
      if (user) return user;
      // This tab belonged to a real account whose session has ended. Signing in to the shared demo
      // here would put a private file where other people can see it.
      if (me && !persona && !ctx.loggedOut) {
        toSignIn(job, false, true);
        return null;
      }
    }

    // `demo` is null until the page's own check finishes, or when that check failed.
    const info = demo ?? (await untilAborted(fetchDemoInfo(), signal));
    if (!info.enabled) {
      toSignIn(job, false);
      return null;
    }
    enter({ kind: "signing_in", job });
    announce("Signing in");
    ctx.demoStep = true;
    ctx.stepAt = Date.now();
    ctx.signInSent = true;
    try {
      // Through the Visitor so the top bar stays right. Cancel aborts the request.
      const user = await signInAs("engineer", signal);
      ctx.signedIn = true;
      return user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        toSignIn(job, true);
        return null;
      }
      throw e;
    }
  };

  /** demo_off and persona_missing. A question on a demo-off server goes straight to the login page. */
  const toSignIn = (job: HeroJob, personaMissing: boolean, sessionEnded = false) => {
    storeForSignIn(job);
    if (job.kind === "ask" && !personaMissing) {
      dispatch({ type: "reset" });
      router.push(SIGN_IN_HREF);
      return;
    }
    enter({ kind: "demo_off", job, personaMissing, sessionEnded });
  };

  /** The upload step, one request at a time, so what a finished request stored is known even if a
   *  later one is cancelled or fails. Results come back in input order. */
  const sendFiles = async (files: File[], user: Me, ctx: RunContext, signal: AbortSignal): Promise<UploadItem[]> => {
    const collection = await ensureMyDocuments(user.display_name, signal);
    const totalBytes = files.reduce((n, f) => n + f.size, 0) || 1;
    const items: UploadItem[] = [];
    let doneBytes = 0;
    for (const group of requestGroups(files, (f) => f.size)) {
      const groupBytes = group.reduce((n, f) => n + f.size, 0);
      const sentBefore = doneBytes;
      let results: UploadItem[];
      try {
        results = await uploadInGroups(
          collection.id,
          group,
          (fraction) => {
            ctx.bodySent = fraction >= BODY_SENT_FRACTION;
            dispatch({ type: "progress", fraction: Math.min(1, (sentBefore + fraction * groupBytes) / totalBytes) });
          },
          signal,
        );
      } finally {
        ctx.bodySent = false;
      }
      items.push(...results);
      doneBytes += groupBytes;
      for (const item of results) {
        const id = item.document_id;
        if (item.status === "queued" && id && !ctx.stored.some((f) => f.id === id)) {
          ctx.stored.push({ id, name: item.filename });
        }
      }
      if (ctx.cancelWanted) controller.current?.abort();
      if (signal.aborted) throw abortedError();
    }
    return items;
  };

  const attempt = async (job: HeroJob, ctx: RunContext, signal: AbortSignal) => {
    ctx.phase = "session";
    const user = await resolveSession(job, ctx, signal);
    if (!user) return;
    ctx.user = user;

    const needed = job.kind === "ask" ? "chat:use" : "document:upload";
    if (!user.permissions.includes(needed)) {
      const info = demo ?? (await untilAborted(fetchDemoInfo(), signal));
      enter({ kind: "role_cannot_upload", job, role: user.role, demoOn: info.enabled });
      return;
    }

    if (job.kind === "ask") {
      await holdStep(ctx, signal);
      // /ask sends it: the visitor already pressed Enter (§3.2 Ask box).
      pendingStore.set({ question: job.question, autoSend: true });
      enter({ kind: "opening", job, demoStep: ctx.demoStep });
      router.push("/ask");
      return;
    }

    ctx.phase = "upload";
    await holdStep(ctx, signal);
    enter({ kind: "uploading", job, progress: 0, demoStep: ctx.demoStep, stopping: false });
    announce("Uploading");
    const items = await sendFiles(job.files, user, ctx, signal);
    dispatch({ type: "progress", fraction: 1 });

    const accepted = items.filter((i) => i.status !== "rejected" && i.document_id);
    if (!accepted.length) {
      enter({ kind: "server_rejected", message: serverRejectedCopy(items) });
      return;
    }
    await holdStep(ctx, signal);
    enter({ kind: "opening", job, demoStep: ctx.demoStep });
    announce("Upload complete, opening chat");
    await holdStep(ctx, signal);

    if (!user.permissions.includes("chat:use")) {
      router.push("/library");
      return;
    }
    // Results come back in input order. A file the server refused goes to /ask too: uploading it there
    // gets refused the same way, which shows its reason on a chip rather than losing it silently.
    const refused = job.files.filter((_, i) => items[i]?.status === "rejected");
    const handOff = [...job.handOff, ...refused];
    if (handOff.length) pendingStore.set({ files: handOff });
    router.push(`/ask?doc=${accepted.map((i) => i.document_id).join(",")}`);
  };

  const run = async (job: HeroJob, switching = false, alreadyStored: StoredFile[] = []) => {
    const self = new AbortController();
    if (!claimRun(self)) {
      announce("An upload is already running.");
      // A held job keeps its panel, and the card says another run is going.
      if (job.kind === "upload" && !("job" in state)) enter({ kind: "rejected", message: ANOTHER_RUN_COPY });
      return;
    }
    controller.current = self;
    const { signal } = self;
    const ctx: RunContext = {
      phase: "session",
      switching,
      loggedOut: false,
      signInSent: false,
      signedIn: false,
      demoStep: false,
      stepAt: null,
      user: null,
      stored: [...alreadyStored],
      bodySent: false,
      cancelWanted: false,
    };
    liveRun.current = ctx;
    enter({ kind: "checking", job });
    try {
      for (;;) {
        let wait: number | null = null;
        try {
          await attempt(job, ctx, signal);
        } catch (e) {
          if (signal.aborted || ctx.cancelWanted || !(e instanceof ApiError) || e.status !== 429) throw e;
          wait = Math.max(1, e.retryAfter ?? RETRY_AFTER_FALLBACK_S);
          announce("Lots of people are using the demo right now. Trying again soon.");
        }
        if (wait === null) return;
        for (let seconds = wait; seconds > 0; seconds -= 1) {
          enter({ kind: "rate_limited", job, seconds });
          await sleep(1000, signal);
        }
        // The next attempt starts its own step: the wait above already held this one on screen.
        ctx.stepAt = null;
      }
    } catch (e) {
      const cancelled = signal.aborted || ctx.cancelWanted || isAbortError(e);
      // Whatever went wrong, the visitor is told what the server already holds.
      if (ctx.stored.length) enter({ kind: "stored", job, stored: ctx.stored, cause: cancelled ? "cancelled" : "failed" });
      else if (!cancelled) enter(failureState(e, job, ctx, demo?.enabled ?? false));
      else if (job.kind === "ask") dispatch({ type: "reset" });
      else enter({ kind: "kept", job });
    } finally {
      releaseRun(self);
      // Logged out, or a sign-in that was cut short: the top bar may be out of date.
      if ((ctx.loggedOut || ctx.signInSent) && !ctx.signedIn) reload();
    }
  };

  /** A pick or a drop. Validated here, in the browser, before any network call (§3.2 step 1). */
  const addFiles = (files: File[]) => {
    if (!files.length || isBusy(state)) return;
    // A new pick replaces a file waiting for sign-in.
    if (state.kind === "demo_off") pendingStore.set({ files: [] });
    const { valid, skipped } = partitionFiles(files);
    if (!valid.length) {
      const message = files.length === 1 ? fileRejection(files[0])?.message : skippedNote(skipped);
      if (message) enter({ kind: "rejected", message });
      return;
    }
    void run({ kind: "upload", files: valid, handOff: skipped.map((s) => s.file) });
  };

  const ask = (question: string) => {
    if (question && !isBusy(state)) void run({ kind: "ask", question });
  };

  /** Take back what this run stored. A document already gone or going counts as removed. */
  const removeStored = async () => {
    if (state.kind !== "stored") return;
    const { job, stored, cause } = state;
    const self = new AbortController();
    if (!claimRun(self)) return;
    enter({ kind: "removing", job, stored });
    const removed = await Promise.all(
      stored.map((file) =>
        api(`/documents/${encodeURIComponent(file.id)}`, { method: "DELETE", noAuthRedirect: true }).then(
          () => true,
          (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 409),
        ),
      ),
    );
    releaseRun(self);
    const left = stored.filter((_, i) => !removed[i]);
    if (left.length) {
      announce("Some files could not be removed.");
      enter({ kind: "stored", job, stored: left, cause, removeFailed: true });
    } else {
      announce(stored.length === 1 ? "Saved file removed." : "Saved files removed.");
      enter({ kind: "kept", job, removed: stored.length });
    }
  };

  const jobOf = "job" in state ? state.job : null;

  /** The held job as it stands now: a question is whatever the ask box says, not what it said at the
   *  first Enter. Null when there is nothing to send, including a box the visitor has emptied. */
  const currentJob = (): HeroJob | null => {
    if (jobOf?.kind !== "ask") return jobOf;
    const question = questionBox?.current?.value.trim();
    return question ? { kind: "ask", question } : null;
  };

  return {
    state,
    addFiles,
    ask,
    removeStored,
    /** Cancel a running step: it aborts the request and keeps the file. A body already sent can't be
     *  called back, so that request is left to answer and the card then says what the server stored. */
    cancel: () => {
      const ctx = liveRun.current;
      if (!ctx?.bodySent) {
        controller.current?.abort();
      } else if (!ctx.cancelWanted) {
        ctx.cancelWanted = true;
        dispatch({ type: "stopping" });
        announce("Stopping. Waiting for the server to answer.");
      }
    },
    /** Try again, or send again after a cancel, with the files already held. */
    retry: () => {
      const job = currentJob();
      if (job) void run(job, false, state.kind === "stored" ? state.stored : []);
      else dispatch({ type: "reset" });
    },
    /** role_cannot_upload, demo on: log out, demo login, continue with the same job. */
    switchToEngineer: () => {
      const job = currentJob();
      if (job) void run(job, true);
      else dispatch({ type: "reset" });
    },
    /** Drop the kept job and go back to the empty card. */
    clear: () => {
      if (state.kind === "demo_off") pendingStore.set({ files: [], question: null, autoSend: false });
      dispatch({ type: "reset" });
    },
    /** role_cannot_upload, demo off: the job waits in the pending store through sign-in. */
    keepForSignIn: () => {
      const job = currentJob();
      if (job) storeForSignIn(job);
      else pendingStore.set({ question: null, autoSend: false });
    },
  };
}
