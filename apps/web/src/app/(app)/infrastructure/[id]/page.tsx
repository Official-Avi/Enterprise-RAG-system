"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
  Card,
  cx,
  Dialog,
  Empty,
  ErrorState,
  inputClass,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { NodeResource, Rack, RackDetail } from "@/lib/types";
import { NodeActions, plural, RackActions, SourceRadios, WorkloadActions } from "../parts";

function pct(used: number, total: number | null): number | null {
  return total ? Math.min(100, Math.round((used / total) * 100)) : null;
}

function Bar({ label, used, total, format }: { label: string; used: number; total: number | null; format: (n: number) => string }) {
  const p = pct(used, total);
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-muted">{label}</span><span>{format(used)} / {total ? format(total) : "—"}</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-panel-2" role="img" aria-label={`${label} requested ${p ?? 0}% of capacity`}>
        <div className={cx("h-full", (p ?? 0) > 90 ? "bg-bad" : "bg-accent")} style={{ width: `${p ?? 0}%` }} />
      </div>
    </div>
  );
}

function NodeCard({ node, actions }: { node: NodeResource; actions?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-panel p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{node.name}</div>
          <div className="text-xs text-muted">{node.resource_type}{node.rack_unit_position ? ` · U${node.rack_unit_position}` : ""}{node.accelerator_info ? ` · ${node.accelerator_info}` : ""}</div>
        </div>
        <StatusBadge status={node.state_source} />
      </div>
      <div className="mt-2 space-y-1.5">
        <Bar label="CPU (requested)" used={node.allocated.cpu_cores} total={node.cpu_cores} format={(n) => `${n}`} />
        <Bar label="Memory (requested)" used={node.allocated.memory_bytes} total={node.memory_bytes} format={formatBytes} />
      </div>
      <div className="mt-2 text-xs text-muted">{plural(node.workload_count, "workload")} · status {node.status}</div>
      {actions && <div className="mt-2 flex gap-1.5">{actions}</div>}
    </div>
  );
}

