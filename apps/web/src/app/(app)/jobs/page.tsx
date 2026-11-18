"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { Icon } from "@/components/icons";
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

/** Field label: sentence case in the body face, above its control. */
const FIELD_LABEL = "mb-1 block text-sm font-medium text-text";
/** Tertiary action drawn as text: the accent, underlined on hover, 44px on touch. */
const TEXT_BUTTON =
  "inline-flex min-h-11 items-center rounded-sm text-accent underline-offset-2 hover:underline focus-visible:underline sm:min-h-8";
/** A ruled detail row inside the job dialog. */
const ROW = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-xs";

/** queued_at never changes, so a retry shows in available_at. A job in retry_wait shows that time
 *  as its next attempt instead. */
function requeuedAt(j: Job): string | null {
  if (j.status === "retry_wait") return null;
  return new Date(j.available_at).getTime() - new Date(j.queued_at).getTime() > 1000 ? j.available_at : null;
}

function JobDrawer({ jobId, onClose, onChanged }: { jobId: string; onClose: () => void; onChanged: () => void }) {
  const job = useApi<JobDetail>(`/jobs/${jobId}`, (j) => (["queued", "running", "retry_wait"].includes(j.status) ? 2000 : null));
  const canManage = useCan("job:manage");
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const act = async (action: "retry" | "cancel") => {
    setError(null);
    setConfirmingCancel(false);
    try {
      await api(`/jobs/${jobId}/${action}`, { method: "POST" });
      job.reload();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const j = job.data;
  const requeued = j ? requeuedAt(j) : null;
  return (
    <>
    <Dialog open title={`Job ${shortId(jobId)}`} onClose={onClose} wide>
      {job.loading && <Loading />}
      {job.error && <ErrorState error={job.error} onRetry={job.reload} />}
      {j && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusBadge status={j.status} />
            <Badge>{j.job_type}</Badge>
            {j.cancel_requested && j.status === "running" && <Badge tone="warn">Cancellation requested</Badge>}
            <span className="flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
              <span>Attempt {j.attempt_count} of {j.max_attempts}</span>
              <span>Priority {j.priority}</span>
            </span>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 border-y border-border py-3 tabular-nums sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <dt className="text-muted">Document</dt>
            <dd className="[overflow-wrap:anywhere]">{j.document_id ? <Link className="text-accent underline-offset-2 hover:underline focus-visible:underline" href={`/documents/${j.document_id}`}>{j.document_filename ?? shortId(j.document_id)}</Link> : "None"}</dd>
            <dt className="text-muted">Queued</dt><dd>{formatTime(j.queued_at)}</dd>
            {requeued && (<><dt className="text-muted">Re-queued</dt><dd>{formatTime(requeued)}</dd></>)}
            <dt className="text-muted">Started</dt><dd>{formatTime(j.started_at)}</dd>
            <dt className="text-muted">Finished</dt><dd>{formatTime(j.finished_at)}</dd>
            {j.status === "retry_wait" && (<><dt className="text-muted">Next attempt</dt><dd>{formatTime(j.available_at)}</dd></>)}
            <dt className="text-muted">Correlation ID</dt><dd className="font-mono text-xs [overflow-wrap:anywhere]">{j.correlation_id ?? "None"}</dd>
          </dl>
          {j.safe_error_message && (
            <div role="alert" className="flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2">
              <Icon name="cross" aria-hidden="true" className="mt-0.5 shrink-0 text-bad" />
              <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium text-bad">{j.error_code}: </span>{j.safe_error_message}</span>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-base">Attempts</h3>
            <ul className="divide-y divide-border border-y border-border empty:hidden">
              {j.attempts.map((a) => (
                <li key={a.attempt_number} className={ROW}>
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="tabular-nums">#{a.attempt_number}</span>
                    <span className="font-mono">{a.worker_id}</span>
                    <span className="text-muted tabular-nums">{formatTime(a.started_at)}</span>
                    {a.stage && <span className="text-muted">Stage {a.stage}</span>}
                  </span>
                  <span className="flex flex-wrap gap-x-2">
                    <span>{a.status}</span>
                    {a.error_code && <span className="font-mono text-bad">{a.error_code}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-base">Stage timeline</h3>
            <ol className="divide-y divide-border border-y border-border empty:hidden">
              {j.stages.map((s, i) => (
                <li key={i} className={ROW}>
                  <span className="flex flex-wrap gap-x-2 gap-y-1">
                    <span className="text-muted tabular-nums">#{s.attempt_number}</span>
                    <span className="font-medium">{s.stage}</span>
                    {s.error_code && <span className="font-mono text-bad">{s.error_code}</span>}
                  </span>
                  <span className="flex items-center gap-2"><span className="text-muted tabular-nums">{formatMs(s.duration_ms)}</span> <StatusBadge status={s.status} /></span>
                </li>
              ))}
            </ol>
          </div>
          {error && <p role="alert" className="text-bad">{error}</p>}
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2">
              {["failed", "cancelled"].includes(j.status) && <Button variant="primary" onClick={() => act("retry")}>Retry job</Button>}
              {["queued", "retry_wait", "running"].includes(j.status) && !j.cancel_requested && (
                <Button variant="danger" onClick={() => setConfirmingCancel(true)}>Cancel job</Button>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
    {/* A sibling, not a child: Esc closes this one and leaves the job open. */}
    <Dialog open={confirmingCancel} title="Cancel this job?" onClose={() => setConfirmingCancel(false)}>
      <p className="text-sm">Running jobs stop at the next stage boundary.</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button data-autofocus onClick={() => setConfirmingCancel(false)}>Keep job</Button>
        <Button variant="danger" onClick={() => void act("cancel")}>Cancel job</Button>
      </div>
    </Dialog>
    </>
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
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-0 max-sm:w-full">
          <label htmlFor="j-status" className={FIELD_LABEL}>Status</label>
          <select id="j-status" className={inputClass} value={status} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="min-w-0 max-sm:w-full">
          <label htmlFor="j-type" className={FIELD_LABEL}>Type</label>
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
              <tr><Th>Job</Th><Th>Type</Th><Th>Status</Th><Th>Document</Th><Th className="text-right">Attempts</Th><Th>Queued</Th><Th>Finished</Th></tr>
            </thead>
            <tbody>
              {jobs.data.items.map((j) => (
                <tr key={j.id} className="transition-colors duration-[var(--dur-micro)] hover:bg-panel-2">
                  <Td>
                    <button type="button" className={`${TEXT_BUTTON} -my-3.5 align-top font-mono text-xs sm:-my-2`} onClick={() => setOpen(j.id)}>
                      {shortId(j.id)}
                    </button>
                  </Td>
                  <Td className="font-mono text-xs text-text-2">{j.job_type}</Td>
                  <Td>
                    <StatusBadge status={j.status} />
                    {j.stage && j.status === "running" && <div className="mt-1 text-xs text-muted">{j.stage}</div>}
                    {j.error_code && <div className={`mt-1 font-mono text-xs ${j.status === "cancelled" ? "text-muted" : "text-bad"}`}>{j.error_code}</div>}
                  </Td>
                  <Td className="max-w-56 truncate">{j.document_filename ?? <span className="text-muted">None</span>}</Td>
                  <Td className="text-right tabular-nums">{j.attempt_count}/{j.max_attempts}</Td>
                  <Td className="whitespace-nowrap text-muted tabular-nums">
                    {formatTime(j.queued_at)}
                    {requeuedAt(j) && <div className="text-xs">Re-queued {formatTime(requeuedAt(j))}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-muted tabular-nums">{formatTime(j.finished_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
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
