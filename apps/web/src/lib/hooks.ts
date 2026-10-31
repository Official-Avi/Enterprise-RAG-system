"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Me } from "./types";

interface ApiState<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
  updatedAt?: number;
}

/** A result is only ever shown for the path it was fetched for. */
type PathState<T> = ApiState<T> & { path: string | null };

/** After a failed poll the interval doubles per consecutive failure, up to this cap. */
const MAX_BACKOFF_MS = 60_000;
/** Retry base when the interval depends on data that has never loaded. */
const FALLBACK_POLL_MS = 5_000;
/** The next poll is scheduled when a request settles, so a hung request would freeze polling. */
const POLL_TIMEOUT_MS = 10_000;

/** Fetch `path` (null = skip). `pollMs` may depend on the latest data (null = stop polling).
 *  A failed poll keeps the previous data, reports `error`, and retries with backoff. */
export function useApi<T>(
  path: string | null,
  pollMs?: number | ((data: T) => number | null),
) {
  const [state, setState] = useState<PathState<T>>({ path, loading: path !== null });
  const [tick, setTick] = useState(0);
  // Consecutive failures and the last good data for `path`; they survive re-runs of the effect.
  const backoff = useRef<{ path: string | null; failures: number; last?: { data: T } }>({
    path,
    failures: 0,
  });

  useEffect(() => {
    if (path === null) return;
    if (backoff.current.path !== path) backoff.current = { path, failures: 0 };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const schedule = (ms: number | null | undefined) => {
      if (ms) timer = setTimeout(() => setTick((t) => t + 1), ms);
    };

    const run = async () => {
      let timedOut = false;
      const timeout = pollMs
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, POLL_TIMEOUT_MS)
        : undefined;
      try {
        const data = await api<T>(path, { signal: controller.signal });
        if (cancelled) return;
        // An abort while the body was being read resolves as null data; it is still a timeout.
        if (timedOut) throw new Error("timeout");
        backoff.current = { path, failures: 0, last: { data } };
        setState({ path, data, loading: false, updatedAt: Date.now() });
        schedule(typeof pollMs === "function" ? pollMs(data) : pollMs);
      } catch (e) {
        if (cancelled) return;
        const error = timedOut
          ? new ApiError(0, "TIMEOUT", "The server took too long to respond.", null)
          : (e as ApiError);
        // Keep the last good data only when it belongs to this path.
        setState((s) => (s.path === path ? { ...s, error, loading: false } : { path, error, loading: false }));
        // BUG-05: keep polling after a failure, backing off so a struggling server isn't hammered.
        const b = backoff.current;
        const base =
          typeof pollMs === "function" ? (b.last ? pollMs(b.last.data) : FALLBACK_POLL_MS) : pollMs;
        if (base) {
          b.failures += 1;
          schedule(Math.min(base * 2 ** b.failures, Math.max(base, MAX_BACKOFF_MS)));
        }
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // pollMs is intentionally read fresh on each run without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  // Stable, so callers can list it in effect dependencies without re-running every render.
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Until the first response for a new path arrives, report loading rather than the previous
  // path's data (a job or rack id change, a filter change, or a path that was null).
  const current: ApiState<T> = state.path === path ? state : { loading: path !== null };
  return {
    data: current.data,
    error: current.error,
    loading: current.loading,
    updatedAt: current.updatedAt,
    reload,
  };
}

export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe used outside the authenticated shell");
  return me;
}

export function useCan(permission: string): boolean {
  return useMe().permissions.includes(permission);
}
