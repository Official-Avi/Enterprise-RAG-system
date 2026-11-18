"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ConfirmDialog, Dialog, inputClass } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import type { NodeResource, Rack, Workload } from "@/lib/types";

const GIB = 1024 ** 3;
const HEALTH = ["unknown", "healthy", "degraded", "offline"];
const ENVIRONMENTS = ["production", "staging", "development", "lab"];

/** "1 rack", "2 racks". */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function gibText(bytes: number | null | undefined): string {
  return bytes ? String(Math.round((bytes / GIB) * 1000) / 1000) : "";
}

function numberOrNull(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

function gibToBytes(raw: string): number | null {
  const n = numberOrNull(raw);
  return n === null ? null : Math.round(n * GIB);
}

function FieldBox({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text">{label}</label>
      {children}
    </div>
  );
}

/** A section head inside a console page: one step under the page h1, in the display face. */
export function SectionTitle({ id, children, meta }: { id?: string; children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-base font-semibold">{children}</h2>
      {meta && <div className="text-xs text-muted">{meta}</div>}
    </div>
  );
}

/** The data source radios. Rows are 32px so the small native radios keep the target spacing
 *  WCAG 2.5.8 asks for. */
export function SourceRadios({ manualHint, simulatedHint }: { manualHint?: string; simulatedHint?: string }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-text">Data source</legend>
      <label className="flex min-h-8 items-center gap-2 text-sm">
        <input type="radio" name="source" value="manual" defaultChecked className="size-4 shrink-0 accent-accent" /> Configured{manualHint ? ` (${manualHint})` : ""}
      </label>
      <label className="flex min-h-8 items-center gap-2 text-sm">
        <input type="radio" name="source" value="simulated" className="size-4 shrink-0 accent-accent" /> Simulated{simulatedHint ? ` (${simulatedHint})` : ""}
      </label>
    </fieldset>
  );
}

