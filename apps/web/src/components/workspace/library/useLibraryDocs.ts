"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/api";
import { phaseFromDocument, TERMINAL_PHASES } from "@/lib/status";
import type { DocumentItem, Page } from "@/lib/types";

// §5.5 cadence: 1, 1.5, 2.3, 3.4, 5.1, 7.6s, then 8s.
const BACKOFF_MS = [1000, 1500, 2300, 3400, 5100, 7600];
const MAX_BACKOFF_MS = 8000;
const FLASH_MS = 1300;

export const docPhase = (d: DocumentItem) => phaseFromDocument(d.status, d.latest_job?.status);
const settled = (d: DocumentItem) => TERMINAL_PHASES.has(docPhase(d));

interface State {
  /** The path the current items belong to (null until the first response). */
  path: string | null;
  items: DocumentItem[];
  truncated: boolean;
  error?: ApiError;
  updatedAt?: number;
}

/** GET /documents with §5.5 polling: back off while any row isn't terminal, stop when all are,
 *  pause while the tab is hidden, and start over on focus, on `kick` change or on refresh(). */
export function useLibraryDocs(
  path: string | null,
  kick: string,
  onBecameReady: (docs: DocumentItem[]) => void,
) {
  const [state, setState] = useState<State>({ path: null, items: [], truncated: false });
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(() => new Set());
  const [tick, setTick] = useState(0);
  // Last status seen per id, across filter changes, so only real transitions flash.
  const seen = useRef(new Map<string, string>());
  const becameReady = useEffectEvent((docs: DocumentItem[]) => onBecameReady(docs));

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    let timer: number | undefined;
    let step = 0;
    let inFlight = false;
    let lastRun = 0;

    const later = (ms: number) => {
      timer = window.setTimeout(() => {
        // Paused while hidden; `wake` resumes on return.
        if (document.visibilityState !== "hidden") void run();
      }, ms);
    };

    const run = async () => {
      if (inFlight) return;
      window.clearTimeout(timer);
      inFlight = true;
      lastRun = Date.now();
      try {
        const page = await api<Page<DocumentItem>>(path);
        if (cancelled) return;
        const ready: DocumentItem[] = [];
        for (const d of page.items) {
          const before = seen.current.get(d.id);
          if (before !== undefined && before !== "indexed" && d.status === "indexed") ready.push(d);
          seen.current.set(d.id, d.status);
        }
        setState({ path, items: page.items, truncated: page.next_cursor !== null, updatedAt: Date.now() });
        if (ready.length) {
          const ids = ready.map((d) => d.id);
          setFlashing((prev) => new Set([...prev, ...ids]));
          window.setTimeout(() => {
            setFlashing((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
          }, FLASH_MS);
          becameReady(ready);
        }
        if (page.items.every(settled)) step = 0;
        else later(BACKOFF_MS[step++] ?? MAX_BACKOFF_MS);
      } catch (e) {
        if (cancelled) return;
        const err = e as ApiError;
        // Never show another filter's rows as if they answered this one.
        setState((s) => (s.path === path ? { ...s, error: err } : { path, items: [], truncated: false, error: err }));
        // Keep trying through network blips and server errors; 4xx won't fix itself.
        if (err.status === 0 || err.status >= 500) later(MAX_BACKOFF_MS);
      } finally {
        inFlight = false;
      }
    };

    const wake = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRun < 1000) return;
      step = 0;
      void run();
    };

    void run();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [path, kick, tick]);

  return {
    items: state.items,
    truncated: state.truncated,
    error: state.error,
    updatedAt: state.updatedAt,
    /** The path the shown items belong to (null until the first response). */
    shownPath: state.path,
    /** True once any response (or error) has arrived. */
    loaded: state.path !== null,
    /** True while the shown items belong to an older path (filters just changed). */
    stale: state.path !== path,
    flashing,
    /** Optimistic local change until the next poll confirms it. */
    patch(id: string, change: Partial<DocumentItem>) {
      setState((s) => ({ ...s, items: s.items.map((d) => (d.id === id ? { ...d, ...change } : d)) }));
    },
    /** Fetch now and restart the backoff. */
    refresh() {
      setTick((t) => t + 1);
    },
  };
}
