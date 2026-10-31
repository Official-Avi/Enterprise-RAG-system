// Pure helpers for the /ask orchestrator (Docs/UI_DESIGN_SPEC.md §5).

import { ApiError } from "@/lib/api";
import { TERMINAL_PHASES, type UploadPhase } from "@/lib/status";
import type { AnswerResponse, ChatMessage, ChatSession, DocumentItem, ModelRef } from "@/lib/types";
import type { AnswerMode, AnswerView, ScopeValue, Turn } from "../types";

export interface SessionDetail {
  session: ChatSession;
  messages: ChatMessage[];
}

export const APP_NAME = "RackFlow AI";
export const MAX_SCOPE = 50;
export const DRAFT_KEY = "rf.draft";
/** AskIn.message max_length in routers/chat.py. */
export const MAX_MESSAGE_CHARS = 4000;
/** The backend titles a chat with the first 80 characters of its first question. */
export const TITLE_CHARS = 80;
/** The title a session has until its first answered question renames it. */
const UNTITLED = "New conversation";

/** document.title per §9 #17. */
export function pageTitle(chat: string | null): string {
  return chat ? `${chat} · ${APP_NAME}` : `Ask · ${APP_NAME}`;
}

/** The session's title, or the first question while the backend still says "New conversation". */
export function chatTitle(sessionTitle: string | null, turns: Turn[]): string | null {
  const title = sessionTitle?.trim();
  if (title && title !== UNTITLED) return title;
  const first = turns[0]?.question.trim();
  return first ? first.slice(0, TITLE_CHARS) : null;
}

export function modeOf(model: ModelRef | null | undefined): AnswerMode | null {
  if (!model) return null;
  return model.provider === "extractive" ? "extractive" : "llm";
}
const scopeKey = (sessionId: string) => `rf.scope.${sessionId}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AskRoute = { kind: "new" } | { kind: "saved"; id: string } | { kind: "invalid" };

/** The pathname is the source of truth: useParams keeps the old segment after replaceState. */
export function routeFromPath(pathname: string): AskRoute {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "ask") return { kind: "invalid" };
  if (parts.length === 1) return { kind: "new" };
  if (parts.length === 3 && parts[1] === "c") {
    let id = parts[2];
    try {
      id = decodeURIComponent(id);
    } catch {
      return { kind: "invalid" };
    }
    return UUID_RE.test(id) ? { kind: "saved", id } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}

let seq = 0;
/** Local ids for turns and system rows (crypto.randomUUID needs a secure context). */
export function localId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function answerFromResponse(res: AnswerResponse): AnswerView {
  return {
    id: res.message_id,
    text: res.answer,
    evidence_status: res.evidence_status,
    citations: res.citations,
    model: res.model,
    latency_ms: res.latency_ms,
    retrieved_count: res.retrieved_count,
  };
}

// Not status 0: AnswerErrorCard reads 0 as "Can't reach RackFlow"; this is "went wrong on our side".
const MISSING_ANSWER = new ApiError(500, "MISSING_ANSWER", "This question has no saved answer.", null);

/** Rebuild turns from saved messages: each user message is answered by the next assistant one. */
export function turnsFromMessages(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let open: Turn | null = null;
  for (const m of messages) {
    const at = Date.parse(m.created_at) || 0;
    if (m.role === "user") {
      if (open) turns.push({ ...open, status: "error", error: MISSING_ANSWER });
      open = { id: `h-${m.id}`, question: m.content, status: "answered", startedAt: at };
      continue;
    }
    const answer: AnswerView = {
      id: m.id,
      text: m.content,
      evidence_status: m.evidence_status ?? "insufficient",
      citations: m.citations,
      model: m.model,
      latency_ms: m.latency_ms,
      retrieved_count: null,
    };
    if (open) {
      turns.push({ ...open, answer });
      open = null;
    }
  }
  if (open) turns.push({ ...open, status: "error", error: MISSING_ANSWER });
  return turns;
}

/** Phases a held question waits for. "deleting" never resolves into an answerable file. */
export function isHoldPhase(phase: UploadPhase): boolean {
  return !TERMINAL_PHASES.has(phase) && phase !== "deleting";
}

export function isPendingDoc(d: DocumentItem): boolean {
  return d.status === "queued" || d.status === "processing";
}

/** "a.pdf", "a.pdf and b.docx", "a.pdf, b.docx and 2 more". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export function withoutNote(failed: string[]): string {
  return failed.length === 1
    ? `Answered without ${failed[0]} (couldn't read it).`
    : `Answered without ${joinNames(failed)} (couldn't read them).`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readScope(sessionId: string | null): ScopeValue | null {
  if (!sessionId) return null;
  try {
    const raw = storage()?.getItem(scopeKey(sessionId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value === "all") return "all";
    if (Array.isArray(value) && value.length && value.every((v) => typeof v === "string")) return value;
  } catch {
    // A corrupt entry just means the chat starts on All documents.
  }
  return null;
}

/** Narrowing is per chat and per tab (§5.8); "all" is the default, so it isn't stored. */
export function writeScope(sessionId: string, value: ScopeValue | null) {
  try {
    const s = storage();
    if (!s) return;
    if (value === null || value === "all") s.removeItem(scopeKey(sessionId));
    else s.setItem(scopeKey(sessionId), JSON.stringify(value));
  } catch {
    // Storage full or blocked: narrowing still works for this page view.
  }
}

export function readDraft(): string {
  try {
    return storage()?.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(text: string) {
  try {
    storage()?.setItem(DRAFT_KEY, text);
  } catch {
    // Nothing else to do: the question is still visible in the thread.
  }
}

export function clearDraft() {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