/** Save/cancel footer shared by the edit forms. An edit that changes nothing just closes. */
function EditDialog({
  title,
  name,
  onClose,
  open,
  build,
  path,
  onSaved,
  note,
  children,
}: {
  title: string;
  name: string;
  open: boolean;
  onClose: () => void;
  /** The fields that differ from the record, so the audit row names only those. */
  build: (f: FormData) => Record<string, unknown>;
  path: string;
  onSaved: () => void;
  note?: ReactNode;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  // This component outlives the dialog, so an error would otherwise greet the next opening.
  const close = () => {
    setError(null);
    onClose();
  };
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const body = build(new FormData(ev.currentTarget));
    setError(null);
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    try {
      await api(path, { method: "PATCH", json: body });
      onClose();
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Dialog open={open} title={`${title} ${name}`} onClose={close}>
      <form onSubmit={submit} className="space-y-3">
        {children}
        {note && <p className="text-xs text-muted">{note}</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RowButton({ name, verb, danger, onClick }: { name: string; verb: string; danger?: boolean; onClick: () => void }) {
  return (
    <Button variant={danger ? "danger" : "secondary"} aria-label={`${verb} ${name}`} className="min-h-8 px-3 text-xs max-sm:min-h-11" onClick={onClick}>
      {verb}
    </Button>
  );
}

function DeleteDialog({
  open,
  title,
  path,
  onClose,
  onDeleted,
  children,
}: {
  open: boolean;
  title: string;
  path: string;
  onClose: () => void;
  onDeleted: () => void;
  children: ReactNode;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel="Delete"
      onCancel={onClose}
      onConfirm={async () => {
        await api(path, { method: "DELETE" });
        onClose();
        onDeleted();
      }}
    >
      {children}
    </ConfirmDialog>
  );
}

export function RackActions({ rack, onChanged, onDeleted }: { rack: Rack; onChanged: () => void; onDeleted: () => void }) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const close = () => setMode(null);
  const path = `/infrastructure/racks/${rack.id}`;
  const build = (f: FormData) => {
    const body: Record<string, unknown> = {};
    const name = String(f.get("name")).trim();
    const location = String(f.get("location") ?? "").trim();
    const description = String(f.get("description") ?? "");
    if (name !== rack.name) body.name = name;
    if (f.get("environment") !== rack.environment) body.environment = f.get("environment");
    if (location !== (rack.location_label ?? "")) body.location_label = location || null;
    if (description !== rack.description) body.description = description;
    if (f.get("status") !== rack.status) body.status = f.get("status");
    return body;
  };
  return (
    <>
      <RowButton name={rack.name} verb="Edit" onClick={() => setMode("edit")} />
      <RowButton name={rack.name} verb="Delete" danger onClick={() => setMode("delete")} />
      <EditDialog
        title="Edit"
        name={rack.name}
        open={mode === "edit"}
        onClose={close}
        build={build}
        path={path}
        onSaved={onChanged}
        note={rack.rack_units ? `Height is ${rack.rack_units}U. It is set when the rack is registered.` : "Height is not set. It is set when the rack is registered."}
      >
        <FieldBox id="er-name" label="Name"><input id="er-name" name="name" required maxLength={120} defaultValue={rack.name} className={inputClass} /></FieldBox>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox id="er-env" label="Environment">
            <select id="er-env" name="environment" defaultValue={rack.environment} className={inputClass}>{ENVIRONMENTS.map((e) => <option key={e}>{e}</option>)}</select>
          </FieldBox>
          <FieldBox id="er-status" label="Status">
            <select id="er-status" name="status" defaultValue={rack.status} className={inputClass}>{HEALTH.map((s) => <option key={s}>{s}</option>)}</select>
          </FieldBox>
        </div>
        <FieldBox id="er-loc" label="Location label"><input id="er-loc" name="location" maxLength={200} defaultValue={rack.location_label ?? ""} className={inputClass} /></FieldBox>
        <FieldBox id="er-desc" label="Description"><textarea id="er-desc" name="description" rows={2} maxLength={2000} defaultValue={rack.description} className={inputClass} /></FieldBox>
      </EditDialog>
      <DeleteDialog open={mode === "delete"} title={`Delete ${rack.name}?`} path={path} onClose={close} onDeleted={onDeleted}>
        {rack.node_count > 0
          ? <p>This rack still holds {plural(rack.node_count, "node")}. Move or delete them first, or RackFlow will refuse.</p>
          : <p>This removes the inventory record only. Nothing happens to real hardware.</p>}
      </DeleteDialog>
    </>
  );
}

export function NodeActions({ node, racks, onChanged }: { node: NodeResource; racks: Rack[]; onChanged: () => void }) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const close = () => setMode(null);
  const path = `/infrastructure/nodes/${node.id}`;
  const build = (f: FormData) => {
    const body: Record<string, unknown> = {};
    const name = String(f.get("name")).trim();
    const rack = String(f.get("rack") ?? "");
    const accel = String(f.get("accel") ?? "").trim();
    const raw = (k: string) => String(f.get(k) ?? "").trim();
    if (name !== node.name) body.name = name;
    if (rack !== (node.rack_id ?? "")) body.rack_id = rack || null;
    if (raw("unit") !== String(node.rack_unit_position ?? "")) body.rack_unit_position = numberOrNull(raw("unit"));
    if (raw("cpu") !== String(node.cpu_cores ?? "")) body.cpu_cores = numberOrNull(raw("cpu"));
    if (raw("mem") !== gibText(node.memory_bytes)) body.memory_bytes = gibToBytes(raw("mem"));
    if (raw("disk") !== gibText(node.storage_bytes)) body.storage_bytes = gibToBytes(raw("disk"));
    if (accel !== (node.accelerator_info ?? "")) body.accelerator_info = accel || null;
    if (f.get("status") !== node.status) body.status = f.get("status");
    return body;
  };
  return (
    <>
      <RowButton name={node.name} verb="Edit" onClick={() => setMode("edit")} />
      <RowButton name={node.name} verb="Delete" danger onClick={() => setMode("delete")} />
      <EditDialog title="Edit" name={node.name} open={mode === "edit"} onClose={close} build={build} path={path} onSaved={onChanged}>
        <FieldBox id="en-name" label="Name"><input id="en-name" name="name" required maxLength={120} defaultValue={node.name} className={inputClass} /></FieldBox>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox id="en-rack" label="Rack">
            <select id="en-rack" name="rack" defaultValue={node.rack_id ?? ""} className={inputClass}>
              <option value="">Not in a rack</option>
              {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </FieldBox>
          <FieldBox id="en-unit" label="Rack unit"><input id="en-unit" name="unit" type="number" min={1} max={60} defaultValue={node.rack_unit_position ?? ""} className={inputClass} /></FieldBox>
          <FieldBox id="en-cpu" label="CPU cores"><input id="en-cpu" name="cpu" type="number" min={0} max={4096} defaultValue={node.cpu_cores ?? ""} className={inputClass} /></FieldBox>
          <FieldBox id="en-status" label="Status">
            <select id="en-status" name="status" defaultValue={node.status} className={inputClass}>{HEALTH.map((s) => <option key={s}>{s}</option>)}</select>
          </FieldBox>
          <FieldBox id="en-mem" label="Memory GiB"><input id="en-mem" name="mem" type="number" min={0} step="any" defaultValue={gibText(node.memory_bytes)} className={inputClass} /></FieldBox>
          <FieldBox id="en-disk" label="Storage GiB"><input id="en-disk" name="disk" type="number" min={0} step="any" defaultValue={gibText(node.storage_bytes)} className={inputClass} /></FieldBox>
        </div>
        <FieldBox id="en-accel" label="Accelerators"><input id="en-accel" name="accel" maxLength={200} defaultValue={node.accelerator_info ?? ""} className={inputClass} /></FieldBox>
      </EditDialog>
      <DeleteDialog open={mode === "delete"} title={`Delete ${node.name}?`} path={path} onClose={close} onDeleted={onChanged}>
        {node.workload_count > 0
          ? <p>{plural(node.workload_count, "workload")} still on this node. Move or delete {node.workload_count === 1 ? "it" : "them"} first, or RackFlow will refuse.</p>
          : <p>This removes the inventory record only. Nothing happens to real hardware.</p>}
      </DeleteDialog>
    </>
  );
}

export function WorkloadActions({ workload, nodes, onChanged }: { workload: Workload; nodes: NodeResource[]; onChanged: () => void }) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const close = () => setMode(null);
  const path = `/infrastructure/workloads/${workload.id}`;
  const simulated = workload.state_source === "simulated";
  const req = workload.resource_request;
  const build = (f: FormData) => {
    const body: Record<string, unknown> = {};
    const raw = (k: string) => String(f.get(k) ?? "").trim();
    if (raw("node") !== (workload.node_id ?? "")) body.node_id = raw("node") || null;
    if (f.get("desired") !== workload.desired_state) body.desired_state = f.get("desired");
    if (simulated && f.get("observed") !== workload.observed_state) body.observed_state = f.get("observed");
    const requestChanged =
      raw("cpu") !== String(req.cpu_cores ?? "") ||
      raw("mem") !== gibText(req.memory_bytes) ||
      raw("gpu") !== String(req.accelerators ?? "");
    if (requestChanged) {
      body.resource_request = {
        cpu_cores: numberOrNull(raw("cpu")),
        memory_bytes: gibToBytes(raw("mem")),
        accelerators: numberOrNull(raw("gpu")),
      };
    }
    return body;
  };
  return (
    <>
      <RowButton name={workload.name} verb="Edit" onClick={() => setMode("edit")} />
      <RowButton name={workload.name} verb="Delete" danger onClick={() => setMode("delete")} />
      <EditDialog
        title="Edit"
        name={workload.name}
        open={mode === "edit"}
        onClose={close}
        build={build}
        path={path}
        onSaved={onChanged}
        note="This changes the workload record; nothing is deployed, started or stopped."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox id="ew-node" label="Placed on node">
            <select id="ew-node" name="node" defaultValue={workload.node_id ?? ""} className={inputClass}>
              <option value="">Unplaced</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </FieldBox>
          <FieldBox id="ew-desired" label="Desired state">
            <select id="ew-desired" name="desired" defaultValue={workload.desired_state} className={inputClass}>
              <option>running</option>
              <option>stopped</option>
            </select>
          </FieldBox>
          {simulated && (
            <FieldBox id="ew-observed" label="Observed state">
              <select id="ew-observed" name="observed" defaultValue={workload.observed_state} className={inputClass}>
                {["running", "stopped", "degraded", "unknown"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </FieldBox>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FieldBox id="ew-cpu" label="CPU cores"><input id="ew-cpu" name="cpu" type="number" min={0} step="0.5" defaultValue={req.cpu_cores ?? ""} className={inputClass} /></FieldBox>
          <FieldBox id="ew-mem" label="Memory GiB"><input id="ew-mem" name="mem" type="number" min={0} step="any" defaultValue={gibText(req.memory_bytes)} className={inputClass} /></FieldBox>
          <FieldBox id="ew-gpu" label="GPUs"><input id="ew-gpu" name="gpu" type="number" min={0} defaultValue={req.accelerators ?? ""} className={inputClass} /></FieldBox>
        </div>
      </EditDialog>
      <DeleteDialog open={mode === "delete"} title={`Delete ${workload.name}?`} path={path} onClose={close} onDeleted={onChanged}>
        <p>This removes the workload record only. Nothing is stopped or undeployed.</p>
      </DeleteDialog>
    </>
  );
}
