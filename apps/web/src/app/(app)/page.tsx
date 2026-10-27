"use client";

import Link from "next/link";
import { RequirePermission } from "@/components/Shell";
import { Card, ErrorState, Kpi, Loading, PageHeader, StatusBadge, UpdatedAt } from "@/components/ui";
import { formatAge, formatMs } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ModelHealth, OpsMetrics, OpsSummary, Worker } from "@/lib/types";

function Throughput({ metrics }: { metrics: OpsMetrics }) {
  const max = Math.max(1, ...metrics.buckets.map((b) => b.succeeded + b.failed));
  return (
    <div>
      <div className="flex h-28 items-end gap-1" role="img" aria-label="Jobs finished per 5-minute bucket, last hour">
        {metrics.buckets.map((b) => (
          <div key={b.start} className="flex h-full flex-1 flex-col justify-end" title={`${new Date(b.start).toLocaleTimeString()}: ${b.succeeded} succeeded, ${b.failed} failed`}>
            <div className="bg-bad" style={{ height: `${(b.failed / max) * 100}%` }} />
            <div className="rounded-t-sm bg-accent" style={{ height: `${(b.succeeded / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />Succeeded</span>
        <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-bad" />Failed</span>
        <span>Avg duration {formatMs(metrics.avg_job_duration_ms)} · p95 {formatMs(metrics.p95_job_duration_ms)}</span>
        <span>Error rate {metrics.error_rate === null ? "—" : `${(metrics.error_rate * 100).toFixed(1)}%`}</span>
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
      {summary.loading && <Loading />}
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Kpi label="Indexed documents" value={summary.data.documents.indexed ?? 0} />
          <Kpi label="Indexed chunks" value={summary.data.indexed_chunks} />
          <Kpi label="Queue depth" value={summary.data.queue_depth} hint={`Oldest ${formatAge(summary.data.oldest_queued_age_seconds)}`} />
          <Kpi label="Running jobs" value={summary.data.jobs.running} />
          <Kpi label="Failed jobs" value={summary.data.jobs.failed} hint={<Link href="/jobs?status=failed" className="underline">Inspect failures</Link>} />
          <Kpi label="Workers healthy" value={`${summary.data.workers.healthy}/${summary.data.workers.total}`} hint={summary.data.workers.stale ? `${summary.data.workers.stale} stale` : undefined} />
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Job throughput (last hour)" className="lg:col-span-2">
          {metrics.error && <ErrorState error={metrics.error} />}
          {metrics.data && <Throughput metrics={metrics.data} />}
        </Card>
        <Card title="Model endpoint">
          {model.error && <ErrorState error={model.error} />}
          {model.data && (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Status</dt><dd><StatusBadge status={model.data.ok ? "healthy" : "failed"} label={model.data.ok ? "Available" : "Unavailable"} /></dd></div>
              <div className="flex justify-between"><dt className="text-muted">Provider</dt><dd>{model.data.provider}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Model</dt><dd className="font-mono text-xs">{model.data.model}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Mode</dt><dd>{model.data.deployment_mode}</dd></div>
              <p className="pt-1 text-xs text-muted">{model.data.detail}</p>
            </dl>
          )}
        </Card>
        <Card title="Pipeline status" className="lg:col-span-1">
          {summary.data && (
            <ul className="space-y-1.5 text-sm">
              {(["queued", "running", "retry_wait", "succeeded", "failed", "cancelled"] as const).map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <StatusBadge status={s} />
                  <Link className="tabular-nums hover:underline" href={`/jobs?status=${s}`}>{summary.data!.jobs[s]}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Workers" className="lg:col-span-2">
          {workers.error && <ErrorState error={workers.error} />}
          {workers.data && workers.data.items.length === 0 && (
            <p className="text-sm text-muted">No workers have reported in the last 24 hours. Start one with <code className="font-mono">rackflow-worker</code>.</p>
          )}
          <ul className="divide-y divide-border">
            {workers.data?.items.slice(0, 6).map((w) => (
              <li key={w.worker_id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="font-mono text-xs">{w.worker_id}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted">{w.jobs_succeeded} ok · {w.jobs_failed} failed</span>
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
