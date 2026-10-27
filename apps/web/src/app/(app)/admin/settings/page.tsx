"use client";

import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import { Button, Card, ErrorState, inputClass, Loading, PageHeader } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { TenantSettings, TenantSettingsValues } from "@/lib/types";

type Field = { key: keyof TenantSettingsValues; label: string; help: string; step?: string };

const NUMERIC: Field[] = [
  { key: "retrieval_top_k", label: "Retrieved chunks (top-k)", help: "How many passages are sent to the model (1–50)." },
  { key: "retrieval_score_threshold", label: "Similarity threshold", help: "Minimum cosine similarity, 0–1. Higher = stricter.", step: "0.01" },
  { key: "chunk_size_tokens", label: "Chunk size (tokens)", help: "Applies to documents processed after the change." },
  { key: "chunk_overlap_tokens", label: "Chunk overlap (tokens)", help: "Must be smaller than the chunk size." },
];

function SettingsForm({ data, onSaved }: { data: TenantSettings; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, number | boolean | null> = {};
    for (const field of NUMERIC) {
      const raw = String(f.get(field.key) ?? "").trim();
      body[field.key] = raw === "" ? null : Number(raw);
    }
    const quota = String(f.get("max_storage_mib") ?? "").trim();
    body.max_storage_bytes = quota === "" ? null : Math.round(Number(quota) * 1024 * 1024);
    const ocr = String(f.get("ocr_enabled"));
    body.ocr_enabled = ocr === "default" ? null : ocr === "on";
    setError(null);
    setSaved(false);
    try {
      await api("/settings/tenant", { method: "PATCH", json: body });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const o = data.overrides;
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted">Leave a field empty to use the deployment default (shown as placeholder).</p>
      <div className="grid gap-4 md:grid-cols-2">
        {NUMERIC.map((field) => (
          <div key={field.key}>
            <label htmlFor={field.key} className="mb-1 block text-sm font-medium">{field.label}</label>
            <input id={field.key} name={field.key} type="number" step={field.step ?? "1"} defaultValue={o[field.key] === null ? "" : String(o[field.key])} placeholder={`Default: ${data.effective[field.key] ?? "—"}`} className={inputClass} />
            <p className="mt-0.5 text-xs text-muted">{field.help}</p>
          </div>
        ))}
        <div>
          <label htmlFor="max_storage_mib" className="mb-1 block text-sm font-medium">Storage quota (MiB)</label>
          <input id="max_storage_mib" name="max_storage_mib" type="number" min={1} defaultValue={o.max_storage_bytes ? String(Math.round(o.max_storage_bytes / 1048576)) : ""} placeholder="No quota" className={inputClass} />
          <p className="mt-0.5 text-xs text-muted">Uploads that would exceed it are rejected.{o.max_storage_bytes ? ` Current: ${formatBytes(o.max_storage_bytes)}.` : ""}</p>
        </div>
        <div>
          <label htmlFor="ocr_enabled" className="mb-1 block text-sm font-medium">OCR for scanned pages</label>
          <select id="ocr_enabled" name="ocr_enabled" defaultValue={o.ocr_enabled === null ? "default" : o.ocr_enabled ? "on" : "off"} className={inputClass}>
            <option value="default">Deployment default ({data.effective.ocr_enabled ? "on" : "off"})</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {saved && <p role="status" className="text-sm text-ok">Settings saved.</p>}
      <div className="flex items-center justify-between">
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
          <SettingsForm key={settings.data.updated_at ?? "initial"} data={settings.data} onSaved={settings.reload} />
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">The answer model is configured by the deployment environment (MODEL_PROVIDER, MODEL_NAME) so credentials never pass through this console. See Model serving.</p>
    </RequirePermission>
  );
}
