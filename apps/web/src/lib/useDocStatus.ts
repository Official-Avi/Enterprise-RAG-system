"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { phaseFromDocument, TERMINAL_PHASES } from "./status";
import type { DocumentItem, Page } from "./types";

/** §5.5 poll delays: 1, 1.5, 2.3, 3.4, 5.1, 7.6s, then 8s. */
export const POLL_BACKOFF_MS = [1000, 1500, 2300, 3400, 5100, 7600, 8000] as const;

const REFRESH_EVENT = "rackflow:doc-status-refresh";

/** Make every useDocStatus poller check again now, even if all its documents had settled
 *  (call after POST /documents/{id}/retry). */
export function refreshDocStatus(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function isDocTerminal(doc: DocumentItem): boolean {
  return TERMINAL_PHASES.has(phaseFromDocument(doc.status, doc.latest_job?.status));
}

export interface DocStatusUpdate {
  /** Latest data for every watched id the API returned. */
  docs: Map<string, DocumentItem>;
  /** Watched ids the API no longer returns (deleted, or not visible to this user). */
  gone: Set<string>;
}

export interface DocStatusOptions {
  /** Called after every poll tick that fetched data. */
  onUpdate?: (update: DocStatusUpdate) => void;
}

const GONE_STATUSES = new Set([403, 404, 422]);

/** Batched polling of watched document ids with backoff 1,1.5,2.3,3.4,5.1,7.6s then 8s; pauses
 *  while the tab is hidden; stops when all are terminal (§5.5). */
export function useDocStatus(
  ids: string[],
  collectionId: string | null,
  options: DocStatusOptions = {},
): Map<string, DocumentItem> {
  const [docs, setDocs] = useState<Map<string, DocumentItem>>(() => new Map());
  // Survives id-set changes so settled documents aren't fetched again one by one.
  const cache = useRef(new Map<string, DocumentItem>());
  const goneIds = useRef(new Set<string>());
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const emit = useEffectEvent((update: DocStatusUpdate) => options.onUpdate?.(update));

  useEffect(() => {
    if (!key) return;
    const watched = key.split(",");
    const watchedSet = new Set(watched);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let forceAfter = false; // a refresh arrived mid-request; its answer may predate the change
    let step = 0;
    let lastTick = 0;

    const settled = (id: string) => {
      if (goneIds.current.has(id)) return true;
      const doc = cache.current.get(id);
      return doc ? isDocTerminal(doc) : false;
    };

    const schedule = (ms: number, force = false) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(force), ms);
    };

    const publish = () => {
      const current = new Map<string, DocumentItem>();
      const gone = new Set<string>();
      for (const id of watched) {
        const doc = cache.current.get(id);
        if (doc) current.set(id, doc);
        if (goneIds.current.has(id)) gone.add(id);
      }
      setDocs(current);
      emit({ docs: current, gone });
    };

    const fetchOne = async (id: string) => {
      try {
        cache.current.set(id, await api<DocumentItem>(`/documents/${encodeURIComponent(id)}`));
        goneIds.current.delete(id);
      } catch (e) {
        if (e instanceof ApiError && GONE_STATUSES.has(e.status)) {
          cache.current.delete(id);
          goneIds.current.add(id);
        }
      }
    };

    const tick = async (force: boolean) => {
      timer = undefined;
      if (cancelled || document.hidden) return; // paused; visibility resumes it
      const targets = force ? watched : watched.filter((id) => !settled(id));
      if (!targets.length) return;
      inFlight = true;
      lastTick = Date.now();
      try {
        const found = new Set<string>();
        let batchOk = true;
        if (collectionId) {
          try {
            const page = await api<Page<DocumentItem>>(
              `/documents?collection_id=${encodeURIComponent(collectionId)}&limit=200`,
            );
            for (const doc of page.items) {
              if (!watchedSet.has(doc.id)) continue;
              cache.current.set(doc.id, doc);
              goneIds.current.delete(doc.id);
              found.add(doc.id);
            }
          } catch {
            batchOk = false;
          }
        }
        // Ids outside the batch (another collection, or older than the newest 200) go one by one.
        // After a failed batch, wait for the next tick instead of fanning out.
        if (batchOk) await Promise.all(targets.filter((id) => !found.has(id)).map(fetchOne));
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      publish();
      if (forceAfter) {
        forceAfter = false;
        schedule(0, true);
        return;
      }
      if (watched.every(settled)) return;
      schedule(POLL_BACKOFF_MS[Math.min(step, POLL_BACKOFF_MS.length - 1)]);
      step += 1;
    };

    /** Restart the backoff and poll now (visibility, focus or an explicit refresh). */
    const kick = (force: boolean) => {
      if (cancelled || document.hidden) return;
      step = 0;
      if (inFlight) {
        forceAfter ||= force;
        return;
      }
      if (!force && watched.every(settled)) return;
      // visibilitychange and focus usually fire together; one request is enough.
      if (!force && Date.now() - lastTick < 500) {
        schedule(POLL_BACKOFF_MS[0]);
        step = 1;
        return;
      }
      schedule(0, force);
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = undefined;
      } else kick(false);
    };
    const onFocus = () => kick(false);
    const onRefresh = () => kick(true);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener(REFRESH_EVENT, onRefresh);

    if (watched.every(settled)) {
      // Nothing to fetch, but rows added for already-known ids still need their data.
      timer = setTimeout(publish, 0);
    } else if (watched.some((id) => !cache.current.has(id))) {
      schedule(0);
    } else {
      schedule(POLL_BACKOFF_MS[0]);
      step = 1;
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [key, collectionId]);

  return useMemo(() => {
    if (!key) return new Map();
    const out = new Map<string, DocumentItem>();
    for (const id of key.split(",")) {
      const doc = docs.get(id);
      if (doc) out.set(id, doc);
    }
    return out;
  }, [docs, key]);
}
