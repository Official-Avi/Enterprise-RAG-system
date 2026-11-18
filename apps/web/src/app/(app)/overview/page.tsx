"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RequirePermission } from "@/components/Shell";
import { Card, cx, ErrorState, PageHeader, StatusBadge, UpdatedAt } from "@/components/ui";
import { formatAge, formatMs } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ModelHealth, OpsMetrics, OpsSummary, Worker } from "@/lib/types";

/** A count that opens the filtered list: ink with a quiet underline, the accent on hover. */
const countLink =
  "inline-flex min-h-11 min-w-11 items-center justify-end tabular-nums text-text underline decoration-border-2 " +
  "underline-offset-4 transition-colors duration-[var(--dur-micro)] hover:text-accent hover:decoration-accent " +
  "active:text-accent-hover sm:min-h-8 sm:min-w-8";

/** Region placeholder in the shape of what is coming. The status text is for screen readers. */
function Skeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div role="status" className={cx("space-y-3", className)}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-4 motion-safe:animate-shimmer rounded-sm bg-panel-3" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

/** One figure in the ruled stat row. */
function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-panel px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl leading-none font-semibold text-text tabular-nums">{value}</dd>
      {hint && <dd className="mt-2 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function StatRowSkeleton() {
  return (
    <div role="status" className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} aria-hidden="true" className="bg-panel px-4 py-3">
          <div className="h-3 w-20 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
          <div className="mt-2 h-6 w-12 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
        </div>
      ))}
    </div>
  );
}

