"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import { Button, cx, Empty, ErrorState, inputClass, Loading, StatusBadge } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatMs } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AnswerResponse, ChatMessage, ChatSession, Citation, Collection, ModelHealth } from "@/lib/types";

/** Render answer text as plain text, turning [n] markers that map to citations into chips. */
function AnswerText({ text, citations, onCite }: { text: string; citations: Citation[]; onCite: (c: Citation) => void }) {
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  const parts = text.split(/(\[\d{1,3}\])/g);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => {
        const m = /^\[(\d{1,3})\]$/.exec(part);
        const cite = m ? byMarker.get(Number(m[1])) : undefined;
        if (!cite) return <span key={i}>{part}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCite(cite)}
            className="mx-0.5 rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent align-baseline hover:underline"
            aria-label={`Source ${cite.marker}: ${cite.filename}${cite.page ? `, page ${cite.page}` : ""}`}
          >
            {cite.marker}
          </button>
        );
      })}
    </p>
  );
}

function SourcePanel({ citation, onClose }: { citation: Citation | null; onClose: () => void }) {
  if (!citation) {
    return <p className="text-sm text-muted">Select a citation to see the exact passage the answer relied on.</p>;
  }
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-accent">Source [{citation.marker}]</div>
          <div className="font-medium">{citation.filename}</div>
          <div className="text-xs text-muted">
            {citation.page ? `Page ${citation.page}` : "No page information"}
            {citation.score !== null && ` · relevance ${citation.score.toFixed(2)}`}
          </div>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close source">✕</Button>
      </div>
      <blockquote className="mt-3 border-l-2 border-accent pl-3 text-sm">{citation.quote}</blockquote>
      <Link
        href={`/documents/${citation.document_id}${citation.chunk_id ? `#chunk-${citation.chunk_id}` : ""}`}
        className="mt-3 inline-block text-sm text-accent underline"
      >
        Open document
      </Link>
    </div>
  );
}

function NewSession({ collections, onCreated }: { collections: Collection[]; onCreated: (s: ChatSession) => void }) {
  const usable = collections.filter((c) => c.access_level !== null);
  const [selected, setSelected] = useState<string[]>(usable.map((c) => c.id));
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    try {
      onCreated(await api<ChatSession>("/chat/sessions", { method: "POST", json: { collection_ids: selected } }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!usable.length) return <Empty title="No searchable collections">Ask an admin for access to a collection.</Empty>;
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Search these collections</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {usable.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))}
              />
              {c.name} <span className="text-xs text-muted">({c.document_count})</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      <Button variant="primary" className="mt-3" disabled={!selected.length} onClick={create}>Start conversation</Button>
    </div>
  );
}

function Conversation({ session, model }: { session: ChatSession; model?: ModelHealth }) {
  const detail = useApi<{ session: ChatSession; messages: ChatMessage[] }>(`/chat/sessions/${session.id}`);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Citation | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [detail.data, pending]);

  const ask = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const message = String(new FormData(form).get("message") ?? "").trim();
    if (!message) return;
    setPending(message);
    setError(null);
    try {
      await api<AnswerResponse>(`/chat/sessions/${session.id}/messages`, { method: "POST", json: { message } });
      form.reset();
      detail.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex min-h-[60vh] flex-col rounded-lg border border-border bg-panel">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {detail.loading && <Loading />}
          {detail.error && <ErrorState error={detail.error} onRetry={detail.reload} />}
          {detail.data?.messages.length === 0 && !pending && (
            <p className="text-sm text-muted">Ask a question about the selected collections. Answers cite the passages they rely on.</p>
          )}
          {detail.data?.messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ml-auto max-w-[80%] rounded-lg bg-accent-soft px-3 py-2 text-sm">{m.content}</div>
            ) : (
              <div key={m.id} className="max-w-[90%] rounded-lg border border-border px-3 py-2 text-sm">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {m.evidence_status && <StatusBadge status={m.evidence_status} />}
                  {m.model && <span className="text-xs text-muted">{m.model.provider} · {m.model.name} · {formatMs(m.latency_ms)}</span>}
                </div>
                <AnswerText text={m.content} citations={m.citations} onCite={setActive} />
                {m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <button
                        key={c.marker}
                        type="button"
                        onClick={() => setActive(c)}
                        className={cx("rounded-full border px-2 py-0.5 text-xs", active === c ? "border-accent text-accent" : "border-border text-muted hover:text-text")}
                      >
                        [{c.marker}] {c.filename}{c.page ? ` p.${c.page}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {pending && (
            <>
              <div className="ml-auto max-w-[80%] rounded-lg bg-accent-soft px-3 py-2 text-sm">{pending}</div>
              <div role="status" className="text-sm text-muted">Searching sources and drafting an answer…</div>
            </>
          )}
          <div ref={endRef} />
        </div>
        {error && <p role="alert" className="mx-4 mb-2 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <form onSubmit={ask} className="flex gap-2 border-t border-border p-3">
          <label htmlFor="chat-input" className="sr-only">Your question</label>
          <textarea
            id="chat-input"
            name="message"
            rows={2}
            maxLength={4000}
            required
            placeholder="e.g. How do I fail over the database?"
            className={cx(inputClass, "resize-none")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" variant="primary" disabled={pending !== null}>Ask</Button>
        </form>
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg border border-border bg-panel p-4">
          <SourcePanel citation={active} onClose={() => setActive(null)} />
        </div>
        <div className="rounded-lg border border-border bg-warn-soft p-3 text-xs text-warn">
          Answers are generated from your documents and can be wrong. Verify critical operational steps before acting.
          {model?.provider === "extractive" && (
            <p className="mt-1 font-medium">No language model is configured: answers quote the most relevant passages (extractive mode).</p>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function ChatPage() {
  const sessions = useApi<{ items: ChatSession[] }>("/chat/sessions");
  const collections = useApi<Collection[]>("/collections");
  const model = useApi<ModelHealth>("/models/health");
  const [current, setCurrent] = useState<ChatSession | null>(null);
  const [creating, setCreating] = useState(false);
  const active = current ?? (creating ? null : sessions.data?.items[0] ?? null);

  return (
    <RequirePermission permission="chat:use">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
        <div className="flex items-center gap-2">
          {sessions.data && sessions.data.items.length > 0 && (
            <select
              aria-label="Conversation"
              className={inputClass}
              value={active?.id ?? ""}
              onChange={(e) => { setCreating(false); setCurrent(sessions.data!.items.find((s) => s.id === e.target.value) ?? null); }}
            >
              {creating && <option value="">New conversation…</option>}
              {sessions.data.items.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          )}
          <Button onClick={() => { setCurrent(null); setCreating(true); }}>New conversation</Button>
        </div>
      </div>
      {(sessions.loading || collections.loading) && <Loading />}
      {sessions.error && <ErrorState error={sessions.error} onRetry={sessions.reload} />}
      {!sessions.loading && !active && collections.data && (
        <NewSession
          collections={collections.data}
          onCreated={(s) => { setCreating(false); setCurrent(s); sessions.reload(); }}
        />
      )}
      {active && <Conversation key={active.id} session={active} model={model.data} />}
    </RequirePermission>
  );
}
