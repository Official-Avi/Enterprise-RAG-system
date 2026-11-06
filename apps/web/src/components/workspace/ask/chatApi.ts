// Chat calls for the /ask orchestrator (backend/src/rackflow/api/routers/chat.py).
//
// Writes go through postJson instead of lib/api's api(): the page needs the 429 Retry-After
// header (api() drops headers) and handles a 401 itself, keeping the question and saving the
// draft, instead of api()'s immediate redirect to /login (§5.6 Error).

import { api, ApiError, NETWORK_ERROR_COPY } from "@/lib/api";
import type { AnswerResponse, ChatSession } from "@/lib/types";
import type { SessionDetail } from "./helpers";

/** Waits longer than this are shown as this (a bad header must not lock the button for hours). */
const MAX_RETRY_AFTER_S = 300;
/** AnswerErrorCard's countdown when a 429 carries no Retry-After (§5.6). */
const FALLBACK_RETRY_AFTER_S = 15;

/** ApiError plus the wait a 429 asked for. AnswerErrorCard reads `retryAfter` for its countdown
 *  and falls back to 15s when it is null. */
export class AskError extends ApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    correlationId: string | null,
    public readonly retryAfter: number | null = null,
  ) {
    super(status, code, message, correlationId);
  }
}

/** Retry-After is delta-seconds or an HTTP date. */
function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const wait = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1000;
  if (!Number.isFinite(wait) || wait <= 0) return null;
  return Math.min(Math.ceil(wait), MAX_RETRY_AFTER_S);
}

function abortError(): DOMException {
  return new DOMException("The request was stopped.", "AbortError");
}

/** How long a rate-limited question must wait before it may go out again; 0 for other errors. */
export function retryWaitMs(error: ApiError): number {
  if (error.status !== 429 && error.code !== "RATE_LIMITED") return 0;
  const seconds = error instanceof AskError ? error.retryAfter : null;
  return (seconds ?? FALLBACK_RETRY_AFTER_S) * 1000;
}

async function sendJson<T>(method: "POST" | "PATCH", path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-RackFlow-CSRF": "1",
      },
      credentials: "same-origin",
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AskError(0, "NETWORK_ERROR", NETWORK_ERROR_COPY, null);
  }
  const data = await res.json().catch(() => null);
  if (signal?.aborted) throw abortError();
  if (!res.ok) {
    // The API's own 5xx responses carry the JSON envelope. An unreadable one is the web proxy saying
    // the API is down, which is the "Can't reach RackFlow." card, not a server fault (§5.6).
    if (res.status >= 500 && data === null) throw new AskError(0, "NETWORK_ERROR", NETWORK_ERROR_COPY, null);
    const err = data?.error ?? {};
    throw new AskError(
      res.status,
      err.code ?? "HTTP_ERROR",
      err.message ?? "The request failed.",
      err.correlation_id ?? null,
      res.status === 429 ? retryAfterSeconds(res.headers.get("Retry-After")) : null,
    );
  }
  if (data === null) throw new AskError(500, "BAD_RESPONSE", "The server sent an unreadable answer.", null);
  return data as T;
}

/** POST /chat/sessions, made lazily on the first send (§5.8). collection_ids: 1..50.
 *  Titled from the start, so a chat whose first question never got answered still has its name. */
export function createSession(collectionIds: string[], title: string, signal?: AbortSignal): Promise<ChatSession> {
  return sendJson<ChatSession>("POST", "/chat/sessions", { title, collection_ids: collectionIds }, signal);
}

/** PATCH /chat/sessions/{id}: the first answered question differs from the one that named the chat. */
export function renameSession(sessionId: string, title: string): Promise<ChatSession> {
  return sendJson<ChatSession>("PATCH", `/chat/sessions/${encodeURIComponent(sessionId)}`, { title });
}

/** POST /chat/sessions/{id}/messages with the per-message scope override (§5.8). */
export function askQuestion(
  sessionId: string,
  message: string,
  collectionIds: string[],
  signal?: AbortSignal,
): Promise<AnswerResponse> {
  return sendJson<AnswerResponse>(
    "POST",
    `/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    { message, collection_ids: collectionIds },
    signal,
  );
}

/** GET /chat/sessions/{id}: the session and its messages, oldest first. 404 = not this user's.
 *  A 401 shows the page's "Your session ended." card rather than redirecting (§5.6). */
export function loadSession(sessionId: string): Promise<SessionDetail> {
  return api<SessionDetail>(`/chat/sessions/${encodeURIComponent(sessionId)}`, { noAuthRedirect: true });
}
