"use client";

import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import { Button, cx, Empty, ErrorState, inputClass, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Collection, InspectItem } from "@/lib/types";

export default function InspectorPage() {
  const collections = useApi<Collection[]>("/collections");
  const [collectionId, setCollectionId] = useState("");
  const [results, setResults] = useState<InspectItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [blank, setBlank] = useState(false);

  const run = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const query = String(new FormData(ev.currentTarget).get("query") ?? "").trim();
    if (busy) return;
    setError(null);
    if (!query) {
      // Old results under an empty box would look like the answer to it.
      setResults(null);
      setBlank(true);
      return;
    }
    setBlank(false);
    setBusy(true);
    try {
      const res = await api<{ items: InspectItem[] }>("/retrieval/inspect", {
        method: "POST",
        json: { query, collection_ids: collectionId ? [collectionId] : null },
      });
      setResults(res.items);
    } catch (e) {
      setResults(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RequirePermission permission="retrieval:inspect">
      <PageHeader title="Retrieval inspector" description="See exactly which authorized chunks a query retrieves, with similarity scores, before any model is involved." />
      <form onSubmit={run} className="mb-8 flex flex-wrap items-start gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-72 sm:flex-1">
          <label htmlFor="iq" className="mb-1 block text-sm font-medium text-text">Query</label>
          <input id="iq" name="query" maxLength={4000} className={cx(inputClass, "h-10 aria-invalid:border-bad")} placeholder="e.g. replica failover" aria-invalid={blank || undefined} aria-describedby={blank ? "iq-error" : undefined} onChange={() => setBlank(false)} />
          {blank && <p id="iq-error" role="alert" className="mt-1 text-xs text-bad">Type a query to inspect.</p>}
        </div>
        <div className="w-full min-w-0 sm:w-56">
          <label htmlFor="ic" className="mb-1 block text-sm font-medium text-text">Collection</label>
          <select id="ic" className={cx(inputClass, "h-10")} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">All accessible</option>
            {collections.data?.filter((c) => c.access_level).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {/* The labels above the fields are one line tall; this spacer lines the key up with the fields. */}
        <div className="w-full sm:w-auto">
          <span aria-hidden="true" className="mb-1 hidden text-sm sm:block">&nbsp;</span>
          <Button type="submit" variant="primary" className="min-h-10 w-full sm:w-auto" aria-disabled={busy || undefined} aria-busy={busy || undefined}>{busy ? "Searching…" : "Inspect"}</Button>
        </div>
      </form>
      {error !== null && <ErrorState error={error} />}
      {results && results.length === 0 && <Empty title="No chunks above the similarity threshold" />}
      {results && results.length > 0 && (
        <ol className="border-t border-border">
          {results.map((r, i) => (
            <li key={r.chunk_id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b border-border py-4">
              <span className="font-display text-lg font-semibold text-muted tabular-nums">{i + 1}</span>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="text-sm font-medium text-text wrap-anywhere">{r.filename}</span>
                  <span>page <span className="font-mono">{r.page_start ?? "—"}</span></span>
                  <span>score <span className="font-mono tabular-nums">{r.score.toFixed(3)}</span></span>
                </div>
                <p className="max-w-[72ch] text-sm leading-6 whitespace-pre-wrap text-text-2 wrap-anywhere">{r.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </RequirePermission>
  );
}