function NewNode({ rack, onCreated }: { rack: RackDetail; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    setError(null);
    try {
      await api("/infrastructure/nodes", {
        method: "POST",
        json: {
          name: String(f.get("name")), rack_id: rack.id, resource_type: String(f.get("type")),
          rack_unit_position: num("unit"), cpu_cores: num("cpu"),
          memory_bytes: num("mem") === null ? null : Math.round(num("mem")! * 1024 ** 3),
          storage_bytes: num("disk") === null ? null : Math.round(num("disk")! * 1024 ** 3),
          accelerator_info: String(f.get("gpu") ?? "") || null, state_source: String(f.get("source")),
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
      <Button variant="primary" onClick={() => { setError(null); setOpen(true); }}>Add node</Button>
      <Dialog open={open} title={`Add node to ${rack.name}`} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="n-name" className="mb-1 block text-sm font-medium">Name</label><input id="n-name" name="name" required className={inputClass} /></div>
            <div><label htmlFor="n-type" className="mb-1 block text-sm font-medium">Type</label><select id="n-type" name="type" className={inputClass}>{["server", "gpu_node", "storage", "vm", "network"].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label htmlFor="n-unit" className="mb-1 block text-sm font-medium">Rack unit</label><input id="n-unit" name="unit" type="number" min={1} max={rack.rack_units ?? 60} className={inputClass} /></div>
            <div><label htmlFor="n-cpu" className="mb-1 block text-sm font-medium">CPU cores</label><input id="n-cpu" name="cpu" type="number" min={0} className={inputClass} /></div>
            <div><label htmlFor="n-mem" className="mb-1 block text-sm font-medium">Memory GiB</label><input id="n-mem" name="mem" type="number" min={0} className={inputClass} /></div>
            <div><label htmlFor="n-disk" className="mb-1 block text-sm font-medium">Storage GiB</label><input id="n-disk" name="disk" type="number" min={0} className={inputClass} /></div>
          </div>
          <div><label htmlFor="n-gpu" className="mb-1 block text-sm font-medium">Accelerators</label><input id="n-gpu" name="gpu" placeholder="e.g. 2x NVIDIA L4 24GB" className={inputClass} /></div>
          <SourceRadios />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Add</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export default function RackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const rack = useApi<RackDetail>(`/infrastructure/racks/${id}`, 10000);
  const canManage = useCan("infra:manage");
  // Only for the edit dialogs: moving a node to another rack, placing a workload on any node.
  const allRacks = useApi<{ items: Rack[] }>(canManage ? "/infrastructure/racks" : null);
  const allNodes = useApi<{ items: NodeResource[] }>(canManage ? "/infrastructure/nodes" : null);
  if (rack.loading) return <Loading />;
  // 422: the id in the URL isn't even a valid id. Either way there is nothing here to retry.
  if (rack.error instanceof ApiError && (rack.error.status === 404 || rack.error.status === 422)) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted"><Link href="/infrastructure" className="hover:underline">Racks & workloads</Link> / Not found</nav>
        <h1 className="sr-only">Rack not found</h1>
        <Empty
          title="This rack doesn't exist"
          description="It may have been deleted, or the link may be wrong."
          primary={<Link href="/infrastructure" className="font-medium text-accent hover:underline">Back to Racks & workloads</Link>}
        />
      </>
    );
  }
  // A failed poll keeps the page (and any open dialog) on screen, with the error above it.
  if (!rack.data) return <ErrorState error={rack.error} onRetry={rack.reload} />;
  const r = rack.data;
  const units = r.rack_units ?? 0;
  const reload = () => { rack.reload(); allRacks.reload(); allNodes.reload(); };
  const byUnit = new Map<number, NodeResource[]>();
  for (const n of r.nodes) {
    if (n.rack_unit_position) byUnit.set(n.rack_unit_position, [...(byUnit.get(n.rack_unit_position) ?? []), n]);
  }
  const clashes = [...byUnit.entries()].filter(([, nodes]) => nodes.length > 1).sort(([a], [b]) => b - a);
  const editable = (source: string) => canManage && source !== "integration";

  return (
    <RequirePermission permission="infra:read">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted"><Link href="/infrastructure" className="hover:underline">Racks & workloads</Link> / {r.name}</nav>
      <PageHeader
        title={r.name}
        description={`${r.environment}${r.location_label ? ` · ${r.location_label}` : ""}${units ? ` · ${units}U` : ""}`}
        actions={(
          <>
            <StatusBadge status={r.state_source} />
            {editable(r.state_source) && <RackActions rack={r} onChanged={reload} onDeleted={() => router.push("/infrastructure")} />}
            {canManage && <NewNode rack={r} onCreated={reload} />}
          </>
        )}
      />
      {r.state_source === "simulated" && (
        <p role="note" className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Simulated rack: all values are demo data, not measurements from real hardware.</p>
      )}
      {rack.error && <div className="mb-4"><ErrorState error={rack.error} onRetry={rack.reload} /></div>}
      {clashes.length > 0 && (
        <p role="note" className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {clashes.map(([u, nodes]) => `U${u} is claimed by ${nodes.map((n) => n.name).join(" and ")}.`).join(" ")} Edit a node to correct its rack unit.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card title="Front view">
          {units === 0 ? (
            <p className="text-sm text-muted">Rack height not set; see the node list.</p>
          ) : (
            <ol className="rounded border border-border font-mono text-xs" aria-label="Rack units from top">
              {Array.from({ length: units }, (_, i) => units - i).map((u) => {
                const nodes = byUnit.get(u) ?? [];
                const names = nodes.map((n) => n.name).join(" + ");
                return (
                  <li key={u} className={cx("flex h-5 items-center gap-2 border-b border-border px-1.5 last:border-b-0", nodes.length === 1 && "bg-accent-soft text-accent", nodes.length > 1 && "bg-warn-soft text-warn")}>
                    <span className="w-6 text-right text-muted">{u}</span>
                    <span className="truncate" title={names || undefined}>{nodes.length > 1 && <span aria-hidden="true">! </span>}{names}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {r.nodes.length === 0 && <p className="text-sm text-muted">No nodes registered in this rack.</p>}
            {r.nodes.map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                actions={editable(n.state_source) ? <NodeActions node={n} racks={allRacks.data?.items ?? [r]} onChanged={reload} /> : undefined}
              />
            ))}
          </div>
          <Card title="Workloads in this rack">
            {r.workloads.length === 0 && <p className="text-sm text-muted">None.</p>}
            <ul className="divide-y divide-border">
              {r.workloads.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 wrap-anywhere"><span className="font-medium">{w.name}</span> <span className="text-xs text-muted">{w.workload_type} on {w.node_name}</span></span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted">{w.desired_state}/{w.observed_state}</span>
                    <StatusBadge status={w.state_source} />
                    {editable(w.state_source) && <WorkloadActions workload={w} nodes={allNodes.data?.items ?? r.nodes} onChanged={reload} />}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-muted">Utilisation bars show resources requested by registered workloads against configured capacity — an allocation estimate, not measured usage.</p>
        </div>
      </div>
    </RequirePermission>
  );
}
