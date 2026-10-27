"use client";

import { RequirePermission } from "@/components/Shell";
import { Empty, ErrorState, Loading, PageHeader, StatusBadge, TableWrap, Td, Th, UpdatedAt } from "@/components/ui";
import { formatTime, shortId } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Worker } from "@/lib/types";

export default function WorkersPage() {
  const workers = useApi<{ items: Worker[] }>("/operations/workers", 5000);
  return (
    <RequirePermission permission="ops:read">
      <PageHeader
        title="Workers"
        description="Background worker processes report a heartbeat every 5 seconds; a worker is stale after 15 seconds without one."
        actions={<UpdatedAt at={workers.updatedAt} />}
      />
      {workers.loading && <Loading />}
      {workers.error && <ErrorState error={workers.error} onRetry={workers.reload} />}
      {workers.data?.items.length === 0 && (
        <Empty title="No workers reported in the last 24 hours">Start one with <code className="font-mono">rackflow-worker</code>; add processes to scale horizontally.</Empty>
      )}
      {workers.data && workers.data.items.length > 0 && (
        <TableWrap>
          <thead>
            <tr><Th>Worker</Th><Th>Health</Th><Th>State</Th><Th>Current job</Th><Th>Succeeded</Th><Th>Failed</Th><Th>Started</Th><Th>Last heartbeat</Th></tr>
          </thead>
          <tbody>
            {workers.data.items.map((w) => (
              <tr key={w.worker_id}>
                <Td><span className="font-mono text-xs">{w.worker_id}</span><div className="text-xs text-muted">v{w.version}</div></Td>
                <Td><StatusBadge status={w.health} /></Td>
                <Td>{w.status}</Td>
                <Td className="font-mono text-xs">{shortId(w.current_job_id)}</Td>
                <Td className="tabular-nums">{w.jobs_succeeded}</Td>
                <Td className="tabular-nums">{w.jobs_failed}</Td>
                <Td className="text-muted">{formatTime(w.started_at)}</Td>
                <Td className="text-muted">{formatTime(w.last_heartbeat_at)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </RequirePermission>
  );
}
