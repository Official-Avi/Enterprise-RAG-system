"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Badge,
  Button,
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
import { api, errorText } from "@/lib/api";
import { formatMs, formatTime, shortId } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { Job, JobDetail, Page } from "@/lib/types";

const STATUSES = ["queued", "running", "retry_wait", "succeeded", "failed", "cancelled"];
const TYPES = ["ingest_document", "delete_document", "evaluation_run"];

function JobDrawer({ jobId, onClose, onChanged }: { jobId: string; onClose: () => void; onChanged: () => void }) {
  const job = useApi<JobDetail>(`/jobs/${jobId}`, (j) => (["queued", "running", "retry_wait"].includes(j.status) ? 2000 : null));
  const canManage = useCan("job:manage");
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "retry" | "cancel") => {
    setError(null);
    try {
      await api(`/jobs/${jobId}/${action}`, { method: "POST" });
      job.reload();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const j = job.data;
  return (
    <Dialog open title={`Job ${shortId(jobId)}`} onClose={onClose} wide>
      {job.loading && <Loading />}
      {job.error && <ErrorState error={job.error} />}
      {j && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={j.status} />
            <Badge>{j.job_type}</Badge>
            {j.cancel_requested && j.status === "running" && <Badge tone="warn">Cancellation requested</Badge>}
            <span className="text-xs text-muted">attempt {j.attempt_count}/{j.max_attempts} · priority {j.priority}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            <dt className="text-muted">Document</dt>
            <dd>{j.document_id ? <Link className="underline" href={`/documents/${j.document_id}`}>{j.document_filename ?? shortId(j.document_id)}</Link> : "—"}</dd>
            <dt className="text-muted">Queued</dt><dd>{formatTime(j.queued_at)}</dd>
            <dt className="text-muted">Started</dt><dd>{formatTime(j.started_at)}</dd>
            <dt className="text-muted">Finished</dt><dd>{formatTime(j.finished_at)}</dd>
            {j.status === "retry_wait" && (<><dt className="text-muted">Next attempt</dt><dd>{formatTime(j.available_at)}</dd></>)}
            <dt className="text-muted">Correlation ID</dt><dd className="font-mono text-xs">{j.correlation_id ?? "—"}</dd>
          </dl>
          {j.safe_error_message && (
            <div role="alert" className="rounded-md bg-bad-soft px-3 py-2"><span className="font-medium text-bad">{j.error_code}: </span>{j.safe_error_message}</div>
          )}
          <div>
            <h3 className="mb-1 font-medium">Attempts</h3>
            <ul className="space-y-1">
              {j.attempts.map((a) => (
                <li key={a.attempt_number} className="flex justify-between rounded border border-border px-2 py-1 text-xs">
                  <span>#{a.attempt_number} · {a.worker_id} · {formatTime(a.started_at)}{a.stage ? ` · stage ${a.stage}` : ""}</span>
                  <span>{a.status}{a.error_code ? ` · ${a.error_code}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-medium">Stage timeline</h3>
            <ol className="space-y-1">
              {j.stages.map((s, i) => (
                <li key={i} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
                  <span>#{s.attempt_number} {s.stage}{s.error_code ? ` · ${s.error_code}` : ""}</span>
                  <span className="flex items-center gap-2">{formatMs(s.duration_ms)} <StatusBadge status={s.status} /></span>
                </li>
              ))}
            </ol>
          </div>
          {error && <p role="alert" className="text-bad">{error}</p>}
          {canManage && (
            <div className="flex justify-end gap-2">
              {["failed", "cancelled"].includes(j.status) && <Button variant="primary" onClick={() => act("retry")}>Retry job</Button>}
              {["queued", "retry_wait", "running"].includes(j.status) && !j.cancel_requested && (
                <Button variant="danger" onClick={() => window.confirm("Cancel this job? Running jobs stop at the next stage boundary.") && act("cancel")}>Cancel job</Button>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function JobsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "";
  const type = params.get("job_type") ?? "";
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ limit: "50" });
  if (status) qs.set("status", status);
  if (type) qs.set("job_type", type);
  if (cursor) qs.set("cursor", cursor);
  const jobs = useApi<Page<Job>>(`/jobs?${qs}`, 4000);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setCursor(null);
    router.replace(`/jobs?${next}`);
  };

  return (
    <RequirePermission permission="job:read">
      <PageHeader title="Job queue" description="Durable processing jobs with retries, attempts and stage history." actions={<UpdatedAt at={jobs.updatedAt} />} />
      <div className="mb-3 flex flex-wrap gap-3">
        <div>
          <label htmlFor="j-status" className="mb-1 block text-xs font-medium text-muted">Status</label>
          <select id="j-status" className={inputClass} value={status} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="j-type" className="mb-1 block text-xs font-medium text-muted">Type</label>
          <select id="j-type" className={inputClass} value={type} onChange={(e) => setParam("job_type", e.target.value)}>
            <option value="">All</option>
            {TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {jobs.loading && <Loading />}
      {jobs.error && <ErrorState error={jobs.error} onRetry={jobs.reload} />}
      {jobs.data?.items.length === 0 && <Empty title="No jobs match these filters" />}
      {jobs.data && jobs.data.items.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr><Th>Job</Th><Th>Type</Th><Th>Status</Th><Th>Document</Th><Th>Attempts</Th><Th>Queued</Th><Th>Finished</Th></tr>
            </thead>
            <tbody>
              {jobs.data.items.map((j) => (
                <tr key={j.id} className="hover:bg-panel-2">
                  <Td><button className="font-mono text-xs underline" onClick={() => setOpen(j.id)}>{shortId(j.id)}</button></Td>
                  <Td className="text-xs">{j.job_type}</Td>
                  <Td>
                    <StatusBadge status={j.status} />
                    {j.stage && j.status === "running" && <div className="text-xs text-muted">{j.stage}</div>}
                    {j.error_code && <div className="text-xs text-bad">{j.error_code}</div>}
                  </Td>
                  <Td className="max-w-56 truncate">{j.document_filename ?? "—"}</Td>
                  <Td className="tabular-nums">{j.attempt_count}/{j.max_attempts}</Td>
                  <Td className="text-muted">{formatTime(j.queued_at)}</Td>
                  <Td className="text-muted">{formatTime(j.finished_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-3 flex justify-end gap-2">
            {cursor && <Button onClick={() => setCursor(null)}>First page</Button>}
            {jobs.data.next_cursor && <Button onClick={() => setCursor(jobs.data!.next_cursor)}>Next page</Button>}
          </div>
        </>
      )}
      {open && <JobDrawer jobId={open} onClose={() => setOpen(null)} onChanged={jobs.reload} />}
    </RequirePermission>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <JobsInner />
    </Suspense>
  );
}
