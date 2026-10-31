// Chat calls for the /ask orchestrator (backend/src/rackflow/api/routers/chat.py).
//
// Writes go through postJson instead of lib/api's api(): the page needs the 429 Retry-After
// header (api() drops headers) and handles a 401 itself, keeping the question and saving the
// draft, instead of api()'s immediate redirect to /login (§5.6 Error).

import { api, ApiError } from "@/lib/api";
import type { AnswerResponse, ChatSession } from "@/lib/types";
import type { SessionDetail } from "./helpers";

/** Waits longer than this are shown as this (a bad header must not lock the button for hours). */
const MAX_RETRY_AFTER_S = 300;

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

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: "POST",
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
    throw new AskError(0, "NETWORK_ERROR", "The server could not be reached.", null);
  }
  const data = await res.json().catch(() => null);
  if (signal?.aborted) throw abortError();
  if (!res.ok) {
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

/** POST /chat/sessions, made lazily on the first send (§5.8). collection_ids: 1..50. */
export function createSession(collectionIds: string[], signal?: AbortSignal): Promise<ChatSession> {
  return postJson<ChatSession>("/chat/sessions", { collection_ids: collectionIds }, signal);
}

/** POST /chat/sessions/{id}/messages with the per-message scope override (§5.8). */
export function askQuestion(
  sessionId: string,
  message: string,
  collectionIds: string[],
  signal?: AbortSignal,
): Promise<AnswerResponse> {
  return postJson<AnswerResponse>(
    `/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    { message, collection_ids: collectionIds },
    signal,
  );
}

/** GET /chat/sessions/{id}: the session and its messages, oldest first. 404 = not this user's. */
export function loadSession(sessionId: string): Promise<SessionDetail> {
  return api<SessionDetail>(`/chat/sessions/${encodeURIComponent(sessionId)}`);
}
