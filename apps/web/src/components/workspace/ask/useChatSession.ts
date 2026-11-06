"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ApiError } from "@/lib/api";
import { TERMINAL_PHASES } from "@/lib/status";
import type { DocumentItem } from "@/lib/types";
import { LOADING_FILENAME } from "@/lib/workspace";
import { scopeLabel } from "../ScopeChip";
import type { AnswerView, ScopeValue, TrackedUpload, Turn, UploadsApi, WorkspaceApi } from "../types";
import { AskError, askQuestion, createSession, loadSession, renameSession, retryWaitMs } from "./chatApi";
import {
  answerFromResponse,
  clearDraft,
  isHoldPhase,
  isPendingDoc,
  localId,
  MAX_MESSAGE_CHARS,
  readScope,
  saveDraft,
  TITLE_CHARS,
  turnsFromMessages,
  UNTITLED,
  withoutNote,
  writeScope,
  type AskRoute,
} from "./helpers";
import type { AskData } from "./useAskData";

const NOTHING_READY = "Add a document first, then ask anything about it.";
const TOO_LONG = "Questions can be up to 4,000 characters. Shorten it and send again.";
const STOPPED = "Stopped. Your question is back in the question box.";
const RATE_WAIT = "You're asking faster than RackFlow can answer. Wait for the countdown, then try again.";
const STILL_BUSY = "Wait for the current question to finish, then try again.";

/** What a turn sends, kept so Try again resends the same text and scope (§5.6). */
interface TurnRequest {
  text: string;
  scope: ScopeValue;
  /** Upload rows (keys) the question is held for (§5.5 hold and auto-send). */
  waitKeys: string[];
  /** Documents being read elsewhere, held for when nothing was Ready yet (state C). */
  waitDocs: string[];
  /** "Answered without report.pdf (couldn't read it)." It stays with the question through a retry. */
  note?: string;
}

export interface AskTurn extends Turn {
  req?: TurnRequest;
  /** Rate limited: when the card's countdown ends and the question may go out again. */
  retryAt?: number;
}

/** "new": /ask. "loading"/"ready"/"not_found"/"error": a saved chat from /ask/c/{id}. */
export type LoadState = "new" | "loading" | "ready" | "not_found" | "error";

