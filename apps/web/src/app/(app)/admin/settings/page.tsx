"use client";

import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import { Button, Card, ErrorState, inputClass, Loading, PageHeader } from "@/components/ui";
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
    <form onSubmit={submit} onChange={() => setStatus(null)} className="space-y-4">
      <p className="text-sm text-muted">Leave a field empty to use the deployment default.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {NUMERIC.map((field) => (
          <div key={field.key}>
            <label htmlFor={field.key} className="mb-1 block text-sm font-medium">{field.label}</label>
            <input id={field.key} name={field.key} type="number" min={field.min} max={field.max} step={field.step ?? "1"} defaultValue={o[field.key] === null ? "" : String(o[field.key])} placeholder={o[field.key] === null ? `Default: ${data.effective[field.key] ?? "—"}` : "Deployment default"} className={inputClass} />
            <p className="mt-0.5 text-xs text-muted">{field.help}</p>
          </div>
        ))}
        <div>
          <label htmlFor="max_storage_mib" className="mb-1 block text-sm font-medium">Storage quota (MiB)</label>
          <input id="max_storage_mib" name="max_storage_mib" type="number" min={1} defaultValue={quotaText} placeholder="No quota" className={inputClass} />
          <p className="mt-0.5 text-xs text-muted">Uploads that would exceed it are rejected.{o.max_storage_bytes ? ` Current: ${formatBytes(o.max_storage_bytes)}.` : ""}</p>
        </div>
        <div>
          <label htmlFor="ocr_enabled" className="mb-1 block text-sm font-medium">OCR for scanned pages</label>
          <select id="ocr_enabled" name="ocr_enabled" defaultValue={ocrValue} className={inputClass}>
            {/* The API reports only the effective value, which is the default while nothing overrides it. */}
            <option value="default">Deployment default{o.ocr_enabled === null ? ` (${data.effective.ocr_enabled ? "on" : "off"})` : ""}</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {/* Always mounted, so screen readers announce the text when it appears. */}
      <p role="status" className="text-sm font-medium text-ok empty:hidden">{status}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">Last updated {formatTime(data.updated_at)} · {data.note}</span>
        <Button type="submit" variant="primary">Save settings</Button>
      </div>
    </form>
  );
}

export default function SettingsPage() {
  const settings = useApi<TenantSettings>("/settings/tenant");
  return (
    <RequirePermission permission="settings:manage">
      <PageHeader title="Settings" description="Retrieval, chunking, OCR and quota settings for this workspace. Changes are audited." />
      {settings.loading && <Loading />}
      {settings.error && <ErrorState error={settings.error} onRetry={settings.reload} />}
      {settings.data && (
        <Card title="Workspace settings">
          <SettingsForm data={settings.data} onSaved={settings.reload} />
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">The answer model is configured by the deployment environment (MODEL_PROVIDER, MODEL_NAME) so credentials never pass through this console. See Model serving.</p>
    </RequirePermission>
  );
}
