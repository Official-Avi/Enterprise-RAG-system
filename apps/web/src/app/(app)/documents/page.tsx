"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type DragEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icons";
import {
  Button,
  Card,
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
const LINK_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-medium " +
  "text-text transition-colors hover:bg-panel-2";

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
    writable.find((c) => !c.name.startsWith("Evaluation")) ??
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
  return (
    <Card title="Upload documents">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <label htmlFor="upload-collection" className="mb-1 block text-sm font-medium">Into collection</label>
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
          "mt-3 rounded-lg border-2 border-dashed px-4 py-6 text-center",
          dragging ? "border-accent bg-accent-soft" : "border-border",
        )}
      >
        <Icon name="upload" width={22} height={22} className="mx-auto text-muted" />
        <p className="mt-2 text-sm pointer-coarse:hidden">Drag files here, or</p>
        <p className="mt-2 hidden text-sm pointer-coarse:block">Tap to choose a file</p>
        {/* aria-disabled, not disabled: the button keeps focus while the upload runs (§9 #5). */}
        <Button
          className="mt-2"
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
        <p className="mt-2 text-xs text-muted">PDF, DOCX, TXT, Markdown · up to 25 MiB each · scanned PDFs are OCR-processed</p>
      </div>
      {/* Outside the live region: every progress tick would otherwise be read out. */}
      {progress !== null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded bg-panel-2" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            {/* scaleX, not width: §8.4 animates transforms only, never layout. */}
            <div
              className="h-full w-full origin-left bg-accent transition-transform duration-150"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">Uploading… {Math.round(progress * 100)}%</p>
        </div>
      )}
      {/* Results are announced once through #sr-announcer (§9 #2). */}
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border text-sm">
          {results.map((r, i) => (
            <li key={`${r.filename}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5">
              <span className="min-w-0 truncate">{r.filename}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {r.error && <span className="text-xs text-bad">{r.error.message}</span>}
                {r.duplicate && <span className="text-xs text-muted">Already in this collection</span>}
                <ResultBadge result={r} live={documents.find((d) => d.id === r.document_id)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function retryErrorText(e: unknown, filename: string): string {
  if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
    return `Your role can't retry ${filename}. An Engineer or Admin can.`;
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
    return me.role === "org_admin" || doc.uploaded_by === me.user_id || level === undefined || level === "manage";
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
      // 409: someone else already re-queued it, and the reload below shows that.
      if (!(e instanceof ApiError && e.status === 409)) setNotice(retryErrorText(e, doc.filename));
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
        <div className="mb-4">
          <UploadPanel collections={collections.data} documents={docs.data?.items ?? []} filterCollection={collection} onUploaded={docs.reload} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="f-col" className="mb-1 block text-xs font-medium text-muted">Collection</label>
          <select id="f-col" value={collection} onChange={(e) => setParam("collection", e.target.value)} className={inputClass}>
            <option value="">All collections</option>
            {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-muted">Status</label>
          <select id="f-status" value={status} onChange={(e) => setParam("status", e.target.value)} className={inputClass}>
            <option value="">Any status</option>
            {["queued", "processing", "indexed", "failed", "deleting"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setParam("q", q); }} className="flex items-end gap-2">
          <div>
            <label htmlFor="f-q" className="mb-1 block text-xs font-medium text-muted">Filename</label>
            <input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={inputClass} />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>
      {notice && <p role="alert" className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{notice}</p>}
      {docs.loading && <Loading />}
      {docs.error && <ErrorState error={docs.error} onRetry={docs.reload} />}
      {docs.data && docs.data.items.length === 0 && <Empty title="No documents match">{canUpload ? "Upload files or adjust the filters." : "Adjust the filters."}</Empty>}
      {docs.data && docs.data.items.length > 0 && (
        <TableWrap>
          <thead>
            <tr><Th>File</Th><Th>Collection</Th><Th>Status</Th><Th>Pages / chunks</Th><Th>Size</Th><Th>Uploaded</Th><Th className="relative"><span className="sr-only">Actions</span></Th></tr>
          </thead>
          <tbody>
            {docs.data.items.map((d) => (
              <tr key={d.id} className="hover:bg-panel-2">
                <Td>
                  <Link id={`doc-${d.id}`} href={`/documents/${d.id}`} className="font-medium hover:underline">{d.filename}</Link>
                  <div className="text-xs uppercase text-muted">{d.file_type}{d.extraction_method === "ocr" || d.extraction_method === "mixed" ? " · OCR" : ""}</div>
                </Td>
                <Td className="text-muted">{d.collection_name}</Td>
                <Td>
                  <StatusBadge status={d.status} />
                  {d.latest_job && ["running", "retry_wait"].includes(d.latest_job.status) && (
                    <div className="mt-0.5 text-xs text-muted">{d.latest_job.stage ?? d.latest_job.status} · attempt {d.latest_job.attempt_count}/{d.latest_job.max_attempts}</div>
                  )}
                  {d.status === "failed" && d.latest_job?.safe_error_message && <div className="mt-0.5 max-w-xs text-xs text-bad">{d.latest_job.safe_error_message}</div>}
                  {d.warnings.length > 0 && <div className="mt-0.5 text-xs text-warn">{d.warnings.length} warning{d.warnings.length > 1 ? "s" : ""}</div>}
                </Td>
                <Td className="tabular-nums">{d.page_count ?? "—"} / {d.chunk_count ?? "—"}</Td>
                <Td className="tabular-nums text-muted">{formatBytes(d.size_bytes)}</Td>
                <Td className="text-muted">{formatTime(d.created_at)}</Td>
                <Td className="whitespace-nowrap text-right">
                  <span className="inline-flex gap-1.5">
                    {mayDownload(d) && (
                      <a href={`/api/v1/documents/${d.id}/download`} download aria-label={`Download ${d.filename}`} className={LINK_BUTTON}>Download</a>
                    )}
                    {mayRetry(d) && (
                      <Button
                        aria-label={`Retry ${d.filename}`}
                        aria-disabled={retrying === d.id || undefined}
                        onClick={() => void retry(d)}
                      >
                        {retrying === d.id ? "Retrying…" : "Retry"}
                      </Button>
                    )}
                    {mayDelete(d) && (
                      <Button
                        variant="danger"
                        aria-label={`Delete ${d.filename}`}
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDelete(d);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Dialog open={pendingDelete !== null} title="Delete this document?" onClose={() => setPendingDelete(null)}>
        <p className="text-sm [overflow-wrap:anywhere]">
          <span className="font-medium">{pendingDelete?.filename}</span> will be deleted, along with its chunks and vectors.
        </p>
        {deleteError && <p role="alert" className="mt-3 text-sm text-bad">{deleteError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button data-autofocus onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button variant="danger" aria-disabled={deleteBusy || undefined} onClick={() => void confirmDelete()}>
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
