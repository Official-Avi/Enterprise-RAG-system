"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
  Card,
  cx,
  Dialog,
  ErrorState,
  inputClass,
  Loading,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { NodeResource, RackDetail } from "@/lib/types";

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

function NodeCard({ node }: { node: NodeResource }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
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
      <div className="mt-2 text-xs text-muted">{node.workload_count} workload{node.workload_count === 1 ? "" : "s"} · status {node.status}</div>
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
      <Button variant="primary" onClick={() => setOpen(true)}>Add node</Button>
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
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="source" value="manual" defaultChecked /> Configured</label>
            <label className="flex items-center gap-2"><input type="radio" name="source" value="simulated" /> Simulated</label>
          </fieldset>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary">Add</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export default function RackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const rack = useApi<RackDetail>(`/infrastructure/racks/${id}`);
  const canManage = useCan("infra:manage");
  if (rack.loading) return <Loading />;
  if (rack.error || !rack.data) return <ErrorState error={rack.error} onRetry={rack.reload} />;
  const r = rack.data;
  const units = r.rack_units ?? 0;
  const byUnit = new Map(r.nodes.filter((n) => n.rack_unit_position).map((n) => [n.rack_unit_position!, n]));

  return (
    <RequirePermission permission="infra:read">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted"><Link href="/infrastructure" className="hover:underline">Racks & workloads</Link> / {r.name}</nav>
      <PageHeader
        title={r.name}
        description={`${r.environment}${r.location_label ? ` · ${r.location_label}` : ""}${units ? ` · ${units}U` : ""}`}
        actions={<><StatusBadge status={r.state_source} />{canManage && <NewNode rack={r} onCreated={rack.reload} />}</>}
      />
      {r.state_source === "simulated" && (
        <p role="note" className="mb-4 rounded-md bg-info-soft px-3 py-2 text-sm text-info">Simulated rack: all values are demo data, not measurements from real hardware.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Front view">
          {units === 0 ? (
            <p className="text-sm text-muted">Rack height not set; see the node list.</p>
          ) : (
            <ol className="rounded border border-border font-mono text-xs" aria-label="Rack units from top">
              {Array.from({ length: units }, (_, i) => units - i).map((u) => {
                const node = byUnit.get(u);
                return (
                  <li key={u} className={cx("flex h-5 items-center gap-2 border-b border-border px-1.5 last:border-b-0", node && "bg-accent-soft text-accent")}>
                    <span className="w-6 text-right text-muted">{u}</span>
                    <span className="truncate">{node?.name ?? ""}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {r.nodes.length === 0 && <p className="text-sm text-muted">No nodes registered in this rack.</p>}
            {r.nodes.map((n) => <NodeCard key={n.id} node={n} />)}
          </div>
          <Card title="Workloads in this rack">
            {r.workloads.length === 0 && <p className="text-sm text-muted">None.</p>}
            <ul className="divide-y divide-border">
              {r.workloads.map((w) => (
                <li key={w.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span><span className="font-medium">{w.name}</span> <span className="text-xs text-muted">{w.workload_type} on {w.node_name}</span></span>
                  <span className="flex items-center gap-2 text-xs"><span className="text-muted">{w.desired_state}/{w.observed_state}</span><StatusBadge status={w.state_source} /></span>
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
