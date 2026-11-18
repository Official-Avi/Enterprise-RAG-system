"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { RequirePermission } from "@/components/Shell";
import { Button, Card, cx, ErrorState, inputClass, PageHeader } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { TenantSettings, TenantSettingsValues } from "@/lib/types";

type Field = { key: keyof TenantSettingsValues; label: string; help: string; min: number; max: number; step?: string };

const NUMERIC: Field[] = [
  { key: "retrieval_top_k", label: "Retrieved chunks (top-k)", help: "How many passages are sent to the model (1–50).", min: 1, max: 50 },
  { key: "retrieval_score_threshold", label: "Similarity threshold", help: "Minimum cosine similarity, 0–1. Higher = stricter.", min: 0, max: 1, step: "0.01" },
  { key: "chunk_size_tokens", label: "Chunk size (tokens)", help: "50–2000. Applies to documents processed after the change.", min: 50, max: 2000 },
  { key: "chunk_overlap_tokens", label: "Chunk overlap (tokens)", help: "0–500. Must be smaller than the chunk size.", min: 0, max: 500 },
];

function SettingsForm({ data, onSaved }: { data: TenantSettings; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  // Stays until the next edit; the form stays mounted through the reload that follows a save.
  const [status, setStatus] = useState<string | null>(null);
  const o = data.overrides;
  const quotaText = o.max_storage_bytes ? String(Math.round(o.max_storage_bytes / 1048576)) : "";
  const ocrValue = o.ocr_enabled === null ? "default" : o.ocr_enabled ? "on" : "off";
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    // Only what changed, so the audit row names only those fields.
    const body: Record<string, number | boolean | null> = {};
    for (const field of NUMERIC) {
      const raw = String(f.get(field.key) ?? "").trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== o[field.key]) body[field.key] = value;
    }
    const quota = String(f.get("max_storage_mib") ?? "").trim();
    if (quota !== quotaText) body.max_storage_bytes = quota === "" ? null : Math.round(Number(quota) * 1024 * 1024);
    const ocr = String(f.get("ocr_enabled"));
    if (ocr !== ocrValue) body.ocr_enabled = ocr === "default" ? null : ocr === "on";
    setError(null);
    setStatus(null);
    if (Object.keys(body).length === 0) {
      setStatus("No changes to save.");
      return;
    }
    try {
      await api("/settings/tenant", { method: "PATCH", json: body });
      setStatus("Settings saved.");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <form onSubmit={submit} onChange={() => setStatus(null)}>
      <p className="text-sm text-text-2">Leave a field empty to use the deployment default.</p>
      {/* One ruled row per setting: what it does on the left, the control on the right. */}
      <div className="mt-4 divide-y divide-border border-y border-border">
        {NUMERIC.map((field) => (
          <SettingRow key={field.key} id={field.key} label={field.label} help={field.help}>
            <input id={field.key} name={field.key} type="number" min={field.min} max={field.max} step={field.step ?? "1"} defaultValue={o[field.key] === null ? "" : String(o[field.key])} placeholder={o[field.key] === null ? data.effective[field.key] == null ? "No default" : `Default: ${data.effective[field.key]}` : "Deployment default"} aria-describedby={`${field.key}-help`} className={cx(inputClass, "tabular-nums focus-visible:border-accent")} />
          </SettingRow>
        ))}
        <SettingRow
          id="max_storage_mib"
          label="Storage quota (MiB)"
          help={`Uploads that would exceed it are rejected.${o.max_storage_bytes ? ` Current: ${formatBytes(o.max_storage_bytes)}.` : ""}`}
        >
          <input id="max_storage_mib" name="max_storage_mib" type="number" min={1} defaultValue={quotaText} placeholder="No quota" aria-describedby="max_storage_mib-help" className={cx(inputClass, "tabular-nums focus-visible:border-accent")} />
        </SettingRow>
        <SettingRow id="ocr_enabled" label="OCR for scanned pages">
          <select id="ocr_enabled" name="ocr_enabled" defaultValue={ocrValue} className={cx(inputClass, "focus-visible:border-accent")}>
            {/* The API reports only the effective value, which is the default while nothing overrides it. */}
            <option value="default">Deployment default{o.ocr_enabled === null ? ` (${data.effective.ocr_enabled ? "on" : "off"})` : ""}</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </SettingRow>
      </div>
      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          <Icon name="cross" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {/* Always mounted, so screen readers announce the text when it appears. */}
      <p role="status" className={cx("mt-4 text-sm font-medium empty:hidden", status === "Settings saved." ? "text-ok" : "text-text-2")}>{status}</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <p className="flex flex-col text-xs text-muted">
          <span>{data.updated_at ? <>Last updated <span className="tabular-nums">{formatTime(data.updated_at)}</span></> : "Never updated"}</span>
          <span>{data.note}</span>
        </p>
        <Button type="submit" variant="primary">Save settings</Button>
      </div>
    </form>
  );
}

/** A setting: label and help on the left, the control on the right; stacked on phones. */
function SettingRow({ id, label, help, children }: { id: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-start">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-text">{label}</label>
        {help && <p id={`${id}-help`} className="mt-1 max-w-[52ch] text-xs text-muted">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div role="status" className="rounded-card border border-border bg-panel p-4">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="divide-y divide-border">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="space-y-2">
              <div className="h-4 w-40 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
              <div className="h-3 w-64 max-w-full motion-safe:animate-shimmer rounded-sm bg-panel-3" />
            </div>
            <div className="h-10 motion-safe:animate-shimmer rounded-input bg-panel-3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const settings = useApi<TenantSettings>("/settings/tenant");
  return (
    <RequirePermission permission="settings:manage">
      <PageHeader title="Settings" description="Retrieval, chunking, OCR and quota settings for this workspace. Changes are audited." />
      <div className="max-w-[60rem]">
        {settings.loading && <SettingsSkeleton />}
        {settings.error && <ErrorState error={settings.error} onRetry={settings.reload} />}
        {settings.data && (
          <Card title="Workspace settings">
            <SettingsForm data={settings.data} onSaved={settings.reload} />
          </Card>
        )}
        <p className="mt-4 max-w-[72ch] text-xs text-muted">The answer model is configured by the deployment environment (<code className="font-mono">MODEL_PROVIDER</code>, <code className="font-mono">MODEL_NAME</code>) so credentials never pass through this console. See Model serving.</p>
      </div>
    </RequirePermission>
  );
}
