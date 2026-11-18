"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icons";
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { announce } from "@/lib/announce";
import { api, ApiError, errorText } from "@/lib/api";
import { formatBytes, formatMs, formatTime, shortId } from "@/lib/format";
import { useApi, useCan, useMe } from "@/lib/hooks";
import type { ChunkItem, Collection, DocumentItem, Page, Pipeline } from "@/lib/types";

const ACTIVE = new Set(["queued", "processing", "deleting"]);
const CHUNK_PAGE = 50;

/** A secondary keycap drawn on a link (globals.css `.key`): 44px on touch, 36px on desktop. */
const LINK_KEY = "key max-sm:min-h-11 sm:min-h-9 sm:px-3";
const CRUMB_LINK = "rounded-sm text-text-2 underline-offset-2 hover:text-text hover:underline focus-visible:underline";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Mounted only while the document is indexed, so a new indexing run starts from a clean list. */
function IndexedChunks({ documentId, total }: { documentId: string; total: number | null }) {
  const first = useApi<Page<ChunkItem>>(`/documents/${documentId}/chunks?limit=${CHUNK_PAGE}`);
  const [later, setLater] = useState<{ items: ChunkItem[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [...(first.data?.items ?? []), ...(later?.items ?? [])];
  const next = later ? later.next : (first.data?.next_cursor ?? null);

  const loadMore = async () => {
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await api<Page<ChunkItem>>(`/documents/${documentId}/chunks?limit=${CHUNK_PAGE}&cursor=${encodeURIComponent(next)}`);
      flushSync(() => setLater((l) => ({ items: [...(l?.items ?? []), ...page.items], next: page.next_cursor })));
      // The button may be gone now, and the first new chunk is where the reader continues.
      if (page.items[0]) document.getElementById(`chunk-${page.items[0].id}`)?.focus();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {first.loading && <Loading />}
      {first.error && <ErrorState error={first.error} onRetry={first.reload} />}
      {first.data && items.length === 0 && <Empty title="No chunks" />}
      <ol className="divide-y divide-border">
        {items.map((c) => (
          <li
            key={c.id}
            id={`chunk-${c.id}`}
            tabIndex={-1}
            className="grid gap-x-6 gap-y-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)]"
          >
            <div className="flex gap-3 text-xs text-muted sm:flex-col sm:gap-1">
              <span className="font-display text-sm font-medium text-text tabular-nums">#{c.chunk_index}</span>
              <span className="tabular-nums">page {c.page_start === c.page_end ? c.page_start : `${c.page_start}–${c.page_end}`}</span>
              <span className="tabular-nums">{c.token_count} tokens</span>
            </div>
            <p className="max-w-[72ch] whitespace-pre-wrap text-sm leading-6 text-text-2">{c.text}</p>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      {next && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm text-muted tabular-nums">Showing {items.length}{total === null ? "" : ` of ${total}`} chunks</span>
          <Button aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={() => void loadMore()}>{busy ? "Loading…" : "Load more"}</Button>
        </div>
      )}
    </>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useApi<DocumentItem>(`/documents/${id}`, (d) => (ACTIVE.has(d.status) ? 2000 : null));
  const pipeline = useApi<Pipeline>(`/documents/${id}/pipeline`, (p) => (ACTIVE.has(p.status) ? 2000 : null));
  const canReadContent = useCan("document:read_content");
  const collection = useApi<Collection>(doc.data ? `/collections/${doc.data.collection_id}` : null);
  const canRetry = useCan("document:retry");
  const canManageJobs = useCan("job:manage");
  const canDelete = useCan("document:delete");
  const me = useMe();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const filename = doc.data?.filename;

  useEffect(() => {
    document.title = `${filename ?? "Document"} · RackFlow AI`;
  }, [filename]);

  if (doc.loading) return <Loading />;
  // 422: the id in the URL isn't even a valid id. Either way there is nothing here to retry.
  if (doc.error instanceof ApiError && (doc.error.status === 404 || doc.error.status === 422)) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
          <Link href="/documents" className={CRUMB_LINK}>Documents</Link> / Not found
        </nav>
        <h1 className="sr-only">Document not found</h1>
        <Empty
          title="Document not found"
          description="It may have been deleted, or you may not have access to it."
          primary={<Link href="/documents" className={LINK_KEY}>Back to Documents</Link>}
        />
      </>
    );
  }
  if (!doc.data) return <ErrorState error={doc.error} onRetry={doc.reload} />;
  const d = doc.data;
  const level = collection.data?.access_level;
  const hasWriteAccess = level === "write" || level === "manage";
  // Document retry needs write access to the collection. Operators (job:manage) have read access,
  // so they re-queue the failed read job instead, which also puts the document back in line.
  const job = d.latest_job;
  const retryableJob =
    canManageJobs && job?.job_type === "ingest_document" && (job.status === "failed" || job.status === "cancelled") ? job : null;
  // Unknown levels (still loading, or the lookup failed) are left to the API to decide.
  // A failed delete offers Delete instead: reading the file again could not restore it.
  const failedDelete = d.status === "failed" && job?.job_type === "delete_document";
  const mayRetry = canRetry && d.status === "failed" && !failedDelete && (level === undefined || hasWriteAccess || retryableJob !== null);
  // The same rule as the Documents list: the API wants write access before it looks at the uploader.
  const mayDeleteAgain =
    failedDelete && canDelete && (me.role === "org_admin" || level === undefined || level === "manage" || (level === "write" && d.uploaded_by === me.user_id));
  const mayDownload = canReadContent && !["deleting", "deleted"].includes(d.status) && level !== null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setNotice(null);
    try {
      const viaJob = hasWriteAccess ? null : retryableJob;
      await api(viaJob ? `/jobs/${viaJob.id}/retry` : `/documents/${d.id}/retry`, { method: "POST" });
      announce(`Retrying ${d.filename}.`);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setNotice(`Couldn't retry ${d.filename}. It takes write access to its collection.`);
      } else if (e instanceof ApiError && e.status === 409) {
        // Usually someone else already re-queued it, and the reload below shows that. A document
        // that is still failed was refused for good, and the reason needs saying.
        const now = await api<DocumentItem>(`/documents/${d.id}`).catch(() => null);
        if (now?.status === "failed") setNotice(`Couldn't retry ${d.filename}. ${errorText(e)}`);
      } else {
        setNotice(`Couldn't retry ${d.filename}. ${errorText(e)}`);
      }
    } finally {
      setRetrying(false);
      doc.reload();
      pipeline.reload();
    }
  };

  const deleteAgain = async () => {
    await api(`/documents/${d.id}`, { method: "DELETE" });
    // Closed before focus moves: everything behind a modal dialog is inert. The button is gone now.
    flushSync(() => setConfirmingDelete(false));
    document.getElementById("documents-crumb")?.focus();
    announce(`Deleting ${d.filename}.`);
    doc.reload();
    pipeline.reload();
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 min-w-0 text-sm text-muted [overflow-wrap:anywhere]">
        <Link id="documents-crumb" href="/documents" className="rounded-sm text-text-2 underline-offset-2 hover:text-text hover:underline focus-visible:underline">Documents</Link> / {d.filename}
      </nav>
      <PageHeader
        title={d.filename}
        description={`${d.file_type.toUpperCase()}, ${formatBytes(d.size_bytes)}, in ${d.collection_name}`}
        actions={
          <>
            <StatusBadge status={d.status} />
            {mayRetry && (
              <Button aria-busy={retrying || undefined} aria-disabled={retrying || undefined} onClick={() => void retry()}>
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            {mayDeleteAgain && <Button variant="danger" onClick={() => setConfirmingDelete(true)}>Delete again</Button>}
            {mayDownload && (
              <a
                href={`/api/v1/documents/${d.id}/download`}
                download
                className={LINK_KEY}
              >
                Download
              </a>
            )}
          </>
        }
      />
      {notice && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-card bg-bad-soft px-3 py-2 text-sm text-bad">
          <Icon name="cross" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{notice}</span>
        </p>
      )}
      {doc.error && <div className="mb-4"><ErrorState error={doc.error} onRetry={doc.reload} /></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details">
          <dl className="-my-2 divide-y divide-border">
            <Meta label="Pages">{d.page_count ?? "None"}</Meta>
            <Meta label="Chunks">{d.chunk_count ?? "None"}</Meta>
            <Meta label="Tokens (est.)">{d.token_count ?? "None"}</Meta>
            <Meta label="Extraction">{d.extraction_method ?? "None"}{d.ocr_page_count ? ` (${d.ocr_page_count} OCR pages)` : ""}</Meta>
            <Meta label="Quality score">{d.quality_score === null ? "None" : d.quality_score.toFixed(2)}</Meta>
            <Meta label="Embedding model"><span className="font-mono text-xs">{d.embedding_model ?? "None"}</span></Meta>
            <Meta label="Pipeline version"><span className="font-mono text-xs">{d.pipeline_version ?? "None"}</span></Meta>
            <Meta label="Uploaded">{formatTime(d.created_at)}</Meta>
            <Meta label="Indexed">{formatTime(d.indexed_at)}</Meta>
          </dl>
          {d.warnings.length > 0 && (
            <div className="mt-4 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              <p className="font-medium">Warnings</p>
              <ul className="mt-1 list-disc pl-5 marker:text-warn">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </Card>
        <Card title="Processing pipeline" className="lg:col-span-2">
          {pipeline.loading && <Loading />}
          {pipeline.error && <ErrorState error={pipeline.error} onRetry={pipeline.reload} />}
          {pipeline.data?.jobs.length === 0 && <p className="text-sm text-muted">No processing jobs.</p>}
          <div className="divide-y divide-border">
            {pipeline.data?.jobs.map((job) => (
              <div key={job.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <Badge>{job.job_type.replace("_", " ")}</Badge>
                  <StatusBadge status={job.status} />
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="tabular-nums">Attempt {job.attempt_count} of {job.max_attempts}</span>
                    <span>Job <span className="font-mono">{shortId(job.id)}</span></span>
                    <span className="tabular-nums">Queued {formatTime(job.queued_at)}</span>
                  </span>
                </div>
                {job.safe_error_message && (
                  <div role="alert" className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-sm">
                    <p className="flex items-start gap-2">
                      <Icon name="cross" aria-hidden="true" className="mt-0.5 shrink-0 text-bad" />
                      <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium text-bad">{job.error_code}: </span>{job.safe_error_message}</span>
                    </p>
                    {job.correlation_id && (
                      <p className="mt-1 pl-6 text-xs text-muted">Correlation ID: <span className="font-mono [overflow-wrap:anywhere]">{job.correlation_id}</span></p>
                    )}
                  </div>
                )}
                <ol className="mt-3 divide-y divide-border border-y border-border">
                  {job.stages.map((s, i) => (
                    <li key={`${s.attempt_number}-${s.stage}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="w-5 text-right text-xs text-muted tabular-nums">{s.attempt_number}</span>
                        <span className="font-medium">{s.stage.replace("_", " ")}</span>
                        {s.error_code && <span className="font-mono text-xs text-bad">{s.error_code}</span>}
                        {Object.keys(s.details).length > 0 && (
                          <span className="hidden font-mono text-xs text-muted md:inline">
                            {Object.entries(s.details).slice(0, 3).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted tabular-nums">{formatMs(s.duration_ms)}</span>
                        <StatusBadge status={s.status} />
                      </span>
                    </li>
                  ))}
                </ol>
                {job.attempts.length > 1 && (
                  <details className="group mt-3 text-sm">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm text-text-2 hover:text-text sm:min-h-8">
                      Attempt history ({job.attempts.length})
                    </summary>
                    <ul className="mt-1 divide-y divide-border border-y border-border">
                      {job.attempts.map((a) => (
                        <li key={a.attempt_number} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2 text-xs">
                          <span className="flex flex-wrap gap-x-3 gap-y-1">
                            <span className="tabular-nums">#{a.attempt_number}</span>
                            <span className="font-mono">{a.worker_id}</span>
                            <span className="text-muted tabular-nums">{formatTime(a.started_at)}</span>
                          </span>
                          <span>{a.status}{a.error_code ? ` (${a.error_code})` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Indexed chunks" className="lg:col-span-3">
          {!canReadContent && <p className="text-sm text-muted">Your role can view metadata only, not document content.</p>}
          {canReadContent && d.status !== "indexed" && <p className="text-sm text-muted">Chunks appear once indexing completes.</p>}
          {canReadContent && d.status === "indexed" && <IndexedChunks key={d.id} documentId={d.id} total={d.chunk_count} />}
        </Card>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this document again?"
        confirmLabel="Delete"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={deleteAgain}
      >
        <p className="[overflow-wrap:anywhere]">The last attempt to delete <span className="font-medium">{d.filename}</span> failed. RackFlow will try again to remove it, along with its chunks and vectors.</p>
      </ConfirmDialog>
    </>
  );
}
