"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { announce } from "@/lib/announce";
import { ApiError, errorText, uploadFiles } from "@/lib/api";
import { MeContext } from "@/lib/hooks";
import { describeStatus, phaseFromDocument, type UploadPhase } from "@/lib/status";
import type { Collection, UploadItem } from "@/lib/types";
import { useDocStatus, type DocStatusUpdate } from "@/lib/useDocStatus";
import {
  ACCEPT_ATTR,
  ensureMyDocuments,
  findMyDocuments,
  LOADING_FILENAME,
  partitionFiles,
  readyMessage,
  requestGroups,
  skippedNote,
} from "@/lib/workspace";
import type { TrackedUpload, UploadsApi } from "./types";
import { UploadsContext } from "./UploadsContext";
import { WorkspaceContext } from "./WorkspaceContext";

const OPERATOR_NOTE =
  "Operators can't add documents. You can ask about documents already here. An Engineer or Admin can add files.";
const GONE_MESSAGE = "This file isn't available any more.";
const READY_PREFIX = "(Ready) ";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain-words reason for a failed multipart POST (shown on every row of that batch). */
function transportFailure(e: unknown): Pick<TrackedUpload, "reasonCode" | "reasonMessage"> {
  if (e instanceof ApiError) {
    if (e.status === 0) return { reasonCode: null, reasonMessage: "Upload interrupted." };
    if (e.status === 413) return { reasonCode: "FILE_TOO_LARGE", reasonMessage: null };
    if (e.status === 429) {
      return { reasonCode: null, reasonMessage: "Lots of people are using the demo right now. Try again in a minute." };
    }
    if (e.status === 403) return { reasonCode: null, reasonMessage: "This account can't add files." };
  }
  return { reasonCode: null, reasonMessage: errorText(e) };
}

function resultFields(item: UploadItem | undefined): Partial<TrackedUpload> {
  if (!item) return { phase: "rejected", reasonCode: null, reasonMessage: null };
  if (item.status === "rejected" || !item.document_id) {
    return {
      phase: "rejected",
      reasonCode: item.error?.code ?? null,
      reasonMessage: item.error?.message || null,
    };
  }
  return {
    phase: item.status === "duplicate" ? "duplicate" : "queued",
    documentId: item.document_id,
    reasonCode: null,
    reasonMessage: null,
  };
}

/** "Upload complete." plus what didn't go as planned; never percentages (§9 #3). */
function resultAnnouncement(rows: TrackedUpload[]): string {
  if (!rows.length) return "Upload complete.";
  if (rows.length === 1) {
    const [row] = rows;
    if (row.phase === "duplicate") return `${row.filename} was already added.`;
    if (row.phase === "rejected") return `${row.filename} wasn't accepted. ${describeStatus("rejected", row).sub ?? ""}`.trim();
    return `Upload complete. Reading ${row.filename}.`;
  }
  const dup = rows.filter((r) => r.phase === "duplicate").length;
  const rej = rows.filter((r) => r.phase === "rejected").length;
  const extras = [dup ? `${dup} already added` : "", rej ? `${rej} not accepted` : ""].filter(Boolean);
  return `Upload complete. ${rows.length} files${extras.length ? `, ${extras.join(", ")}` : ""}.`;
}

function setReadyTitle(on: boolean) {
  const has = document.title.startsWith(READY_PREFIX);
  if (on && !has) document.title = READY_PREFIX + document.title;
  if (!on && has) document.title = document.title.slice(READY_PREFIX.length);
}

/** Provides UploadsContext (§5.5): validation, "My documents", XHR upload, batched polling with
 *  backoff, ready announcements. */
