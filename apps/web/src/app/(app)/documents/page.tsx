"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type DragEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icons";
import {
  Button,
  Card,
  confirmDangerClass,
  cx,
  Dialog,
  Empty,
  ErrorState,
  inputClass,
  Loading,
  PageHeader,
  StatusBadge,
  TableWrap,
  Td,
  textButtonClass,
  Th,
  UpdatedAt,
} from "@/components/ui";
import { announce } from "@/lib/announce";
import { api, ApiError, errorText } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";
import { useApi, useCan, useMe } from "@/lib/hooks";
import type { Collection, DocumentItem, Page, UploadItem } from "@/lib/types";
import { ACCEPT_ATTR, checkFile, MY_DOCUMENTS, uploadInGroups } from "@/lib/workspace";

const ACTIVE = new Set(["queued", "processing", "deleting"]);
/** Row actions are text buttons, not keycaps, so a long list doesn't stack two keys on every row.
 *  On desktop the negative margin pulls the 32px target back to one text line, so the label sits
 *  on the first line of the other cells. On a phone the 44px targets stack in a narrow column, and
 *  only the first one pulls up, so no two targets overlap. */
const ROW_ACTION = cx(textButtonClass, "max-sm:first:-mt-3 sm:-my-1.5");
const ROW_ACTION_DANGER = cx(ROW_ACTION, "text-bad! active:text-bad!");
/** Table name link: on touch, padding gives it a 44px target without changing the row height. */
const NAME_LINK = cx(
  "font-medium text-text wrap-anywhere hover:text-accent hover:underline focus-visible:underline active:text-accent-hover",
  "pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3",
);
/** Columns hidden on a phone (the collection folds under the file name), so the table keeps
 *  the file, its status and its actions. */
const WIDE_ONLY = "max-sm:hidden";
/** On a phone the actions cell stays pinned to the right edge while the table scrolls under it.
 *  It takes the canvas colour, and follows the row hover. */
const PINNED = "max-sm:sticky max-sm:right-0 max-sm:z-1";
/** Field label: sentence case in the body face, above its control. */
const FIELD_LABEL = "mb-1 block text-sm font-medium text-text";

/** The collections evaluation seeding creates (evaluation/seed.py). Exact, so that a collection
 *  someone happens to call "Evaluation reports" is an ordinary one. */
const EVALUATION_CORPUS = /^Evaluation (corpus|restricted) \(v\d+\)$/;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function resultSummary(items: UploadItem[]): string {
  const rejected = items.filter((r) => r.status === "rejected").length;
  const duplicates = items.filter((r) => r.status === "duplicate").length;
  const parts = [`${plural(items.length - rejected - duplicates, "file")} uploaded`];
  if (duplicates) parts.push(`${plural(duplicates, "duplicate")} skipped`);
  if (rejected) parts.push(`${rejected} rejected`);
  return `${parts.join(", ")}.`;
}

/** The results row follows the document once the list below knows it. A document outside the
 *  current filters stays "Uploaded", which remains true whatever happens to it next. */
function ResultBadge({ result, live }: { result: UploadItem; live?: DocumentItem }) {
  if (result.status === "rejected") return <StatusBadge status="failed" label="Rejected" />;
  if (result.status === "duplicate") return <StatusBadge status="skipped" label="Duplicate" />;
  return live ? <StatusBadge status={live.status} /> : <StatusBadge status="queued" label="Uploaded" />;
}

