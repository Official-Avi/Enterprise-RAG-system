"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { announce } from "@/lib/announce";
import { api, ApiError, errorText } from "@/lib/api";
import { formatBytes, formatMs, formatTime, shortId } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { ChunkItem, Collection, DocumentItem, Page, Pipeline } from "@/lib/types";

const ACTIVE = new Set(["queued", "processing", "deleting"]);

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useApi<DocumentItem>(`/documents/${id}`, (d) => (ACTIVE.has(d.status) ? 2000 : null));
  const pipeline = useApi<Pipeline>(`/documents/${id}/pipeline`, (p) => (ACTIVE.has(p.status) ? 2000 : null));
  const canReadContent = useCan("document:read_content");
  const chunks = useApi<Page<ChunkItem>>(canReadContent && doc.data?.status === "indexed" ? `/documents/${id}/chunks?limit=50` : null);
  const collection = useApi<Collection>(doc.data ? `/collections/${doc.data.collection_id}` : null);
  const canRetry = useCan("document:retry");
  const canManageJobs = useCan("job:manage");
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
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted">
          <Link href="/documents" className="hover:underline">Documents</Link> / Not found
        </nav>
        <h1 className="sr-only">Document not found</h1>
        <Empty
          title="Document not found"
          description="It may have been deleted, or you may not have access to it."
          primary={<Link href="/documents" className="underline">Back to Documents</Link>}
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
  const mayRetry = canRetry && d.status === "failed" && (level === undefined || hasWriteAccess || retryableJob !== null);
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
        setNotice(`Your role can't retry ${d.filename}. An Engineer or Admin can.`);
      } else if (!(e instanceof ApiError && e.status === 409)) {
        // 409: someone else already re-queued it, and the reload below shows that.
        setNotice(`Couldn't retry ${d.filename}. ${errorText(e)}`);
      }
    } finally {
      setRetrying(false);
      doc.reload();
      pipeline.reload();
    }
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted">
        <Link href="/documents" className="hover:underline">Documents</Link> / {d.filename}
      </nav>
      <PageHeader
        title={d.filename}
        description={`${d.collection_name} · ${d.file_type.toUpperCase()} · ${formatBytes(d.size_bytes)}`}
        actions={
          <>
            <StatusBadge status={d.status} />
            {mayRetry && (
              <Button aria-disabled={retrying || undefined} onClick={() => void retry()}>
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            )}
            {mayDownload && (
              <a
                href={`/api/v1/documents/${d.id}/download`}
                download
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-panel-2"
              >
                Download
              </a>
            )}
          </>
        }
      />
      {notice && <p role="alert" className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{notice}</p>}
      {doc.error && <div className="mb-3"><ErrorState error={doc.error} onRetry={doc.reload} /></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details">
          <dl>
            <Meta label="Pages">{d.page_count ?? "—"}</Meta>
            <Meta label="Chunks">{d.chunk_count ?? "—"}</Meta>
            <Meta label="Tokens (est.)">{d.token_count ?? "—"}</Meta>
            <Meta label="Extraction">{d.extraction_method ?? "—"}{d.ocr_page_count ? ` (${d.ocr_page_count} OCR pages)` : ""}</Meta>
            <Meta label="Quality score">{d.quality_score === null ? "—" : d.quality_score.toFixed(2)}</Meta>
            <Meta label="Embedding model"><span className="font-mono text-xs">{d.embedding_model ?? "—"}</span></Meta>
            <Meta label="Pipeline version"><span className="font-mono text-xs">{d.pipeline_version ?? "—"}</span></Meta>
            <Meta label="Uploaded">{formatTime(d.created_at)}</Meta>
            <Meta label="Indexed">{formatTime(d.indexed_at)}</Meta>
          </dl>
          {d.warnings.length > 0 && (
            <div className="mt-3 rounded-md bg-warn-soft p-2.5 text-sm text-warn">
              <p className="font-medium">Warnings</p>
              <ul className="mt-1 list-disc pl-5">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </Card>
        <Card title="Processing pipeline" className="lg:col-span-2">
          {pipeline.loading && <Loading />}
          {pipeline.error && <ErrorState error={pipeline.error} onRetry={pipeline.reload} />}
          {pipeline.data?.jobs.length === 0 && <p className="text-sm text-muted">No processing jobs.</p>}
          <div className="space-y-5">
            {pipeline.data?.jobs.map((job) => (
              <div key={job.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge>{job.job_type.replace("_", " ")}</Badge>
                  <StatusBadge status={job.status} />
                  <span className="text-xs text-muted">attempt {job.attempt_count}/{job.max_attempts} · job {shortId(job.id)} · queued {formatTime(job.queued_at)}</span>
                </div>
                {job.safe_error_message && (
                  <div role="alert" className="mt-2 rounded-md bg-bad-soft px-3 py-2 text-sm">
                    <span className="font-medium text-bad">{job.error_code}: </span>{job.safe_error_message}
                    {job.correlation_id && <div className="font-mono text-xs text-muted">Correlation ID: {job.correlation_id}</div>}
                  </div>
                )}
                <ol className="mt-2 space-y-1">
                  {job.stages.map((s, i) => (
                    <li key={`${s.attempt_number}-${s.stage}-${i}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-sm">
                      <span className="flex items-center gap-2">
                        <span className="w-5 text-right text-xs text-muted tabular-nums">{s.attempt_number}</span>
                        <span className="font-medium">{s.stage.replace("_", " ")}</span>
                        {s.error_code && <span className="text-xs text-bad">{s.error_code}</span>}
                        {Object.keys(s.details).length > 0 && (
                          <span className="hidden text-xs text-muted md:inline">
                            {Object.entries(s.details).slice(0, 3).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}
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
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted">Attempt history ({job.attempts.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {job.attempts.map((a) => (
                        <li key={a.attempt_number} className="flex justify-between text-xs">
                          <span>#{a.attempt_number} · {a.worker_id} · {formatTime(a.started_at)}</span>
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
          {chunks.error && <ErrorState error={chunks.error} onRetry={chunks.reload} />}
          {chunks.data && chunks.data.items.length === 0 && <Empty title="No chunks" />}
          <ol className="space-y-2">
            {chunks.data?.items.map((c) => (
              <li key={c.id} id={`chunk-${c.id}`} className="rounded-md border border-border p-3">
                <div className="mb-1 flex gap-3 text-xs text-muted">
                  <span>#{c.chunk_index}</span>
                  <span>page {c.page_start === c.page_end ? c.page_start : `${c.page_start}–${c.page_end}`}</span>
                  <span>{c.token_count} tokens</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{c.text}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
