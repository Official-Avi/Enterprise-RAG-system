"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
  Card,
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
} from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { InfraOverview, NodeResource, Rack, Workload } from "@/lib/types";
import { NodeActions, plural, SourceRadios, WorkloadActions } from "./parts";

function SourceBadge({ source }: { source: string }) {
  return <StatusBadge status={source} />;
}

function healthStatus(s: string): string {
  return s === "healthy" ? "healthy" : s === "degraded" ? "stale" : s === "offline" ? "failed" : "skipped";
}

function NewRack({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setError(null);
    try {
      await api("/infrastructure/racks", {
        method: "POST",
        json: {
          name: String(f.get("name")),
          environment: String(f.get("environment")),
          location_label: String(f.get("location") ?? "") || null,
          rack_units: f.get("units") ? Number(f.get("units")) : null,
          state_source: String(f.get("source")),
        },
      });
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Button variant="primary" onClick={() => { setError(null); setOpen(true); }}>Register rack</Button>
      <Dialog open={open} title="Register logical rack" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <div><label htmlFor="r-name" className="mb-1 block text-sm font-medium">Name</label><input id="r-name" name="name" required maxLength={120} className={inputClass} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="r-env" className="mb-1 block text-sm font-medium">Environment</label>
              <select id="r-env" name="environment" className={inputClass}>{["production", "staging", "development", "lab"].map((e) => <option key={e}>{e}</option>)}</select></div>
            <div><label htmlFor="r-units" className="mb-1 block text-sm font-medium">Height (U)</label><input id="r-units" name="units" type="number" min={1} max={60} placeholder="42" className={inputClass} /></div>
          </div>
          <div><label htmlFor="r-loc" className="mb-1 block text-sm font-medium">Location label</label><input id="r-loc" name="location" maxLength={200} placeholder="DC-1 / Row A" className={inputClass} /></div>
          <SourceRadios manualHint="real rack, entered manually" simulatedHint="demo/test data" />
          <p className="text-xs text-muted">This registers inventory only. RackFlow does not discover, monitor or control physical hardware.</p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Register</Button></div>
        </form>
      </Dialog>
    </>
  );
}

function NewWorkload({ nodes, onCreated }: { nodes: NodeResource[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const gib = Number(f.get("memory") || 0);
    setError(null);
    try {
      await api("/infrastructure/workloads", {
        method: "POST",
        json: {
          name: String(f.get("name")),
          workload_type: String(f.get("type")),
          node_id: String(f.get("node") ?? "") || null,
          state_source: String(f.get("source")),
          resource_request: {
            cpu_cores: f.get("cpu") ? Number(f.get("cpu")) : null,
            memory_bytes: gib ? Math.round(gib * 1024 ** 3) : null,
            accelerators: f.get("gpu") ? Number(f.get("gpu")) : null,
          },
        },
      });
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true); }}>Register workload</Button>
      <Dialog open={open} title="Register logical workload" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <div><label htmlFor="w-name" className="mb-1 block text-sm font-medium">Name</label><input id="w-name" name="name" required maxLength={120} className={inputClass} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="w-type" className="mb-1 block text-sm font-medium">Type</label>
              <select id="w-type" name="type" className={inputClass}>{["api", "worker", "vector_db", "database", "model_serving", "object_storage", "other"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label htmlFor="w-node" className="mb-1 block text-sm font-medium">Placed on node</label>
              <select id="w-node" name="node" className={inputClass}><option value="">Unplaced</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label htmlFor="w-cpu" className="mb-1 block text-sm font-medium">CPU cores</label><input id="w-cpu" name="cpu" type="number" min={0} step="0.5" className={inputClass} /></div>
            <div><label htmlFor="w-mem" className="mb-1 block text-sm font-medium">Memory GiB</label><input id="w-mem" name="memory" type="number" min={0} className={inputClass} /></div>
            <div><label htmlFor="w-gpu" className="mb-1 block text-sm font-medium">GPUs</label><input id="w-gpu" name="gpu" type="number" min={0} className={inputClass} /></div>
          </div>
          <SourceRadios />
          <p className="text-xs text-muted">Registers a workload record; nothing is deployed or started. Configured workloads show observed state “unknown” because no telemetry exists.</p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Register</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export default function InfrastructurePage() {
  const overview = useApi<InfraOverview>("/infrastructure/overview", 10000);
  // All on the same interval, so the counts and the lists below them agree.
  const racks = useApi<{ items: Rack[] }>("/infrastructure/racks", 10000);
  const nodes = useApi<{ items: NodeResource[] }>("/infrastructure/nodes", 10000);
  const workloads = useApi<{ items: Workload[] }>("/infrastructure/workloads", 10000);
  const canManage = useCan("infra:manage");
  const reload = () => { racks.reload(); nodes.reload(); workloads.reload(); overview.reload(); };
  const unracked = nodes.data?.items.filter((n) => n.rack_id === null) ?? [];

  return (
    <RequirePermission permission="infra:read">
      <PageHeader
        title="Racks & workloads"
        description="Logical infrastructure inventory and workload placement. Every value shows where it came from."
        actions={canManage && (<><NewWorkload nodes={nodes.data?.items ?? []} onCreated={reload} /><NewRack onCreated={reload} /></>)}
      />
      {overview.data && (
        <div role="note" className="mb-4 rounded-lg border border-border bg-panel px-4 py-3 text-sm">
          <p>{overview.data.note}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {(["manual", "simulated", "integration"] as const).map((s) => (
              <span key={s} className="flex flex-wrap items-center gap-1"><SourceBadge source={s} /> {plural(overview.data!.racks[s], "rack")} · {plural(overview.data!.nodes[s], "node")} · {plural(overview.data!.workloads[s], "workload")}</span>
            ))}
          </div>
        </div>
      )}
      {racks.loading && <Loading />}
      {racks.error && <ErrorState error={racks.error} onRetry={racks.reload} />}
      {racks.data?.items.length === 0 && (
        <Empty title="No racks registered">Register a rack, or seed clearly labelled demo data with <code className="font-mono">rackflow-admin seed-infra --tenant &lt;slug&gt;</code>.</Empty>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {racks.data?.items.map((r) => (
          <Link key={r.id} href={`/infrastructure/${r.id}`} className="min-w-0 rounded-lg border border-border bg-panel p-4 hover:border-accent">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted">{r.environment}{r.location_label ? ` · ${r.location_label}` : ""}{r.rack_units ? ` · ${r.rack_units}U` : ""}</div>
              </div>
              <SourceBadge source={r.state_source} />
            </div>
            <div className="mt-3 flex items-center gap-2"><StatusBadge status={healthStatus(r.status)} label={r.status} /><span className="text-xs text-muted">{plural(r.node_count, "node")}</span></div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
              <div><dt className="text-muted">CPU</dt><dd className="font-medium">{r.capacity.cpu_cores}</dd></div>
              <div><dt className="text-muted">Memory</dt><dd className="font-medium">{formatBytes(r.capacity.memory_bytes)}</dd></div>
              <div><dt className="text-muted">Storage</dt><dd className="font-medium">{formatBytes(r.capacity.storage_bytes)}</dd></div>
              <div><dt className="text-muted">GPUs</dt><dd className="font-medium">{r.capacity.accelerators}</dd></div>
            </dl>
          </Link>
        ))}
      </div>
      {unracked.length > 0 && (
        <Card title="Nodes not in a rack" className="mt-6">
          <ul className="divide-y divide-border">
            {unracked.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
                <span className="min-w-0 wrap-anywhere"><span className="font-medium">{n.name}</span> <span className="text-xs text-muted">{n.resource_type} · {plural(n.workload_count, "workload")}</span></span>
                <span className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={n.state_source} />
                  {canManage && n.state_source !== "integration" && <NodeActions node={n} racks={racks.data?.items ?? []} onChanged={reload} />}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Workload placement" className="lg:col-span-2">
          {workloads.data?.items.length === 0 && <p className="text-sm text-muted">No workloads registered.</p>}
          {workloads.data && workloads.data.items.length > 0 && (
            <TableWrap label="Workload placement">
              <thead><tr><Th>Workload</Th><Th>Type</Th><Th>Node</Th><Th>Desired / observed</Th><Th>Request</Th><Th>Source</Th>{canManage && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
              <tbody>
                {workloads.data.items.map((w) => (
                  <tr key={w.id}>
                    <Td className="font-medium">{w.name}</Td>
                    <Td className="text-xs">{w.workload_type}</Td>
                    <Td className="text-xs">{w.node_name ?? <span className="text-muted">unplaced</span>}</Td>
                    <Td className="text-xs">{w.desired_state} / <span className={w.observed_state === "unknown" ? "text-muted" : ""}>{w.observed_state}</span></Td>
                    <Td className="text-xs text-muted">{w.resource_request.cpu_cores ?? 0} CPU · {formatBytes(w.resource_request.memory_bytes ?? 0)}{w.resource_request.accelerators ? ` · ${w.resource_request.accelerators} GPU` : ""}</Td>
                    <Td><SourceBadge source={w.state_source} /></Td>
                    {canManage && (
                      <Td>
                        {w.state_source !== "integration" && (
                          <div className="flex gap-1.5"><WorkloadActions workload={w} nodes={nodes.data?.items ?? []} onChanged={reload} /></div>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title="Platform processes (live)">
          <p className="mb-2 text-xs text-muted">Reported by RackFlow worker heartbeats in the last hour — the only integration-reported data.</p>
          {overview.data?.platform_processes.length === 0 && <p className="text-sm text-muted">No worker heartbeats in the last hour.</p>}
          <ul className="space-y-1.5">
            {overview.data?.platform_processes.map((p) => (
              <li key={p.worker_id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-mono">{p.worker_id}</span>
                <span className="flex shrink-0 items-center gap-1"><StatusBadge status={p.health} /><span className="text-muted">{formatTime(p.last_heartbeat_at)}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </RequirePermission>
  );
}