interface Options {
  route: AskRoute;
  /** Called right before the URL moves to /ask/c/{id}, so the view isn't remounted. */
  onAdopt: (sessionId: string) => void;
  /** A fresh answer arrived (sources default + auto-open). */
  onAnswer: (answer: AnswerView, hadCitationsBefore: boolean) => void;
  workspace: WorkspaceApi;
  uploads: UploadsApi;
  data: AskData;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const isActive = (t: Turn) => t.status === "held" || t.status === "waiting";
const isCountingDown = (t: AskTurn) => t.retryAt !== undefined && t.retryAt > Date.now();
const unknownError = () => new AskError(500, "UNKNOWN", "Something went wrong.", null);
const shownName = (name: string) => (name === LOADING_FILENAME ? "your file" : name);

function isFailedRow(r: TrackedUpload | undefined): r is TrackedUpload {
  return r !== undefined && (r.phase === "failed" || r.phase === "rejected");
}

function isReadingRow(r: TrackedUpload | undefined): r is TrackedUpload {
  return r !== undefined && isHoldPhase(r.phase);
}

function isReadingDoc(d: DocumentItem | undefined): d is DocumentItem {
  return d !== undefined && isPendingDoc(d);
}

/** One chat: lazy session, turns (held → waiting → answered | error), retries, Stop, scope and
 *  the draft (§5.3, §5.5, §5.6, §5.8). Never opens a chat the URL didn't name (§5.9). */
export function useChatSession(options: Options) {
  const { route, uploads, data, textareaRef } = options;
  // The route the view opened on. Adopting /ask/c/{id} after the first answer reloads nothing.
  const [initial] = useState(route);
  const savedId = initial.kind === "saved" ? initial.id : null;

  const [load, setLoad] = useState<LoadState>(
    initial.kind === "saved" ? "loading" : initial.kind === "invalid" ? "not_found" : "new",
  );
  const [loadError, setLoadError] = useState<ApiError | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [draft, setDraft] = useState("");
  // §5.8: every chat starts on All documents; narrowing is per chat.
  const [scope, setScope] = useState<ScopeValue>("all");
  // Shown beside the composer while the draft it was about is unchanged.
  const [notice, setNotice] = useState<{ text: string; draft: string } | null>(null);

  // §5.8: a collection deleted or revoked since it was chosen leaves the scope, so the chip and the
  // meta line say what is really searched.
  const readableScope = data.readableScope(scope);
  if (readableScope !== scope) setScope(readableScope);

  // §5.5: files added in this chat go to My documents, and a narrowed chat starts searching it too.
  // Adjusted during render: a row counts once, and the pending add waits for the collection to exist.
  const [uploadWatch, setUploadWatch] = useState(() => ({
    seen: new Set(uploads.items.map((u) => u.key)),
    addMine: false,
  }));
  const freshRows = uploads.items.filter((u) => !uploadWatch.seen.has(u.key));
  const mine = uploads.myCollection?.id;
  const addMine = uploadWatch.addMine || freshRows.some((u) => u.phase === "uploading");
  if (freshRows.length > 0 || (addMine && mine)) {
    setUploadWatch({
      seen: new Set([...uploadWatch.seen, ...freshRows.map((u) => u.key)]),
      addMine: addMine && !mine,
    });
    if (addMine && mine && scope !== "all" && !scope.includes(mine)) setScope([...scope, mine]);
  }

  // Every scope change reaches storage from here, whichever path made it.
  useEffect(() => {
    if (sessionId) writeScope(sessionId, scope);
  }, [sessionId, scope]);

  const sessionRef = useRef<string | null>(null);
  // The session's title while no question in it has been answered yet (it may need renaming).
  const unconfirmedTitle = useRef<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  // Async work reads the latest props and state through this.
  const live = useRef({ ...options, turns, draft, scope });
  useLayoutEffect(() => {
    live.current = { ...options, turns, draft, scope };
  });

  useEffect(() => {
    alive.current = true;
    const inFlight = controllers.current;
    return () => {
      alive.current = false;
      inFlight.forEach((c) => c.abort());
      inFlight.clear();
    };
  }, []);

  // ---------- Saved chat (/ask/c/{id}) ----------

  useEffect(() => {
    if (!savedId) return;
    let cancelled = false;
    loadSession(savedId).then(
      (detail) => {
        if (cancelled) return;
        sessionRef.current = detail.session.id;
        setSessionId(detail.session.id);
        setSessionTitle(detail.session.title);
        setTurns(turnsFromMessages(detail.messages));
        setScope(readScope(detail.session.id) ?? "all");
        if (detail.messages.length === 0) {
          // Its first question never got an answer: the name is all that is left of it, so offer it again.
          const named = detail.session.title.trim();
          if (named && named !== UNTITLED) {
            unconfirmedTitle.current = named;
            setDraft((d) => (d.trim() ? d : named));
          }
        }
        setLoad("ready");
      },
      (e: unknown) => {
        if (cancelled) return;
        const error = e instanceof ApiError ? e : unknownError();
        // 404: deleted, or another account's chat (the API never says which).
        if (error.status === 404 || error.status === 422) {
          setLoad("not_found");
        } else {
          setLoadError(error);
          setLoad("error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [savedId, attempt]);

  const retryLoad = () => {
    setLoadError(undefined);
    setLoad("loading");
    setAttempt((n) => n + 1);
  };

  // ---------- Turns ----------

  const patchTurn = useCallback((id: string, patch: Partial<AskTurn>) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /** Put a question back in the composer unless the user has typed something new since. */
  const restoreDraft = (text: string) => setDraft((d) => (d.trim() ? d : text));

  const focusComposer = () =>
    requestAnimationFrame(() => {
      if (window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
    });

  const say = (text: string, forDraft: string) => {
    setNotice({ text, draft: forDraft.trim() });
    live.current.workspace.announce(text);
  };

  /** Chips are staged for the next question; once it goes out, the ready ones have been used.
   *  A failed or rejected chip stays: it is where the user sees and recovers from the problem. */
  const consumeChips = () => {
    const u = live.current.uploads;
    for (const row of u.items) {
      if (TERMINAL_PHASES.has(row.phase) && row.phase !== "failed" && row.phase !== "rejected") u.remove(row.key);
    }
  };

  /** The URL names the chat once it exists, so a reload or "Sign in again" comes back to it (§4.2). */
  const adoptUrl = (sid: string) => {
    const path = `/ask/c/${sid}`;
    if (window.location.pathname === path) return;
    live.current.onAdopt(sid);
    window.history.replaceState(null, "", path);
  };

  const dispatch = async (turnId: string, req: TurnRequest) => {
    if (controllers.current.has(turnId)) return;
    const controller = new AbortController();
    controllers.current.set(turnId, controller);
    consumeChips();
    setNotice(null);
    patchTurn(turnId, { status: "waiting", startedAt: Date.now(), error: undefined, heldFor: undefined, retryAt: undefined, req });
    let signedOut = false;
    try {
      const ids = live.current.data.collectionIdsFor(req.scope);
      if (!ids.length) throw new AskError(500, "NOTHING_TO_SEARCH", "There is nothing to search yet.", null);
      let sid = sessionRef.current;
      if (!sid) {
        // §5.8: the session is created on first send, never on page load.
        const session = await createSession(ids, req.text.slice(0, TITLE_CHARS), controller.signal);
        sid = session.id;
        sessionRef.current = sid;
        unconfirmedTitle.current = session.title;
        setSessionId(sid);
        live.current.workspace.addOptimisticSession(session);
      }
      const res = await askQuestion(sid, req.text, ids, controller.signal);
      if (!alive.current) return;
      const answer = answerFromResponse(res);
      const now = live.current;
      const hadCitations = now.turns.some((t) => t.id !== turnId && (t.answer?.citations.length ?? 0) > 0);
      const searched = now.data.collections.length ? scopeLabel(now.data.collections, req.scope) : "";
      patchTurn(turnId, {
        status: "answered",
        answer,
        error: undefined,
        scopeLabel: [req.note, searched].filter(Boolean).join(" ") || undefined,
        searchedNarrowed: req.scope !== "all" && now.data.collections.some((c) => !req.scope.includes(c.id)),
      });
      adoptUrl(sid);
      // A stopped or failed question named the chat, then a different one got the first answer.
      const named = unconfirmedTitle.current;
      unconfirmedTitle.current = null;
      const title = req.text.slice(0, TITLE_CHARS);
      if (named !== null && named !== title) {
        setSessionTitle(title);
        void renameSession(sid, title)
          .catch(() => undefined)
          .finally(() => live.current.workspace.sessions.reload());
      }
      clearDraft();
      now.onAnswer(answer, hadCitations);
    } catch (e) {
      if (!alive.current) return;
      if (controller.signal.aborted) {
        if (sessionRef.current) adoptUrl(sessionRef.current);
        return;
      }
      const error = e instanceof ApiError ? e : unknownError();
      // §5.6: "Your session ended." The question survives the sign-in round trip.
      if (error.status === 401) {
        saveDraft(req.text);
        signedOut = true;
      }
      if (error.code === "COLLECTION_NOT_FOUND") live.current.data.reloadCollections();
      if (sessionRef.current) adoptUrl(sessionRef.current);
      const wait = retryWaitMs(error);
      patchTurn(turnId, {
        status: "error",
        error,
        scopeLabel: req.note,
        retryAt: wait ? Date.now() + wait : undefined,
      });
      restoreDraft(req.text);
    } finally {
      controllers.current.delete(turnId);
      // §5.10: every way out reconciles the optimistic row, including Stop and leaving mid-request.
      // Not when signed out: that reload would answer 401 and take the user away from the card.
      if (sessionRef.current && !signedOut && !live.current.data.sessionError) {
        live.current.workspace.sessions.reload();
      }
    }
  };

  /** Try again: the same text and scope (history turns use the current scope). */
  const retry = (turnId: string) => {
    const L = live.current;
    if (L.turns.some(isActive) || controllers.current.size > 0) {
      say(STILL_BUSY, L.draft);
      return;
    }
    const t = L.turns.find((x) => x.id === turnId);
    if (!t) return;
    if (isCountingDown(t)) {
      say(RATE_WAIT, L.draft);
      return;
    }
    const req: TurnRequest = {
      text: t.req?.text ?? t.question,
      scope: t.req?.scope ?? L.scope,
      waitKeys: [],
      waitDocs: [],
      note: t.req?.note,
    };
    // The failed question was put back in the composer; it is being sent again instead.
    setDraft((d) => (d.trim() === req.text ? "" : d));
    void dispatch(turnId, req);
  };

  /** Composer Send, suggestion chips, the landing hand-off and "Search all documents". */
  const send = (raw: string, opts: { scope?: ScopeValue } = {}) => {
    const text = raw.trim();
    const L = live.current;
    if (!text || L.turns.some(isActive) || controllers.current.size > 0) return;
    if (text.length > MAX_MESSAGE_CHARS) {
      setDraft(text);
      say(TOO_LONG, text);
      return;
    }
    const waitKeys = L.uploads.items.filter((u) => isHoldPhase(u.phase)).map((u) => u.key);
    const nothingReady = L.data.readyCount === 0;
    const waitDocs = nothingReady && waitKeys.length === 0 ? L.data.readingDocs.map((d) => d.id) : [];
    if (nothingReady && waitKeys.length === 0 && waitDocs.length === 0) {
      // Nothing to search yet (state A): keep the question in the composer (§3.2 ask box).
      setDraft(text);
      say(NOTHING_READY, text);
      return;
    }
    // The question put back after an error is still that question, not a new one: one bubble, one
    // card (§5.6). While its countdown runs it waits, whichever way it is sent.
    const kept = L.turns.findLast((t) => t.status === "error" && (t.req?.text ?? t.question) === text);
    if (kept) {
      retry(kept.id);
      return;
    }
    const req: TurnRequest = { text, scope: opts.scope ?? L.scope, waitKeys, waitDocs };
    const held = waitKeys.length > 0 || waitDocs.length > 0;
    const turn: AskTurn = { id: localId("t"), question: text, status: held ? "held" : "waiting", startedAt: Date.now(), req };
    // Visible to a second send in the same tick, before the layout effect refreshes `live`.
    live.current = { ...L, turns: [...L.turns, turn] };
    setTurns((ts) => [...ts, turn]);
    // A suggestion chip sends something other than the draft: what the user typed stays.
    setDraft((d) => (d.trim() === text ? "" : d));
    if (!held) void dispatch(turn.id, req);
  };

  // Held questions go out once every file they wait for has finished (failed ones are noted).
  const releaseHeld = useEffectEvent(() => {
    const rows = new Map(uploads.items.map((u) => [u.key, u]));
    const docs = new Map(data.docs.map((d) => [d.id, d]));
    for (const t of turns) {
      if (t.status !== "held" || !t.req) continue;
      const { waitKeys, waitDocs } = t.req;
      const reading =
        waitKeys.some((k) => isReadingRow(rows.get(k))) || waitDocs.some((id) => isReadingDoc(docs.get(id)));
      if (reading) continue;
      const failed = [
        ...waitKeys.map((k) => rows.get(k)).filter(isFailedRow).map((r) => shownName(r.filename)),
        ...waitDocs
          .map((id) => docs.get(id))
          .filter((d): d is DocumentItem => d?.status === "failed")
          .map((d) => d.filename),
      ];
      void dispatch(t.id, { ...t.req, note: failed.length ? withoutNote(failed) : undefined });
    }
  });
  useEffect(() => {
    releaseHeld();
  }, [turns, uploads.items, data.docs]);

  const askNow = (turnId: string) => {
    const t = live.current.turns.find((x) => x.id === turnId);
    if (t?.status === "held" && t.req) void dispatch(turnId, t.req);
  };

  const dropTurn = (turnId: string) => {
    const t = live.current.turns.find((x) => x.id === turnId);
    setTurns((ts) => ts.filter((x) => x.id !== turnId));
    if (t) restoreDraft(t.question);
    focusComposer();
  };

  const cancelHeld = (turnId: string) => dropTurn(turnId);

  const stop = (turnId: string) => {
    controllers.current.get(turnId)?.abort();
    controllers.current.delete(turnId);
    dropTurn(turnId);
    live.current.workspace.announce(STOPPED);
  };

  /** Not found → Rephrase: the question goes back into the composer, selected (§5.6). */
  const rephrase = (question: string) => {
    setDraft(question);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  };

  // ---------- Scope (§5.8) ----------

  /** Re-asks the card's question when it is given, else the newest not-found one. A plain click
   *  handler passes its event here, hence the check. */
  const searchAll = (question?: unknown) => {
    setScope("all");
    const text =
      typeof question === "string"
        ? question
        : live.current.turns.findLast((t) => t.answer?.evidence_status === "insufficient")?.question;
    if (text) send(text, { scope: "all" });
  };

  // The polls found the session gone: keep what is typed, whichever way the user leaves (§5.6).
  const sessionEnded = data.sessionError !== undefined;
  useEffect(() => {
    if (sessionEnded && draft.trim()) saveDraft(draft);
  }, [sessionEnded, draft]);

  // Held turns show the files they wait for by their current names (a ?doc= row starts as "Loading…").
  const viewTurns = useMemo<AskTurn[]>(() => {
    if (!turns.some((t) => t.status === "held")) return turns;
    const rows = new Map(uploads.items.map((u) => [u.key, u]));
    const docs = new Map(data.docs.map((d) => [d.id, d]));
    return turns.map((t) => {
      if (t.status !== "held" || !t.req) return t;
      const names = [
        ...t.req.waitKeys.map((k) => rows.get(k)).filter(isReadingRow).map((r) => r.filename),
        ...t.req.waitDocs.map((id) => docs.get(id)).filter(isReadingDoc).map((d) => d.filename),
      ].filter((n) => n !== LOADING_FILENAME);
      return { ...t, heldFor: names };
    });
  }, [turns, uploads.items, data.docs]);

  return {
    load,
    loadError,
    retryLoad,
    sessionId,
    sessionTitle,
    turns: viewTurns,
    busy: turns.some(isActive),
    draft,
    setDraft,
    notice: notice && notice.draft === draft.trim() ? notice.text : null,
    scope,
    setScope,
    send,
    retry,
    rephrase,
    askNow,
    cancelHeld,
    stop,
    searchAll,
  };
}