export function UploadsProvider({ children, canUpload }: { children: ReactNode; canUpload: boolean }) {
  const workspace = useContext(WorkspaceContext);
  const shellMe = useContext(MeContext);
  const displayName = (workspace?.me ?? shellMe)?.display_name;

  const [items, setItems] = useState<TrackedUpload[]>([]);
  const [myCollection, setMyCollection] = useState<Collection | null>(null);
  const [rejectedNote, setRejectedNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Canonical rows. Every change goes through commit() so async callbacks see the latest rows
  // and can compare old and new phases without side effects inside state updaters.
  const rowsRef = useRef<TrackedUpload[]>([]);
  const collectionRef = useRef<Collection | null>(null);
  const ensuring = useRef<Promise<Collection> | null>(null);
  const keySeq = useRef(0);

  const commit = useCallback((next: TrackedUpload[]) => {
    rowsRef.current = next;
    setItems(next);
  }, []);

  const patchRows = useCallback(
    (keys: Set<string>, patch: Partial<TrackedUpload>) => {
      commit(rowsRef.current.map((r) => (keys.has(r.key) ? { ...r, ...patch } : r)));
    },
    [commit],
  );

  const newKey = useCallback(() => {
    keySeq.current += 1;
    return `u${Date.now().toString(36)}${keySeq.current}`;
  }, []);

  const rememberCollection = useCallback((c: Collection) => {
    collectionRef.current = c;
    setMyCollection(c);
  }, []);

  // Find (never create) "My documents" up front so polling can batch and the chat can scope to it.
  useEffect(() => {
    if (!canUpload) return;
    let cancelled = false;
    findMyDocuments(displayName)
      .then((c) => {
        if (!cancelled && c && !collectionRef.current) rememberCollection(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canUpload, displayName, rememberCollection]);

  const getCollection = useCallback(async (): Promise<Collection> => {
    if (collectionRef.current) return collectionRef.current;
    if (!ensuring.current) {
      ensuring.current = ensureMyDocuments(displayName).finally(() => {
        ensuring.current = null;
      });
    }
    const c = await ensuring.current;
    rememberCollection(c);
    return c;
  }, [displayName, rememberCollection]);

  const add = useCallback(
    async (files: File[]) => {
      if (!canUpload) {
        setRejectedNote(OPERATOR_NOTE);
        return;
      }
      if (!files.length) return;
      const { valid, skipped } = partitionFiles(files);
      const note = skippedNote(skipped);
      setRejectedNote(note);
      if (!valid.length) {
        if (note) announce(note);
        return;
      }

      const now = Date.now();
      const batch: TrackedUpload[] = valid.map((f) => ({
        key: newKey(),
        filename: f.name,
        sizeBytes: f.size,
        phase: "uploading",
        progress: 0,
        phaseSince: now,
      }));
      const keys = new Set(batch.map((r) => r.key));
      commit([...batch, ...rowsRef.current]);
      announce(
        [note, valid.length === 1 ? `Uploading ${valid[0].name}` : `Uploading ${valid.length} files`]
          .filter(Boolean)
          .join(". "),
      );

      const post = (c: Collection, group: File[], groupKeys: Set<string>) =>
        uploadFiles<{ items: UploadItem[] }>(`/collections/${c.id}/documents`, group, (p) =>
          patchRows(groupKeys, { progress: p }),
        );
      const send = async (group: File[], groupKeys: Set<string>): Promise<UploadItem[]> => {
        const collection = await getCollection();
        try {
          return (await post(collection, group, groupKeys)).items;
        } catch (e) {
          // The cached collection was deleted in the meantime: find or create it again, once.
          if (!(e instanceof ApiError && e.status === 404)) throw e;
          collectionRef.current = null;
          return (await post(await getCollection(), group, groupKeys)).items;
        }
      };

      // Sequential requests that each fit the proxy body limit; each group's chips switch to
      // their server status (and start polling) as soon as that group returns.
      const entries = valid.map((file, i) => ({ file, key: batch[i].key }));
      for (const group of requestGroups(entries, (e) => e.file.size)) {
        const groupKeys = new Set(group.map((e) => e.key));
        let results: UploadItem[];
        try {
          results = await send(
            group.map((e) => e.file),
            groupKeys,
          );
        } catch (e) {
          const reason = transportFailure(e);
          const unsent = new Set(
            rowsRef.current.filter((r) => keys.has(r.key) && r.phase === "uploading").map((r) => r.key),
          );
          patchRows(unsent, { phase: "rejected", progress: undefined, phaseSince: Date.now(), ...reason });
          announce(describeStatus("rejected", reason).sub ?? "Upload failed.");
          return;
        }
        const done = Date.now();
        const byKey = new Map(group.map((e, i) => [e.key, resultFields(results[i])]));
        // Rows removed during the upload stay removed; the documents themselves are kept.
        commit(
          rowsRef.current.map((r) => {
            const fields = byKey.get(r.key);
            return fields ? { ...r, ...fields, progress: undefined, phaseSince: done } : r;
          }),
        );
      }
      announce(resultAnnouncement(rowsRef.current.filter((r) => keys.has(r.key))));
    },
    [canUpload, commit, getCollection, newKey, patchRows],
  );

  const track = useCallback(
    (documentIds: string[]) => {
      const known = new Set(rowsRef.current.map((r) => r.documentId).filter(Boolean));
      const fresh = [...new Set(documentIds)].filter((id) => UUID_RE.test(id) && !known.has(id));
      if (!fresh.length) return;
      const now = Date.now();
      const rows: TrackedUpload[] = fresh.map((id) => ({
        key: newKey(),
        filename: LOADING_FILENAME,
        sizeBytes: null,
        phase: "queued",
        documentId: id,
        phaseSince: now,
      }));
      commit([...rows, ...rowsRef.current]);
    },
    [commit, newKey],
  );

  const remove = useCallback(
    (key: string) => commit(rowsRef.current.filter((r) => r.key !== key)),
    [commit],
  );

  const pickFiles = useCallback(() => {
    if (!canUpload) {
      setRejectedNote(OPERATOR_NOTE);
      return;
    }
    inputRef.current?.click();
  }, [canUpload]);

  const clearRejectedNote = useCallback(() => setRejectedNote(null), []);

  const onDocs = useCallback(
    ({ docs, gone }: DocStatusUpdate) => {
      const now = Date.now();
      const ready: TrackedUpload[] = [];
      let changed = false;
      const next = rowsRef.current.map((row) => {
        const id = row.documentId;
        if (!id || row.phase === "uploading" || row.phase === "rejected") return row;
        if (gone.has(id)) {
          changed = true;
          return { ...row, phase: "rejected" as const, reasonCode: null, reasonMessage: GONE_MESSAGE, phaseSince: now };
        }
        const doc = docs.get(id);
        if (!doc) return row;
        const docPhase = phaseFromDocument(doc.status, doc.latest_job?.status);
        // A duplicate of a Ready document stays "Already added"; otherwise it follows its copy.
        const phase: UploadPhase = row.phase === "duplicate" && docPhase === "indexed" ? "duplicate" : docPhase;
        const updated: TrackedUpload = {
          ...row,
          phase,
          filename: row.filename === LOADING_FILENAME ? doc.filename : row.filename,
          sizeBytes: row.sizeBytes ?? doc.size_bytes,
          pageCount: doc.page_count,
          stage: doc.latest_job?.stage ?? null,
          reasonCode: phase === "failed" ? (doc.latest_job?.error_code ?? null) : null,
          reasonMessage: phase === "failed" ? (doc.latest_job?.safe_error_message ?? null) : null,
          phaseSince: phase === row.phase ? row.phaseSince : now,
        };
        const same = (Object.keys(updated) as (keyof TrackedUpload)[]).every((k) => updated[k] === row[k]);
        if (same) return row;
        changed = true;
        if (phase === "indexed" && row.phase !== "indexed") ready.push(updated);
        return updated;
      });
      if (!changed) return;
      commit(next);
      if (ready.length) {
        announce(readyMessage(ready.map((r) => r.filename), ready.length === 1 ? ready[0].pageCount : null));
        if (document.hidden) setReadyTitle(true);
      }
    },
    [commit],
  );

  const watchedIds = useMemo(
    () => items.filter((r) => r.documentId && r.phase !== "rejected").map((r) => r.documentId as string),
    [items],
  );
  useDocStatus(watchedIds, myCollection?.id ?? null, { onUpdate: onDocs });

  // "(Ready) " only marks a hidden tab; drop it as soon as the user is back.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) setReadyTitle(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      setReadyTitle(false);
    };
  }, []);

  const value = useMemo<UploadsApi>(
    () => ({
      items,
      add,
      track,
      remove,
      pickFiles,
      myCollection,
      rejectedNote,
      clearRejectedNote,
      canUpload,
    }),
    [items, add, track, remove, pickFiles, myCollection, rejectedNote, clearRejectedNote, canUpload],
  );

  return (
    <UploadsContext.Provider value={value}>
      {children}
      {canUpload && (
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            // Clear so picking the same file again still fires change.
            e.currentTarget.value = "";
            void add(files);
          }}
        />
      )}
    </UploadsContext.Provider>
  );
}
