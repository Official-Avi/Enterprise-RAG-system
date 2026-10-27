"use client";

import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import { Button, Empty, ErrorState, inputClass, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Collection, InspectItem } from "@/lib/types";

export default function InspectorPage() {
  const collections = useApi<Collection[]>("/collections");
  const [collectionId, setCollectionId] = useState("");
  const [results, setResults] = useState<InspectItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const query = String(new FormData(ev.currentTarget).get("query") ?? "").trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ items: InspectItem[] }>("/retrieval/inspect", {
        method: "POST",
        json: { query, collection_ids: collectionId ? [collectionId] : null },
      });
      setResults(res.items);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RequirePermission permission="retrieval:inspect">
      <PageHeader title="Retrieval inspector" description="See exactly which authorized chunks a query retrieves, with similarity scores, before any model is involved." />
      <form onSubmit={run} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-72 flex-1">
          <label htmlFor="iq" className="mb-1 block text-xs font-medium text-muted">Query</label>
          <input id="iq" name="query" required maxLength={4000} className={inputClass} placeholder="e.g. replica failover" />
        </div>
        <div>
          <label htmlFor="ic" className="mb-1 block text-xs font-medium text-muted">Collection</label>
          <select id="ic" className={inputClass} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">All accessible</option>
            {collections.data?.filter((c) => c.access_level).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Searching…" : "Inspect"}</Button>
      </form>
      {error !== null && <ErrorState error={error} />}
      {results && results.length === 0 && <Empty title="No chunks above the similarity threshold" />}
      <ol className="space-y-2">
        {results?.map((r, i) => (
          <li key={r.chunk_id} className="rounded-lg border border-border bg-panel p-3">
            <div className="mb-1 flex flex-wrap gap-3 text-xs text-muted">
              <span className="font-semibold text-text">#{i + 1}</span>
              <span>{r.filename}</span>
              <span>page {r.page_start ?? "—"}</span>
              <span>score {r.score.toFixed(3)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{r.text}</p>
          </li>
        ))}
      </ol>
    </RequirePermission>
  );
}
