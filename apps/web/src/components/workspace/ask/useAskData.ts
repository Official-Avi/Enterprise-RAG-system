"use client";

import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import type { ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { TERMINAL_PHASES } from "@/lib/status";
import type { Collection, DocumentItem, ModelInfo, Page } from "@/lib/types";
import type { AnswerMode, ScopeCollection, ScopeValue, TrackedUpload, UploadsApi } from "../types";
import { isHoldPhase, isPendingDoc, MAX_SCOPE } from "./helpers";

// §5.8: counts include only indexed documents, computed client-side from GET /documents.
const DOCS_PATH = "/documents?limit=200";
const COLLECTIONS_PATH = "/collections?limit=500";
const MODELS_PATH = "/models";
/** Fast while something is being read (state C turns into B on its own), slow otherwise. */
const READING_POLL_MS = 3_000;
const IDLE_POLL_MS = 60_000;
/** Upload rows the documents list doesn't have yet are counted under this bucket. */
const UNLISTED = "";

type Kind = "ready" | "pending" | "other";

export interface ScopeStats {
  ready: number;
  pending: number;
}

export interface AskData {
  /** The first documents or collections response hasn't arrived yet. */
  loading: boolean;
  /** The first load failed, so there is nothing to count. */
  error: ApiError | undefined;
  retry(): void;
  /** Documents in collections this user can ask about, newest first. */
  docs: DocumentItem[];
  /** Scope picker rows: readable collections (the 50 most recent), by name. */
  collections: ScopeCollection[];
  readyCount: number;
  pendingCount: number;
  /** Documents being read, for state C's rows. */
  readingDocs: DocumentItem[];
  /** From GET /models until an answer says which model replied. */
  defaultMode: AnswerMode;
  /** The ids a request sends: "all" = every collection in the picker (plus My documents). */
  collectionIdsFor(scope: ScopeValue): string[];
  statsFor(scope: ScopeValue): ScopeStats;
  docsIn(scope: ScopeValue): DocumentItem[];
  reloadCollections(): void;
}

function byRecency(a: Collection, b: Collection): number {
  return (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
}

function rowKind(u: TrackedUpload): Kind {
  if (u.phase === "indexed" || u.phase === "duplicate") return "ready";
  return isHoldPhase(u.phase) ? "pending" : "other";
}

function docKind(d: DocumentItem): Kind {
  if (d.status === "indexed") return "ready";
  return isPendingDoc(d) ? "pending" : "other";
}

export function useAskData({
  enabled,
  canRead,
  canModel,
  uploads,
}: {
  enabled: boolean;
  canRead: boolean;
  canModel: boolean;
  uploads: UploadsApi;
}): AskData {
  const on = enabled && canRead;
  const docsQ = useApi<Page<DocumentItem>>(on ? DOCS_PATH : null, (page) =>
    page.items.some(isPendingDoc) ? READING_POLL_MS : IDLE_POLL_MS,
  );
  const collectionsQ = useApi<Collection[]>(on ? COLLECTIONS_PATH : null);
  const modelsQ = useApi<{ items: ModelInfo[] }>(enabled && canModel ? MODELS_PATH : null);

  const reloadDocs = useEffectEvent(() => docsQ.reload());
  const reloadCollectionsNow = useEffectEvent(() => collectionsQ.reload());

  // An upload got its document id or finished: refetch so counts and state C/B follow.
  const uploadSig = uploads.items
    .map((u) => `${u.documentId ?? u.key}:${TERMINAL_PHASES.has(u.phase) ? 1 : 0}`)
    .join("|");
  const lastSig = useRef(uploadSig);
  useEffect(() => {
    if (lastSig.current === uploadSig) return;
    lastSig.current = uploadSig;
    if (on) reloadDocs();
  }, [on, uploadSig]);

  // "My documents" was just created by the first upload: the collections list predates it.
  const myId = uploads.myCollection?.id ?? null;
  const collectionsLoaded = collectionsQ.data !== undefined;
  const myListed = myId !== null && (collectionsQ.data?.some((c) => c.id === myId) ?? false);
  useEffect(() => {
    if (on && myId && collectionsLoaded && !myListed) reloadCollectionsNow();
  }, [on, myId, collectionsLoaded, myListed]);

  const derived = useMemo(() => {
    const my = uploads.myCollection;
    const readable = (collectionsQ.data ?? []).filter((c) => c.access_level !== null);
    if (my && !readable.some((c) => c.id === my.id)) readable.push(my);
    const readableIds = new Set(readable.map((c) => c.id));

    // §5.8: every new chat searches the 50 most recent readable collections, always with My documents.
    let recent = [...readable].sort(byRecency).slice(0, MAX_SCOPE);
    if (my && !recent.some((c) => c.id === my.id)) recent = [...recent.slice(0, MAX_SCOPE - 1), my];
    const recentIds = recent.map((c) => c.id);

    // Upload rows can be newer than the last documents poll; a finished row wins over a stale doc.
    const rowsByDoc = new Map<string, TrackedUpload>();
    for (const u of uploads.items) if (u.documentId) rowsByDoc.set(u.documentId, u);
    const kindOf = (d: DocumentItem): Kind => {
      const row = rowsByDoc.get(d.id);
      return row && TERMINAL_PHASES.has(row.phase) ? rowKind(row) : docKind(d);
    };

    const all = docsQ.data?.items ?? [];
    const docs = collectionsQ.data ? all.filter((d) => readableIds.has(d.collection_id)) : all;
    const counts = new Map<string, ScopeStats>();
    const bump = (collectionId: string, kind: Kind) => {
      if (kind === "other") return;
      const c = counts.get(collectionId) ?? { ready: 0, pending: 0 };
      c[kind] += 1;
      counts.set(collectionId, c);
    };
    for (const d of docs) bump(d.collection_id, kindOf(d));
    // Just uploaded (no id yet, or not in the list yet): it lands in My documents.
    const listed = new Set(all.map((d) => d.id));
    for (const u of uploads.items) {
      if (u.documentId && listed.has(u.documentId)) continue;
      bump(my?.id ?? UNLISTED, rowKind(u));
    }

    const collections: ScopeCollection[] = [...recent]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        name: c.name,
        readyCount: counts.get(c.id)?.ready ?? 0,
        pendingCount: counts.get(c.id)?.pending ?? 0,
      }));

    const idsOf = (scope: ScopeValue): string[] => {
      const chosen = scope === "all" ? recentIds : scope.filter((id) => readableIds.has(id));
      return [...new Set(chosen.length ? chosen : recentIds)].slice(0, MAX_SCOPE);
    };
    const statsFor = (scope: ScopeValue): ScopeStats => {
      const ids = scope === "all" ? [...recentIds, UNLISTED] : scope;
      return ids.reduce(
        (sum, id) => ({ ready: sum.ready + (counts.get(id)?.ready ?? 0), pending: sum.pending + (counts.get(id)?.pending ?? 0) }),
        { ready: 0, pending: 0 },
      );
    };
    const docsIn = (scope: ScopeValue): DocumentItem[] => {
      const ids = new Set(scope === "all" ? recentIds : scope);
      return docs.filter((d) => ids.has(d.collection_id));
    };

    const total = statsFor("all");
    const models = modelsQ.data?.items ?? [];
    const model = models.find((m) => m.is_default) ?? models[0];

    return {
      docs,
      collections,
      readyCount: total.ready,
      pendingCount: total.pending,
      readingDocs: docs.filter((d) => kindOf(d) === "pending"),
      defaultMode: (model && model.provider !== "extractive" ? "llm" : "extractive") as AnswerMode,
      collectionIdsFor: idsOf,
      statsFor,
      docsIn,
    };
  }, [docsQ.data, collectionsQ.data, modelsQ.data, uploads.items, uploads.myCollection]);

  const loading =
    on && ((docsQ.data === undefined && docsQ.loading) || (collectionsQ.data === undefined && collectionsQ.loading));
  const error = on
    ? ((docsQ.data === undefined ? docsQ.error : undefined) ??
      (collectionsQ.data === undefined ? collectionsQ.error : undefined))
    : undefined;

  return {
    ...derived,
    loading,
    error,
    retry: () => {
      docsQ.reload();
      collectionsQ.reload();
    },
    reloadCollections: collectionsQ.reload,
  };
}
