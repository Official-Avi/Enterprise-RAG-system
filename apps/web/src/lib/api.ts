// Typed client for the RackFlow API. All calls are same-origin (/api/v1, proxied by Next.js);
// the HttpOnly session cookie authenticates, and writes carry the CSRF header.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId: string | null,
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { json, headers, ...rest } = options;
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
    throw new ApiError(0, "NETWORK_ERROR", "The server could not be reached.", null);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
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
    );
  }
  return data as T;
}

/** Multipart upload with progress (fetch has no upload progress events). */
export function uploadFiles<T>(
  path: string,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    xhr.open("POST", `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-RackFlow-CSRF", "1");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "The upload failed.", null));
    xhr.onload = () => {
      let data: { error?: { code?: string; message?: string; correlation_id?: string } } | null =
        null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else
        reject(
          new ApiError(
            xhr.status,
            data?.error?.code ?? "HTTP_ERROR",
            data?.error?.message ?? "The upload failed.",
            data?.error?.correlation_id ?? null,
          ),
        );
    };
    xhr.send(form);
  });
}

export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong.";
}
