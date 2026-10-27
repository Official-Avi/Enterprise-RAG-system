"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Me } from "./types";

interface ApiState<T> {
  data?: T;
  error?: ApiError;
  loading: boolean;
  updatedAt?: number;
}

/** Fetch `path` (null = skip). `pollMs` may depend on the latest data (null = stop polling). */
export function useApi<T>(
  path: string | null,
  pollMs?: number | ((data: T) => number | null),
) {
  const [state, setState] = useState<ApiState<T>>({ loading: path !== null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const data = await api<T>(path);
        if (cancelled) return;
        setState({ data, loading: false, updatedAt: Date.now() });
        const next = typeof pollMs === "function" ? pollMs(data) : pollMs;
        if (next) timer = setTimeout(() => setTick((t) => t + 1), next);
      } catch (e) {
        if (cancelled) return;
        setState((s) => ({ ...s, error: e as ApiError, loading: false }));
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // pollMs is intentionally read fresh on each run without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
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
