"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import { Card, ErrorState, inputClass, Kpi, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { formatMs } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ModelHealth, ModelInfo, ModelMetrics } from "@/lib/types";

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
      {models.error && <ErrorState error={models.error} />}
      {m && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Configured endpoint">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Provider</dt><dd>{m.provider}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Model</dt><dd className="font-mono text-xs">{m.name}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Deployment</dt><dd>{m.deployment_mode}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Timeout</dt><dd>{m.timeout_seconds}s</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Concurrency limit</dt><dd>{m.max_concurrency} per API process</dd></div>
            </dl>
            {m.provider === "extractive" && (
              <p className="mt-3 rounded-md bg-warn-soft p-2 text-xs text-warn">
                Extractive mode is a built-in fallback that quotes retrieved passages. Configure MODEL_PROVIDER=anthropic or openai_compatible for generated answers.
              </p>
            )}
          </Card>
          <Card title="Health">
            {health.error && <ErrorState error={health.error} />}
            {health.data && (
              <div className="space-y-2 text-sm">
                <StatusBadge status={health.data.ok ? "healthy" : "failed"} label={health.data.ok ? "Available" : "Unavailable"} />
                <p className="text-muted">{health.data.detail}</p>
                {health.data.latency_ms !== null && <p className="text-xs text-muted">Check latency {formatMs(health.data.latency_ms)}</p>}
              </div>
            )}
          </Card>
          <Card
            title="Request metrics"
            actions={
              <select aria-label="Time window" className={`${inputClass} w-24 py-0.5`} value={range} onChange={(e) => setRange(e.target.value)}>
                <option value="1h">1 hour</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
              </select>
            }
          >
            {metrics.error && <ErrorState error={metrics.error} />}
            {metrics.data && (
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Requests" value={metrics.data.requests} />
                <Kpi label="Error rate" value={metrics.data.error_rate === null ? "—" : `${(metrics.data.error_rate * 100).toFixed(1)}%`} hint={`${metrics.data.timeouts} timeouts`} />
                <Kpi label="Avg latency" value={formatMs(metrics.data.avg_latency_ms)} />
                <Kpi label="p95 latency" value={formatMs(metrics.data.p95_latency_ms)} />
                <Kpi label="Prompt tokens" value={metrics.data.prompt_tokens.toLocaleString()} />
                <Kpi label="Output tokens" value={metrics.data.completion_tokens.toLocaleString()} />
              </div>
            )}
          </Card>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        Metrics are measured from real requests in this workspace. No throughput or concurrency capacity is claimed until load-tested on the target hardware.
      </p>
    </RequirePermission>
  );
}