function UploadPanel({
  collections,
  documents,
  filterCollection,
  onUploaded,
}: {
  collections: Collection[];
  documents: DocumentItem[];
  filterCollection: string;
  onUploaded: () => void;
}) {
  const writable = collections.filter((c) => c.access_level === "write" || c.access_level === "manage");
  // A pick holds until the filter changes. The default is never the evaluation corpus while there
  // is anywhere else to put a file: its documents feed the evaluation runs.
  const [picked, setPicked] = useState<{ id: string; filter: string } | null>(null);
  const preferred =
    writable.find((c) => c.id === filterCollection) ??
    writable.find((c) => c.name === MY_DOCUMENTS) ??
    writable.find((c) => !EVALUATION_CORPUS.test(c.name)) ??
    writable[0];
  const collectionId =
    picked?.filter === filterCollection && writable.some((c) => c.id === picked.id)
      ? picked.id
      : (preferred?.id ?? "");
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (files: File[]) => {
    // One upload at a time: a drop during an upload would otherwise start a second one.
    if (!files.length || !collectionId || progress !== null) return;
    const local: UploadItem[] = [];
    const accepted: File[] = [];
    for (const f of files) {
      const problem = checkFile(f);
      if (problem) {
        local.push({ filename: f.name, status: "rejected", document_id: null, job_id: null, duplicate: false, error: { code: "CLIENT_CHECK", message: problem } });
      } else accepted.push(f);
    }
    setError(null);
    setResults(local);
    if (!accepted.length) {
      announce(resultSummary(local));
      return;
    }
    setProgress(0);
    try {
      // Split into requests that fit the /api proxy's body limit (next.config.ts).
      const items = await uploadInGroups(collectionId, accepted, setProgress);
      const all = [...local, ...items];
      setResults(all);
      announce(resultSummary(all));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setProgress(null);
      // Even after a failure: the requests before it may have added documents.
      onUploaded();
    }
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    void send(Array.from(ev.dataTransfer.files));
  };

  if (!writable.length) {
    return (
      <Card title="Upload">
        <p className="text-sm text-muted">You don&apos;t have write access to any collection.</p>
      </Card>
    );
  }
  // One containment layer: the dashed drop area is the panel, so it is not wrapped in a Card too.
  return (
    <section aria-labelledby="upload-heading" className="min-w-0">
      <h2 id="upload-heading" className="mb-3 text-base">Upload documents</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <label htmlFor="upload-collection" className={FIELD_LABEL}>Into collection</label>
          <select id="upload-collection" value={collectionId} onChange={(e) => setPicked({ id: e.target.value, filter: filterCollection })} className={inputClass}>
            {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border-2 border-dashed px-4 py-4 sm:px-6",
          "transition-colors duration-[var(--dur-micro)] ease-out",
          dragging ? "border-accent bg-accent-soft" : "border-dropzone-border bg-accent-soft/40",
        )}
      >
        <Icon name="upload" width={20} height={20} aria-hidden="true" className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium text-text pointer-coarse:hidden">Drag files here, or</p>
          <p className="hidden text-sm font-medium text-text pointer-coarse:block">Tap to choose a file</p>
          <p className="mt-0.5 text-sm text-muted">PDF, DOCX, TXT and Markdown, up to 25 MiB each. Scanned PDFs are OCR-processed.</p>
        </div>
        {/* aria-disabled, not disabled: the button keeps focus while the upload runs (§9 #5). */}
        <Button
          aria-busy={progress !== null || undefined}
          aria-disabled={progress !== null || undefined}
          onClick={() => {
            if (progress === null) inputRef.current?.click();
          }}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          aria-label="Choose files to upload"
          onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
      </div>
      {/* Outside the live region: every progress tick would otherwise be read out. */}
      {progress !== null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-sm bg-panel-3" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            {/* scaleX, not width: §8.4 animates transforms only, never layout. */}
            <div
              className="h-full w-full origin-left bg-accent transition-transform duration-[var(--dur-micro)] ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted tabular-nums">Uploading… {Math.round(progress * 100)}%</p>
        </div>
      )}
      {/* Results are announced once through #sr-announcer (§9 #2). */}
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
          {results.map((r, i) => (
            <li key={`${r.filename}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 truncate font-medium">{r.filename}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {r.error && <span className="text-xs text-bad">{r.error.message}</span>}
                {r.duplicate && <span className="text-xs text-muted">Already in this collection</span>}
                <ResultBadge result={r} live={documents.find((d) => d.id === r.document_id)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function retryErrorText(e: unknown, filename: string): string {
  if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
    return `Couldn't retry ${filename}. It takes write access to its collection.`;
  }
  return `Couldn't retry ${filename}. ${errorText(e)}`;
}

function DocumentsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const collection = params.get("collection") ?? "";
  const status = params.get("status") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const collections = useApi<Collection[]>("/collections?limit=500");
  const qs = new URLSearchParams();
  if (collection) qs.set("collection_id", collection);
  if (status) qs.set("status", status);
  if (params.get("q")) qs.set("q", params.get("q")!);
  qs.set("limit", "100");
  // The cursors of the pages walked so far. Tied to the filters: a new filter starts at its newest.
  const filterKey = qs.toString();
  const [paging, setPaging] = useState<{ filter: string; trail: string[] }>({ filter: filterKey, trail: [] });
  const trail = paging.filter === filterKey ? paging.trail : [];
  if (trail.length) qs.set("cursor", trail[trail.length - 1]);
  const listRef = useRef<HTMLDivElement>(null);
  const docs = useApi<Page<DocumentItem>>(`/documents?${qs}`, (d) =>
    d.items.some((x) => ACTIVE.has(x.status)) ? 2500 : 15000,
  );
  const me = useMe();
  const canUpload = useCan("document:upload");
  const canDelete = useCan("document:delete");
  const canRetry = useCan("document:retry");
  const canManageJobs = useCan("job:manage");
  const canDownload = useCan("document:read_content");
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** The button pressed may be gone once the page loads, so the list takes focus and the reader
   *  starts from the top of the new page. */
  const goToPage = (next: string[]) => {
    setPaging({ filter: filterKey, trail: next });
    listRef.current?.focus({ preventScroll: true });
    listRef.current?.scrollIntoView({ block: "start" });
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/documents?${next}`);
  };

  // Unknown levels (the list hasn't loaded, or failed) are left to the API to decide.
  const levelOf = (doc: DocumentItem) => collections.data?.find((c) => c.id === doc.collection_id)?.access_level;
  const hasWriteAccess = (doc: DocumentItem) => {
    const level = levelOf(doc);
    return level === "write" || level === "manage";
  };
  /** Document retry needs write access to the collection. Operators (job:manage) have read access,
   *  so they re-queue the failed read job instead, which also puts the document back in line. */
  const retryableJob = (doc: DocumentItem) => {
    const job = doc.latest_job;
    const usable = canManageJobs && job?.job_type === "ingest_document" && (job.status === "failed" || job.status === "cancelled");
    return usable ? job : null;
  };
  const mayRetry = (doc: DocumentItem) =>
    canRetry &&
    doc.status === "failed" &&
    // A failed delete offers Delete instead: reading the file again could not restore it.
    doc.latest_job?.job_type !== "delete_document" &&
    (levelOf(doc) === undefined || hasWriteAccess(doc) || retryableJob(doc) !== null);
  const mayDelete = (doc: DocumentItem) => {
    if (!canDelete || ["deleting", "deleted"].includes(doc.status)) return false;
    const level = levelOf(doc);
    // The API wants write access before it looks at who uploaded the file.
    return me.role === "org_admin" || level === undefined || level === "manage" || (level === "write" && doc.uploaded_by === me.user_id);
  };
  const mayDownload = (doc: DocumentItem) =>
    canDownload && !["deleting", "deleted"].includes(doc.status) && levelOf(doc) !== null;

  /** The row's button goes away with the status change, so keep focus on the same row. */
  const focusRow = (id: string) => document.getElementById(`doc-${id}`)?.focus();

  const retry = async (doc: DocumentItem) => {
    if (retrying) return;
    setRetrying(doc.id);
    setNotice(null);
    try {
      const job = hasWriteAccess(doc) ? null : retryableJob(doc);
      await api(job ? `/jobs/${job.id}/retry` : `/documents/${doc.id}/retry`, { method: "POST" });
      announce(`Retrying ${doc.filename}.`);
      focusRow(doc.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Usually someone else already re-queued it, and the reload below shows that. A document
        // that is still failed was refused for good, and the reason needs saying.
        const now = await api<DocumentItem>(`/documents/${doc.id}`).catch(() => null);
        if (now?.status === "failed") setNotice(retryErrorText(e, doc.filename));
      } else {
        setNotice(retryErrorText(e, doc.filename));
      }
    } finally {
      setRetrying(null);
      docs.reload();
    }
  };

  const confirmDelete = async () => {
    const doc = pendingDelete;
    if (!doc || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      // Closed before focus moves: everything behind a modal dialog is inert.
      flushSync(() => setPendingDelete(null));
      announce(`Deleting ${doc.filename}.`);
      focusRow(doc.id);
      docs.reload();
    } catch (e) {
      setDeleteError(errorText(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Documents"
        description={canUpload ? "Upload, track processing and manage indexed knowledge." : "Track processing and review indexed knowledge."}
        actions={<UpdatedAt at={docs.updatedAt} />}
      />
      {canUpload && collections.data && (
        <div className="mb-8 border-b border-border pb-8">
          <UploadPanel collections={collections.data} documents={docs.data?.items ?? []} filterCollection={collection} onUploaded={() => { setPaging({ filter: filterKey, trail: [] }); docs.reload(); }} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 max-sm:w-full">
          <label htmlFor="f-col" className={FIELD_LABEL}>Collection</label>
          <select id="f-col" value={collection} onChange={(e) => setParam("collection", e.target.value)} className={inputClass}>
            <option value="">All collections</option>
            {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="min-w-0 max-sm:w-full">
          <label htmlFor="f-status" className={FIELD_LABEL}>Status</label>
          <select id="f-status" value={status} onChange={(e) => setParam("status", e.target.value)} className={inputClass}>
            <option value="">Any status</option>
            {["queued", "processing", "indexed", "failed", "deleting"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setParam("q", q); }} className="flex min-w-0 items-end gap-2 max-sm:w-full">
          <div className="min-w-0 flex-1">
            <label htmlFor="f-q" className={FIELD_LABEL}>Filename</label>
            <input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={inputClass} />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>
      {notice && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-card bg-bad-soft px-3 py-2 text-sm text-bad">
          <Icon name="cross" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{notice}</span>
        </p>
      )}
      <div ref={listRef} tabIndex={-1} className="scroll-mt-4 outline-none">
        {docs.loading && <Loading />}
        {docs.error && <ErrorState error={docs.error} onRetry={docs.reload} />}
        {docs.data && docs.data.items.length === 0 && (
          trail.length
            ? <Empty title="No more documents">Go back to an earlier page.</Empty>
            : <Empty title="No documents match">{canUpload ? "Upload files or adjust the filters." : "Adjust the filters."}</Empty>
        )}
        {docs.data && docs.data.items.length > 0 && (
          <TableWrap>
            <thead>
              <tr><Th>File</Th><Th className={WIDE_ONLY}>Collection</Th><Th>Status</Th><Th className={cx("text-right", WIDE_ONLY)}>Pages / chunks</Th><Th className={cx("text-right", WIDE_ONLY)}>Size</Th><Th className={WIDE_ONLY}>Uploaded</Th><Th className={cx("relative", PINNED)}><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {docs.data.items.map((d) => (
                <tr key={d.id} className="transition-colors duration-[var(--dur-micro)] hover:bg-panel-2">
                  <Td className="min-w-32 sm:min-w-48">
                    <Link id={`doc-${d.id}`} href={`/documents/${d.id}`} className={NAME_LINK}>
                      {d.filename}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                      <span>{d.file_type.toUpperCase()}</span>
                      <span className="sm:hidden">{d.collection_name}</span>
                      {(d.extraction_method === "ocr" || d.extraction_method === "mixed") && <span>Read with OCR</span>}
                    </div>
                  </Td>
                  <Td className={cx("whitespace-nowrap text-muted", WIDE_ONLY)}>{d.collection_name}</Td>
                  <Td>
                    <StatusBadge status={d.status} />
                    {d.latest_job && ["running", "retry_wait"].includes(d.latest_job.status) && (
                      <div className="mt-1 text-xs text-muted tabular-nums">{d.latest_job.stage ?? d.latest_job.status}, attempt {d.latest_job.attempt_count} of {d.latest_job.max_attempts}</div>
                    )}
                    {d.status === "failed" && d.latest_job?.safe_error_message && <div className="mt-1 max-w-xs text-xs text-bad">{d.latest_job.safe_error_message}</div>}
                    {d.warnings.length > 0 && <div className="mt-1 text-xs text-warn">{d.warnings.length} warning{d.warnings.length > 1 ? "s" : ""}</div>}
                  </Td>
                  <Td className={cx("whitespace-nowrap text-right tabular-nums", WIDE_ONLY)}>{d.page_count ?? "None"} / {d.chunk_count ?? "None"}</Td>
                  <Td className={cx("whitespace-nowrap text-right text-muted tabular-nums", WIDE_ONLY)}>{formatBytes(d.size_bytes)}</Td>
                  <Td className={cx("whitespace-nowrap text-muted tabular-nums", WIDE_ONLY)}>{formatTime(d.created_at)}</Td>
                  <Td className={cx("whitespace-nowrap text-right max-sm:bg-bg max-sm:[tr:hover>&]:bg-panel-2", PINNED)}>
                    {/* gap-y-3 keeps two wrapped actions' targets from overlapping. */}
                    <span className="inline-flex flex-wrap justify-end gap-x-4 gap-y-3 max-sm:flex-col max-sm:items-end max-sm:gap-0">
                      {mayDownload(d) && (
                        <a href={`/api/v1/documents/${d.id}/download`} download aria-label={`Download ${d.filename}`} className={ROW_ACTION}>Download</a>
                      )}
                      {mayRetry(d) && (
                        <button
                          type="button"
                          className={ROW_ACTION}
                          aria-label={`Retry ${d.filename}`}
                          aria-busy={retrying === d.id || undefined}
                          aria-disabled={retrying === d.id || undefined}
                          onClick={() => void retry(d)}
                        >
                          {retrying === d.id ? "Retrying…" : "Retry"}
                        </button>
                      )}
                      {mayDelete(d) && (
                        <button
                          type="button"
                          className={ROW_ACTION_DANGER}
                          aria-label={`Delete ${d.filename}`}
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDelete(d);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {(trail.length > 0 || docs.data?.next_cursor) && (
          <nav aria-label="Document pages" className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-sm text-muted tabular-nums">Page {trail.length + 1}, newest first</span>
            {trail.length > 1 && <Button onClick={() => goToPage([])}>First page</Button>}
            {trail.length > 0 && <Button onClick={() => goToPage(trail.slice(0, -1))}>Previous page</Button>}
            {docs.data?.next_cursor && <Button onClick={() => goToPage([...trail, docs.data!.next_cursor!])}>Next page</Button>}
          </nav>
        )}
      </div>
      <Dialog open={pendingDelete !== null} title="Delete this document?" onClose={() => setPendingDelete(null)}>
        <p className="text-sm [overflow-wrap:anywhere]">
          <span className="font-medium">{pendingDelete?.filename}</span> will be deleted, along with its chunks and vectors.
        </p>
        {deleteError && <p role="alert" className="mt-3 text-sm text-bad">{deleteError}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button data-autofocus onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button variant="danger" className={confirmDangerClass} busy={deleteBusy} aria-disabled={deleteBusy || undefined} onClick={() => void confirmDelete()}>
            {deleteBusy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentsInner />
    </Suspense>
  );
}
