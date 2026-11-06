// Typed client for the RackFlow API. All calls are same-origin (/api/v1, proxied by Next.js);
// the HttpOnly session cookie authenticates, and writes carry the CSRF header.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId: string | null,
    /** Whole seconds from a 429's Retry-After header; null when the server sent none. */
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/** Retry-After is either delta-seconds or an HTTP date. */
function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** §3.2 api_down. Shown whenever the API can't be reached, including through the Next proxy. */
export const NETWORK_ERROR_COPY = "Can't reach RackFlow. Check that the server is running.";
/** §3.2 upload_failed: the connection dropped while the file was being sent. */
export const UPLOAD_INTERRUPTED_COPY = "Upload interrupted.";

/** The /api proxy buffers at most this much of a request body (proxyClientMaxBodySize in
 *  next.config.ts). A larger body reaches the API cut short, and the API then waits for bytes that
 *  never come until the proxy times out. Keep the two values in step. */
export const PROXY_BODY_LIMIT_BYTES = 26 * 1024 * 1024;
/** Generous room for one multipart part's boundary and headers. */
const MULTIPART_OVERHEAD_BYTES = 1024;

const networkError = (message = NETWORK_ERROR_COPY) => new ApiError(0, "NETWORK_ERROR", message, null);
const abortedError = () => new ApiError(0, "ABORTED", "The request was cancelled.", null);

/** The caller's AbortSignal ended the request. Treat as a choice, not as a failure to report. */
export function isAbortError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "ABORTED";
}

/** The API couldn't be reached: no response at all, or the Next proxy answering for a dead API. */
export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "NETWORK_ERROR";
}

/** The API always sends 5xx as its JSON error envelope (backend core/errors.py), so a 5xx with an
 *  unparseable body came from something in front of it. The Next proxy answers a plain-text
 *  "Internal Server Error" when the API is down. */
const isProxyFailure = (status: number, data: unknown) => status >= 500 && data === null;

type Options = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit;
  /** Public pages set this so a 401 is returned to the caller instead of redirecting. */
  noAuthRedirect?: boolean;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { json, headers, noAuthRedirect, ...rest } = options;
  const method = (rest.method ?? "GET").toUpperCase();
  const h = new Headers(headers);
  h.set("Accept", "application/json");
  if (json !== undefined) h.set("Content-Type", "application/json");
  if (!["GET", "HEAD"].includes(method)) h.set("X-RackFlow-CSRF", "1");

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...rest,
      method,
      headers: h,
      credentials: "same-origin",
      body: json !== undefined ? JSON.stringify(json) : rest.body ?? options.body,
    });
  } catch {
    throw rest.signal?.aborted ? abortedError() : networkError();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (rest.signal?.aborted) throw abortedError();
  if (isProxyFailure(res.status, data)) throw networkError();
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401 && typeof window !== "undefined" && !noAuthRedirect && !path.startsWith("/auth/login")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // Full reload on purpose: auth was lost, so discard all client-side state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${next}`);
    }
    throw new ApiError(
      res.status,
      err.code ?? "HTTP_ERROR",
      err.message ?? "The request failed.",
      err.correlation_id ?? null,
      retryAfterSeconds(res.headers.get("Retry-After")),
    );
  }
  return data as T;
}

/** Multipart upload with progress (fetch has no upload progress events). One call is one request,
 *  so a batch must fit PROXY_BODY_LIMIT_BYTES: use uploadInGroups in lib/workspace for any batch
 *  that may not. Aborting `signal` cancels the XHR and rejects with an isAbortError error. */
export function uploadFiles<T>(
  path: string,
  files: File[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const bodyBytes = files.reduce((n, f) => n + f.size + MULTIPART_OVERHEAD_BYTES, 0);
    if (bodyBytes > PROXY_BODY_LIMIT_BYTES) {
      // Failing here beats a truncated body hanging until the proxy gives up.
      reject(
        new ApiError(413, "REQUEST_TOO_LARGE", "These files are too large to send together. Add them in smaller batches.", null),
      );
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.onabort = () => reject(abortedError());
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    xhr.open("POST", `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-RackFlow-CSRF", "1");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onerror = () => reject(networkError(UPLOAD_INTERRUPTED_COPY));
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string; correlation_id?: string } } | null =
        null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else if (isProxyFailure(xhr.status, data)) reject(networkError());
      else
        reject(
          new ApiError(
            xhr.status,
            data?.error?.code ?? "HTTP_ERROR",
            data?.error?.message ?? "The upload failed.",
            data?.error?.correlation_id ?? null,
            retryAfterSeconds(xhr.getResponseHeader("Retry-After")),
          ),
        );
    };
    xhr.send(form);
  });
}

export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong.";
}
