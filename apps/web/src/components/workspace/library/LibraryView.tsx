"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { announce } from "@/lib/announce";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Collection, DocumentItem } from "@/lib/types";
import { refreshDocStatus } from "@/lib/useDocStatus";
import { LOADING_FILENAME, MY_DOCUMENTS, readyMessage } from "@/lib/workspace";
import type { TrackedUpload } from "../types";
import { useUploads } from "../UploadsContext";
import { useWorkspace } from "../WorkspaceContext";
import { ConfirmDelete } from "./ConfirmDelete";
import { LibraryCards, LibraryTable, type LibraryListProps } from "./LibraryList";
import { DelayedSkeleton, EmptyBlock, primaryButtonClass, SearchIcon, secondaryButtonClass, useNow } from "./parts";
import type { RowAction } from "./RowMenu";
import {
  countRows,
  docRow,
  FILTERS,
  filtersOf,
  libraryPath,
  matchesFilter,
  uploadRow,
  type LibraryRow,
  type StatusFilter,
} from "./rows";
import { LoadError, RefreshProblem, UploadDropzone } from "./states";
import { LibraryToolbar } from "./Toolbar";
import { useLibraryDocs } from "./useLibraryDocs";

const SEARCH_DEBOUNCE_MS = 250;

const UNREACHABLE = "Can't reach RackFlow. Check that the server is running, then try again.";

function deleteErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return UNREACHABLE;
    if (e.status === 403) {
      return "Only the person who added this file, or someone who manages its collection, can delete it.";
    }
    if (e.status === 429) return "Too many requests right now. Wait a few seconds, then try again.";
  }
  return "Something went wrong on our side. Try again.";
}

function retryErrorText(e: unknown, filename: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `Couldn't try ${filename} again. ${UNREACHABLE}`;
    if (e.status === 403 || e.status === 404) return `Your role can't retry ${filename}. An Engineer or Admin can.`;
  }
  return `Couldn't try ${filename} again. Something went wrong on our side.`;
}

/** Already re-queued (by another tab or person), so there is nothing to report. */
const alreadyRetrying = (e: unknown) => e instanceof ApiError && e.status === 409;

/** "My documents" (§6): every document this user can read, with search, status chips, a
 *  collection menu, §5.5 polling, ready flashes, and permission-gated row actions. Uploads go
 *  through UploadsContext, so the sidebar, overlay and chips see the same files. */
