"use client";

import { useState, type ReactNode } from "react";
import { RequirePermission } from "@/components/Shell";
import { Card, ErrorState, inputClass, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { formatMs } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ModelHealth, ModelInfo, ModelMetrics } from "@/lib/types";

/** One endpoint fact: label left, value right, ruled from the next. */
function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 first:pt-0 last:border-b-0 last:pb-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={mono ? "min-w-0 text-right font-mono text-xs wrap-anywhere" : "min-w-0 text-right wrap-anywhere"}>{children}</dd>
    </div>
  );
}

/** A measured figure in the metrics grid. Same cell as the /overview stat row: the grid's gap-px draws the rules. */
function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-panel p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl leading-none font-semibold text-text tabular-nums wrap-anywhere">{value}</dd>
      {hint && <dd className="mt-2 text-xs text-muted tabular-nums">{hint}</dd>}
    </div>
  );
}

export default function ModelsPage() {
  const [range, setRange] = useState("1h");
  const models = useApi<{ items: ModelInfo[] }>("/models");
  const health = useApi<ModelHealth>("/models/health", 30000);
  const metrics = useApi<ModelMetrics>(`/models/metrics?window=${range}`, 15000);
  const m = models.data?.items[0];

  return (
    <RequirePermission permission="model:read">
      <PageHeader title="Model serving" description="The configured inference endpoint, its health and measured request metrics. Credentials are never displayed." />
      {models.loading && <Loading />}
      {models.error && <ErrorState error={models.error} onRetry={models.reload} />}
      {m && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Configured endpoint">
            <dl className="text-sm">
              <Fact label="Provider">{m.provider}</Fact>
              <Fact label="Model" mono>{m.name}</Fact>
              <Fact label="Deployment">{m.deployment_mode}</Fact>
              <Fact label="Timeout"><span className="tabular-nums">{m.timeout_seconds}s</span></Fact>
              <Fact label="Concurrency limit"><span className="tabular-nums">{m.max_concurrency}</span> per API process</Fact>
            </dl>
            {m.provider === "extractive" && (
              <p className="mt-4 rounded-sm bg-warn-soft px-3 py-2 text-xs text-warn">
                Extractive mode is a built-in fallback that quotes retrieved passages. Configure <code className="font-mono">MODEL_PROVIDER=anthropic</code> or <code className="font-mono">openai_compatible</code> for generated answers.
              </p>
            )}
          </Card>
          <Card title="Health">
            {health.loading && <Loading />}
            {health.error && <ErrorState error={health.error} onRetry={health.reload} />}
            {health.data && (
              <div className="space-y-3 text-sm">
                <StatusBadge status={health.data.ok ? "healthy" : "failed"} label={health.data.ok ? "Available" : "Unavailable"} />
                <p className="text-text-2">{health.data.detail}</p>
                {health.data.latency_ms !== null && <p className="text-xs text-muted">Check latency <span className="font-mono tabular-nums">{formatMs(health.data.latency_ms)}</span></p>}
              </div>
            )}
          </Card>
          <Card
            title="Request metrics"
            actions={
              <select aria-label="Time window" className={`${inputClass} h-8! w-28! py-0! max-sm:h-11!`} value={range} onChange={(e) => setRange(e.target.value)}>
                <option value="1h">1 hour</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
              </select>
            }
          >
            {metrics.loading && <Loading />}
            {metrics.error && <ErrorState error={metrics.error} onRetry={metrics.reload} />}
            {metrics.data && (
              <dl className="-m-4 grid grid-cols-2 gap-px overflow-hidden rounded-b-card bg-border">
                <Metric label="Requests" value={metrics.data.requests.toLocaleString()} />
                <Metric label="Error rate" value={metrics.data.error_rate === null ? "—" : `${(metrics.data.error_rate * 100).toFixed(1)}%`} hint={`${metrics.data.timeouts} timeouts`} />
                <Metric label="Avg latency" value={formatMs(metrics.data.avg_latency_ms)} />
                <Metric label="p95 latency" value={formatMs(metrics.data.p95_latency_ms)} />
                <Metric label="Prompt tokens" value={metrics.data.prompt_tokens.toLocaleString()} />
                <Metric label="Output tokens" value={metrics.data.completion_tokens.toLocaleString()} />
              </dl>
            )}
          </Card>
        </div>
      )}
      <p className="mt-4 max-w-[72ch] text-xs text-muted">
        Metrics are measured from real requests in this workspace. No throughput or concurrency capacity is claimed until load-tested on the target hardware.
      </p>
    </RequirePermission>
  );
}
