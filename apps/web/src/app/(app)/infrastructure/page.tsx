"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
  Dialog,
  Empty,
  ErrorState,
  inputClass,
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
import { NodeActions, plural, SectionTitle, SourceRadios, WorkloadActions } from "./parts";

function SourceBadge({ source }: { source: string }) {
  return <StatusBadge status={source} />;
}

function healthStatus(s: string): string {
  return s === "healthy" ? "healthy" : s === "degraded" ? "stale" : s === "offline" ? "failed" : "skipped";
}

/** Sentence-case label for a rack's health, matching the Platform processes badges ("Healthy"). */
function healthLabel(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "production, DC-1 / Row A, 42U": the rack's place in one comma-separated line. */
function rackMeta(r: Pick<Rack, "environment" | "location_label" | "rack_units">): string {
  return [r.environment, r.location_label, r.rack_units ? `${r.rack_units}U` : null].filter(Boolean).join(", ");
}

/** Placeholder rack tiles in the shape of the grid that is loading. */
function RackSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">Loading…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="space-y-3 rounded-card border border-border bg-panel p-4">
          <div className="h-4 w-2/5 animate-shimmer rounded-sm bg-panel-3 motion-reduce:animate-none" />
          <div className="h-3 w-3/5 animate-shimmer rounded-sm bg-panel-3 motion-reduce:animate-none" />
          <div className="h-10 animate-shimmer rounded-sm bg-panel-3 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
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
          <div><label htmlFor="r-name" className="mb-1 block text-sm font-medium text-text">Name</label><input id="r-name" name="name" required maxLength={120} className={inputClass} /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="r-env" className="mb-1 block text-sm font-medium text-text">Environment</label>
              <select id="r-env" name="environment" className={inputClass}>{["production", "staging", "development", "lab"].map((e) => <option key={e}>{e}</option>)}</select></div>
            <div><label htmlFor="r-units" className="mb-1 block text-sm font-medium text-text">Height (U)</label><input id="r-units" name="units" type="number" min={1} max={60} placeholder="42" className={inputClass} /></div>
          </div>
          <div><label htmlFor="r-loc" className="mb-1 block text-sm font-medium text-text">Location label</label><input id="r-loc" name="location" maxLength={200} placeholder="DC-1 / Row A" className={inputClass} /></div>
          <SourceRadios manualHint="real rack, entered manually" simulatedHint="demo/test data" />
          <p className="text-xs text-muted">This registers inventory only. RackFlow does not discover, monitor or control physical hardware.</p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Register</Button></div>
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
          <div><label htmlFor="w-name" className="mb-1 block text-sm font-medium text-text">Name</label><input id="w-name" name="name" required maxLength={120} className={inputClass} /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label htmlFor="w-type" className="mb-1 block text-sm font-medium text-text">Type</label>
              <select id="w-type" name="type" className={inputClass}>{["api", "worker", "vector_db", "database", "model_serving", "object_storage", "other"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label htmlFor="w-node" className="mb-1 block text-sm font-medium text-text">Placed on node</label>
              <select id="w-node" name="node" className={inputClass}><option value="">Unplaced</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label htmlFor="w-cpu" className="mb-1 block text-sm font-medium text-text">CPU cores</label><input id="w-cpu" name="cpu" type="number" min={0} step="0.5" className={inputClass} /></div>
            <div><label htmlFor="w-mem" className="mb-1 block text-sm font-medium text-text">Memory GiB</label><input id="w-mem" name="memory" type="number" min={0} className={inputClass} /></div>
            <div><label htmlFor="w-gpu" className="mb-1 block text-sm font-medium text-text">GPUs</label><input id="w-gpu" name="gpu" type="number" min={0} className={inputClass} /></div>
          </div>
          <SourceRadios />
          <p className="text-xs text-muted">Registers a workload record; nothing is deployed or started. Configured workloads show observed state “unknown” because no telemetry exists.</p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Register</Button></div>
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
        <div role="note" className="mb-8 border-y border-border py-4 text-sm">
          <p className="max-w-[72ch] text-text-2">{overview.data.note}</p>
          <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted">
            {(["manual", "simulated", "integration"] as const).map((s) => (
              <li key={s} className="flex flex-wrap items-center gap-2 tabular-nums">
                <SourceBadge source={s} />
                {plural(overview.data!.racks[s], "rack")}, {plural(overview.data!.nodes[s], "node")}, {plural(overview.data!.workloads[s], "workload")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section aria-labelledby="racks-title">
        <SectionTitle id="racks-title" meta={racks.data && racks.data.items.length > 0 ? plural(racks.data.items.length, "rack") : undefined}>Racks</SectionTitle>
        {racks.loading && <RackSkeleton />}
        {racks.error && <ErrorState error={racks.error} onRetry={racks.reload} />}
        {racks.data?.items.length === 0 && (
          <Empty title="No racks registered">Register a rack, or seed clearly labelled demo data with <code className="font-mono">rackflow-admin seed-infra --tenant &lt;slug&gt;</code>.</Empty>
        )}
        {racks.data && racks.data.items.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {racks.data.items.map((r) => (
              <li key={r.id} className="min-w-0">
                <Link
                  href={`/infrastructure/${r.id}`}
                  className="group block h-full rounded-card border border-border bg-panel p-4 transition-colors duration-[var(--dur-micro)] hover:border-border-2 hover:bg-panel-2 focus-visible:border-accent active:bg-panel-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display text-base font-semibold wrap-anywhere decoration-border-strong underline-offset-4 group-hover:underline">{r.name}</div>
                      <div className="text-xs text-muted wrap-anywhere">{rackMeta(r)}</div>
                    </div>
                    <SourceBadge source={r.state_source} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={healthStatus(r.status)} label={healthLabel(r.status)} /><span className="text-xs text-muted tabular-nums">{plural(r.node_count, "node")}</span></div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 sm:grid-cols-4">
                    <div><dt className="text-xs text-muted">CPU</dt><dd className="font-display text-base font-medium tabular-nums">{r.capacity.cpu_cores}</dd></div>
                    <div><dt className="text-xs text-muted">Memory</dt><dd className="font-display text-base font-medium tabular-nums">{formatBytes(r.capacity.memory_bytes)}</dd></div>
                    <div><dt className="text-xs text-muted">Storage</dt><dd className="font-display text-base font-medium tabular-nums">{formatBytes(r.capacity.storage_bytes)}</dd></div>
                    <div><dt className="text-xs text-muted">GPUs</dt><dd className="font-display text-base font-medium tabular-nums">{r.capacity.accelerators}</dd></div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {unracked.length > 0 && (
        <section aria-labelledby="unracked-title" className="mt-10">
          <SectionTitle id="unracked-title">Nodes not in a rack</SectionTitle>
          <ul className="border-t border-border">
            {unracked.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">
                <span className="min-w-0 wrap-anywhere"><span className="font-medium">{n.name}</span> <span className="text-xs text-muted">{n.resource_type}, {plural(n.workload_count, "workload")}</span></span>
                <span className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={n.state_source} />
                  {canManage && n.state_source !== "integration" && <NodeActions node={n} racks={racks.data?.items ?? []} onChanged={reload} />}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="placement-title" className="mt-10 min-w-0">
        <SectionTitle id="placement-title">Workload placement</SectionTitle>
        {workloads.data?.items.length === 0 && <p className="text-sm text-muted">No workloads registered.</p>}
        {workloads.data && workloads.data.items.length > 0 && (
          <TableWrap label="Workload placement">
            <thead><tr><Th>Workload</Th><Th>Node</Th><Th>Desired / observed</Th><Th>Request</Th><Th>Source</Th>{canManage && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
            <tbody>
              {workloads.data.items.map((w) => (
                <tr key={w.id} className="transition-colors duration-[var(--dur-micro)] hover:bg-panel-2">
                  <Td className="whitespace-nowrap"><span className="font-medium">{w.name}</span><div className="font-mono text-xs text-muted">{w.workload_type}</div></Td>
                  <Td className="text-xs whitespace-nowrap">{w.node_name ?? <span className="text-muted">unplaced</span>}</Td>
                  <Td className="text-xs">{w.desired_state} / <span className={w.observed_state === "unknown" ? "text-muted" : ""}>{w.observed_state}</span></Td>
                  <Td className="text-xs text-muted tabular-nums">{w.resource_request.cpu_cores ?? 0} CPU, {formatBytes(w.resource_request.memory_bytes ?? 0)}{w.resource_request.accelerators ? `, ${w.resource_request.accelerators} GPU` : ""}</Td>
                  <Td><SourceBadge source={w.state_source} /></Td>
                  {canManage && (
                    <Td>
                      {w.state_source !== "integration" && (
                        <div className="flex gap-2"><WorkloadActions workload={w} nodes={nodes.data?.items ?? []} onChanged={reload} /></div>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>
      <section aria-labelledby="processes-title" className="mt-10">
        <SectionTitle id="processes-title">Platform processes (live)</SectionTitle>
        <p className="mb-3 max-w-[72ch] text-xs text-muted">Reported by RackFlow worker heartbeats in the last hour. This is the only integration-reported data.</p>
        {overview.data?.platform_processes.length === 0 && <p className="text-sm text-muted">No worker heartbeats in the last hour.</p>}
        {overview.data && overview.data.platform_processes.length > 0 && (
          <ul className="border-t border-border">
            {overview.data.platform_processes.map((p) => (
              <li key={p.worker_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border py-2 text-xs">
                <span className="min-w-0 font-mono wrap-anywhere">{p.worker_id}</span>
                <span className="flex shrink-0 items-center gap-3"><StatusBadge status={p.health} /><span className="font-mono text-muted">{formatTime(p.last_heartbeat_at)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </RequirePermission>
  );
}