export function LibraryView() {
  const { me, canChat, canUpload } = useWorkspace();
  const uploads = useUploads();
  const now = useNow();
  const can = (permission: string) => me.permissions.includes(permission);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [collectionId, setCollectionId] = useState("all");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; filename: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // ---------- collections (menu options, and who may delete what) ----------
  const collectionsQ = useApi<Collection[]>("/collections?limit=500");
  const myCollection = uploads.myCollection;
  const collectionOptions: Collection[] = [...(collectionsQ.data ?? [])];
  // "My documents" may have been created by an upload after the list loaded.
  if (collectionsQ.data && myCollection && !collectionOptions.some((c) => c.id === myCollection.id)) {
    collectionOptions.push(myCollection);
  }
  // A collection that disappeared falls back to all of them.
  const activeCollection =
    collectionId === "all" || !collectionsQ.data || collectionOptions.some((c) => c.id === collectionId)
      ? collectionId
      : "all";
  const levels = new Map(collectionOptions.map((c) => [c.id, c.access_level]));

  // ---------- documents ----------
  const path = libraryPath(q, activeCollection);
  // A finished upload restarts polling at once so its row arrives without waiting for a tick.
  const kick = uploads.items
    .flatMap((u) => (u.documentId ? [u.documentId] : []))
    .sort()
    .join(",");
  const docs = useLibraryDocs(path, kick, (ready) => {
    // UploadsProvider already announces files added in this tab.
    const tracked = new Set(uploads.items.map((u) => u.documentId));
    const fresh = ready.filter((d) => !tracked.has(d.id));
    if (fresh.length) {
      announce(readyMessage(fresh.map((d) => d.filename), fresh.length === 1 ? fresh[0].page_count : null));
    }
  });
  const shown = filtersOf(docs.shownPath ?? path);

  // The provider only sets the skipped-files note; on this page it is announced here (but not
  // a note that was already showing when the page opened).
  const note = uploads.rejectedNote;
  const noteOnArrival = useRef(note);
  useEffect(() => {
    if (note && note !== noteOnArrival.current) announce(note);
  }, [note]);

  // ---------- rows ----------
  const docIds = new Set(docs.items.map((d) => d.id));
  const uploadVisible = (u: TrackedUpload) => {
    if (u.filename === LOADING_FILENAME) return false;
    if (shown.collectionId !== "all" && shown.collectionId !== myCollection?.id) return false;
    if (shown.q && !u.filename.toLowerCase().includes(shown.q.toLowerCase())) return false;
    // Still uploading, or not accepted: there is no document to list.
    if (!u.documentId) return true;
    // Accepted, and the list hasn't caught up yet. Duplicates point at a document already listed.
    if (docIds.has(u.documentId) || removed.has(u.documentId)) return false;
    return u.phase !== "rejected" && u.phase !== "duplicate";
  };
  const seenKeys = new Set<string>();
  const allRows: LibraryRow[] = [
    ...uploads.items
      .filter(uploadVisible)
      .map((u) => uploadRow(u, myCollection?.name ?? MY_DOCUMENTS, now)),
    ...docs.items.map((d) => docRow(d, now)),
  ].filter((row) => (seenKeys.has(row.key) ? false : (seenKeys.add(row.key), true)));
  const counts = countRows(allRows);
  const rows = allRows.filter((row) => matchesFilter(row, filter));

  // ---------- actions ----------
  /** After a row's own "⋯" button disappears, keep focus on the page instead of <body>. */
  const keepFocus = () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) headingRef.current?.focus();
    }, 0);
  };

  const mayDelete = (doc: DocumentItem) => {
    if (!can("document:delete")) return false;
    if (me.role === "org_admin" || doc.uploaded_by === me.user_id) return true;
    // The API also lets a collection's managers delete; unknown levels are left to the API.
    const level = levels.get(doc.collection_id);
    return level === undefined || level === "manage";
  };

  const retry = async (doc: DocumentItem) => {
    if (retrying.has(doc.id)) return;
    setRetrying((s) => new Set(s).add(doc.id));
    setNotice(null);
    try {
      try {
        await api(`/documents/${encodeURIComponent(doc.id)}/retry`, { method: "POST" });
      } catch (e) {
        // Document retry needs write access to the collection. Operators (job:manage) can
        // re-queue the failed read job instead, which also puts the document back in line.
        const job = doc.latest_job;
        const viaJob =
          e instanceof ApiError &&
          e.status === 404 &&
          can("job:manage") &&
          job !== null &&
          job.job_type === "ingest_document" &&
          (job.status === "failed" || job.status === "cancelled");
        if (!viaJob || !job) throw e;
        await api(`/jobs/${encodeURIComponent(job.id)}/retry`, { method: "POST" });
      }
      docs.patch(doc.id, { status: "queued" });
      announce(`Trying ${doc.filename} again.`);
    } catch (e) {
      if (!alreadyRetrying(e)) setNotice(retryErrorText(e, doc.filename));
    } finally {
      setRetrying((s) => {
        const next = new Set(s);
        next.delete(doc.id);
        return next;
      });
      docs.refresh();
      // Chips in /ask that watch this document start polling again too.
      refreshDocStatus();
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(`/documents/${encodeURIComponent(target.id)}`, { method: "DELETE" });
    } catch (e) {
      // 404: already gone. 409: someone else is already removing it. Both end the same way.
      const settled = e instanceof ApiError && (e.status === 404 || e.status === 409);
      if (!settled) {
        setDeleteError(deleteErrorText(e));
        setDeleteBusy(false);
        return;
      }
    }
    setDeleteBusy(false);
    setPendingDelete(null);
    docs.patch(target.id, { status: "deleting" });
    setRemoved((s) => new Set(s).add(target.id));
    // Stop showing it as an upload chip too; the document itself is already being deleted.
    for (const u of uploads.items) if (u.documentId === target.id) uploads.remove(u.key);
    announce(`${target.filename} is being removed.`);
    docs.refresh();
  };

  const actionsFor = (row: LibraryRow, layout: "table" | "cards"): RowAction[] => {
    const actions: RowAction[] = [];
    const doc = row.doc;
    if (doc) {
      if (row.phase === "deleting") return actions;
      if (layout === "cards" && canChat && row.phase === "indexed") {
        actions.push({ label: "Ask about this", href: `/ask?doc=${encodeURIComponent(doc.id)}` });
      }
      if (can("document:read_content")) {
        actions.push({ label: "Download", href: `/api/v1/documents/${encodeURIComponent(doc.id)}/download`, download: true });
      }
      if (row.phase === "failed" && can("document:retry")) {
        actions.push({ label: retrying.has(doc.id) ? "Trying again…" : "Try again", onSelect: () => void retry(doc) });
      }
      if (mayDelete(doc)) {
        actions.push({
          label: "Delete",
          danger: true,
          onSelect: () => {
            setDeleteError(null);
            setPendingDelete({ id: doc.id, filename: doc.filename });
          },
        });
      }
      return actions;
    }
    const upload = row.upload;
    if (upload?.phase === "rejected") {
      if (canUpload) actions.push({ label: "Choose another file", onSelect: () => uploads.pickFiles() });
      actions.push({
        label: "Remove from list",
        onSelect: () => {
          uploads.remove(upload.key);
          keepFocus();
        },
      });
    }
    return actions;
  };

  // ---------- body ----------
  const clearSearch = () => {
    setQuery("");
    setQ("");
    searchRef.current?.focus();
  };
  const showAll = () => setFilter("all");

  const filterLabel = FILTERS.find((f) => f.key === filter)?.label ?? "All";
  const caption =
    `My documents${filter === "all" ? "" : `, ${filterLabel}`}` +
    `${shown.q ? `, matching “${shown.q}”` : ""}: ${rows.length} ${rows.length === 1 ? "file" : "files"}`;
  const listProps: LibraryListProps = {
    rows,
    caption,
    now,
    flashing: docs.flashing,
    canAsk: canChat,
    // §5.4: raw codes only inside the org_admin/operator disclosure.
    showAdminDetails: me.role === "org_admin" || me.role === "operator",
    actionsFor,
  };

  const firstLoadFailed = docs.loaded && docs.error !== undefined && docs.updatedAt === undefined;
  const filtering = query !== "" || q !== "" || shown.q !== "" || shown.collectionId !== "all" || activeCollection !== "all";
  const showToolbar = docs.loaded && !firstLoadFailed && (allRows.length > 0 || filtering);
  const shownCollectionName = collectionOptions.find((c) => c.id === shown.collectionId)?.name ?? "this collection";

  let body: ReactNode;
  if (!docs.loaded) {
    body = <DelayedSkeleton />;
  } else if (firstLoadFailed) {
    body = <LoadError error={docs.error} onRetry={docs.refresh} />;
  } else if (rows.length > 0) {
    body = (
      <>
        {docs.error && <RefreshProblem error={docs.error} onRetry={docs.refresh} />}
        <div aria-busy={docs.stale || undefined} className={cx("mt-4", docs.stale && "opacity-60")}>
          <LibraryTable {...listProps} />
          <LibraryCards {...listProps} />
        </div>
        {docs.truncated && (
          <p className="mt-3 text-xs text-muted">Showing the newest 200 files. Search by name to find older ones.</p>
        )}
      </>
    );
  } else if (allRows.length === 0 && shown.q) {
    body = (
      <EmptyBlock
        icon={<SearchIcon className="size-6" />}
        title={`No documents match “${shown.q}”`}
        description="Check the spelling, or search for part of the file name."
        action={
          <button type="button" onClick={clearSearch} className={secondaryButtonClass}>
            Clear search
          </button>
        }
      />
    );
  } else if (allRows.length === 0 && shown.collectionId !== "all") {
    body = (
      <EmptyBlock
        icon={<Icon name="documents" width={24} height={24} />}
        title={`Nothing in ${shownCollectionName} yet`}
        action={
          <button type="button" onClick={() => setCollectionId("all")} className={secondaryButtonClass}>
            Show all collections
          </button>
        }
      />
    );
  } else if (allRows.length === 0) {
    body = canUpload ? (
      <UploadDropzone onPick={() => uploads.pickFiles()} />
    ) : (
      <EmptyBlock
        icon={<Icon name="documents" width={24} height={24} />}
        title="No documents yet"
        description="Engineers and Admins can add them."
      />
    );
  } else {
    const copy: Record<Exclude<StatusFilter, "all">, { title: string; description: string; icon: "check" | "documents" }> = {
      attention: { title: "Nothing needs attention", description: "Every file was read successfully.", icon: "check" },
      ready: { title: "Nothing is ready yet", description: "Files show up here once they've been read.", icon: "documents" },
      pending: { title: "Nothing is being read right now", description: "Every file has finished.", icon: "check" },
    };
    const c = filter === "all" ? copy.ready : copy[filter];
    body = (
      <EmptyBlock
        icon={<Icon name={c.icon} width={24} height={24} />}
        title={c.title}
        description={c.description}
        action={
          <button type="button" onClick={showAll} className={secondaryButtonClass}>
            Show all files
          </button>
        }
      />
    );
  }

  return (
    <>
      <div
        className={cx(
          "mx-auto w-full max-w-[1080px] px-4 pt-6 md:px-6 md:pt-8",
          // Room under the last row for the mobile Upload button.
          canUpload ? "pb-[calc(96px_+_env(safe-area-inset-bottom))] sm:pb-10" : "pb-10",
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 ref={headingRef} tabIndex={-1} className="text-xl/7 font-semibold tracking-tight">
              My documents
            </h1>
            <p className="mt-0.5 text-sm text-muted">Everything you can ask about</p>
          </div>
          {canUpload && (
            <div className="hidden sm:block">
              <button type="button" onClick={() => uploads.pickFiles()} className={primaryButtonClass}>
                <Icon name="upload" />
                Add files
              </button>
            </div>
          )}
        </div>

        {note && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-warn-soft py-2 pr-1 pl-3 text-sm text-text">
            <p className="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]">{note}</p>
            <button
              type="button"
              onClick={uploads.clearRejectedNote}
              aria-label="Dismiss note"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:text-text pointer-coarse:size-11"
            >
              <Icon name="close" width={14} height={14} />
            </button>
          </div>
        )}

        {notice && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-bad-soft py-2 pr-1 pl-3 text-sm text-text"
          >
            <p className="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]">{notice}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:text-text pointer-coarse:size-11"
            >
              <Icon name="close" width={14} height={14} />
            </button>
          </div>
        )}

        {showToolbar && (
          <LibraryToolbar
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            filter={filter}
            onFilter={setFilter}
            counts={counts}
            collections={collectionOptions}
            collectionId={activeCollection}
            onCollection={setCollectionId}
          />
        )}

        {body}
      </div>

      <ConfirmDelete
        filename={pendingDelete?.filename ?? null}
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (deleteBusy) return;
          setPendingDelete(null);
          setDeleteError(null);
        }}
        onConfirm={() => void confirmDelete()}
        fallbackFocus={() => headingRef.current}
      />

      {canUpload && (
        <button
          type="button"
          onClick={() => uploads.pickFiles()}
          className={cx(
            "fixed right-[calc(16px_+_env(safe-area-inset-right))] bottom-[calc(16px_+_env(safe-area-inset-bottom))] z-30",
            "inline-flex h-14 min-w-14 items-center justify-center gap-2 rounded-full bg-accent px-5",
            "text-base font-semibold text-accent-contrast shadow-elev-3",
            "transition-[opacity,scale] duration-150 hover:opacity-90 active:scale-[.98] active:duration-100 sm:hidden",
          )}
        >
          <Icon name="upload" width={20} height={20} />
          Upload
        </button>
      )}
    </>
  );
}