function Throughput({ metrics }: { metrics: OpsMetrics }) {
  const max = Math.max(1, ...metrics.buckets.map((b) => b.succeeded + b.failed));
  return (
    <div>
      <div className="flex h-32 items-end gap-1 border-b border-border-2" role="img" aria-label="Jobs finished per 5-minute bucket, last hour">
        {metrics.buckets.map((b) => (
          <div key={b.start} className="flex h-full flex-1 flex-col justify-end gap-px" title={`${new Date(b.start).toLocaleTimeString()}: ${b.succeeded} succeeded, ${b.failed} failed`}>
            {b.failed > 0 && <div className="rounded-t-sm bg-bad" style={{ height: `${(b.failed / max) * 100}%` }} />}
            {b.succeeded > 0 && (
              <div className={cx("bg-accent", b.failed === 0 && "rounded-t-sm")} style={{ height: `${(b.succeeded / max) * 100}%` }} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-accent" />Succeeded</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-bad" />Failed</span>
        {metrics.avg_job_duration_ms == null && metrics.p95_job_duration_ms == null && metrics.error_rate == null ? (
          <span>No jobs finished in the last hour</span>
        ) : (
          <>
            {metrics.avg_job_duration_ms != null && <span className="tabular-nums">Avg duration {formatMs(metrics.avg_job_duration_ms)}</span>}
            {metrics.p95_job_duration_ms != null && <span className="tabular-nums">p95 {formatMs(metrics.p95_job_duration_ms)}</span>}
            {metrics.error_rate != null && <span className="tabular-nums">Error rate {(metrics.error_rate * 100).toFixed(1)}%</span>}
          </>
        )}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const summary = useApi<OpsSummary>("/operations/summary", 5000);
  const metrics = useApi<OpsMetrics>("/operations/metrics?window=1h", 15000);
  const workers = useApi<{ items: Worker[] }>("/operations/workers", 5000);
  const model = useApi<ModelHealth>("/models/health", 30000);

  return (
    <RequirePermission permission="ops:read">
      <PageHeader
        title="Overview"
        description="Processing pipeline, workers and model serving for this workspace."
        actions={<UpdatedAt at={summary.updatedAt} />}
      />
      {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {summary.loading && <StatRowSkeleton />}
      {summary.data && (
        // gap-px over a border-coloured ground draws the rules between figures at any column count.
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Indexed documents" value={summary.data.documents.indexed ?? 0} />
          <Stat label="Indexed chunks" value={summary.data.indexed_chunks} />
          <Stat label="Queue depth" value={summary.data.queue_depth} hint={summary.data.oldest_queued_age_seconds == null ? "No jobs waiting" : `Oldest ${formatAge(summary.data.oldest_queued_age_seconds)}`} />
          <Stat label="Running jobs" value={summary.data.jobs.running} />
          <Stat
            label="Failed jobs"
            value={summary.data.jobs.failed}
            hint={
              <Link
                href="/jobs?status=failed"
                className="inline-flex min-h-11 items-center text-accent underline underline-offset-2 hover:text-accent-hover active:text-accent-hover sm:min-h-6"
              >
                Inspect failures
              </Link>
            }
          />
          <Stat
            label="Workers healthy"
            value={`${summary.data.workers.healthy}/${summary.data.workers.total}`}
            hint={summary.data.workers.stale ? `${summary.data.workers.stale} stale` : undefined}
          />
        </dl>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Job throughput (last hour)" className="lg:col-span-2">
          {metrics.loading && <Skeleton rows={4} className="py-2" />}
          {metrics.error && <ErrorState error={metrics.error} onRetry={metrics.reload} />}
          {metrics.data && <Throughput metrics={metrics.data} />}
        </Card>
        <Card title="Model endpoint">
          {model.loading && <Skeleton rows={4} />}
          {model.error && <ErrorState error={model.error} onRetry={model.reload} />}
          {model.data && (
            <>
              <dl className="divide-y divide-border text-sm">
                <div className="flex min-h-10 items-center justify-between gap-3 py-2"><dt className="text-muted">Status</dt><dd><StatusBadge status={model.data.ok ? "healthy" : "failed"} label={model.data.ok ? "Available" : "Unavailable"} /></dd></div>
                <div className="flex min-h-10 items-center justify-between gap-3 py-2"><dt className="text-muted">Provider</dt><dd className="text-right wrap-anywhere">{model.data.provider}</dd></div>
                <div className="flex min-h-10 items-center justify-between gap-3 py-2"><dt className="text-muted">Model</dt><dd className="text-right font-mono text-xs wrap-anywhere">{model.data.model}</dd></div>
                <div className="flex min-h-10 items-center justify-between gap-3 py-2"><dt className="text-muted">Mode</dt><dd className="text-right">{model.data.deployment_mode}</dd></div>
              </dl>
              {/* Outside the <dl>: a <dl> may only hold dt/dd groups. */}
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted">{model.data.detail}</p>
            </>
          )}
        </Card>
        <Card title="Pipeline status" className="lg:col-span-1">
          {summary.loading && <Skeleton rows={6} />}
          {summary.error && !summary.data && <p className="text-sm text-muted">Unavailable until the summary above loads.</p>}
          {summary.data && (
            <ul className="divide-y divide-border text-sm">
              {(["queued", "running", "retry_wait", "succeeded", "failed", "cancelled"] as const).map((s) => (
                <li key={s} className="flex items-center justify-between gap-3">
                  <StatusBadge status={s} />
                  <Link className={countLink} href={`/jobs?status=${s}`}>{summary.data!.jobs[s]}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Workers" className="lg:col-span-2">
          {workers.loading && <Skeleton rows={4} />}
          {workers.error && <ErrorState error={workers.error} onRetry={workers.reload} />}
          {workers.data && workers.data.items.length === 0 && (
            <p className="text-sm text-text-2">No workers have reported in the last 24 hours. Start one with <code className="font-mono text-xs">rackflow-worker</code>.</p>
          )}
          <ul className="divide-y divide-border">
            {workers.data?.items.slice(0, 6).map((w) => (
              <li key={w.worker_id} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0 font-mono text-xs wrap-anywhere text-text">{w.worker_id}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted tabular-nums">{w.jobs_succeeded} ok, {w.jobs_failed} failed</span>
                  <StatusBadge status={w.health} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </RequirePermission>
  );
}
