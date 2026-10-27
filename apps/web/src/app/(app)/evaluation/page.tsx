"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Empty,
  ErrorState,
  Kpi,
  Loading,
  PageHeader,
  StatusBadge,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatMs, formatTime } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { Collection, EvalDataset, EvalMetricValue, EvalRun, EvalRunDetail } from "@/lib/types";

const METRICS: { key: string; label: string; help: string; higherIsBetter?: boolean; percent?: boolean }[] = [
  { key: "retrieval_hit_rate", label: "Retrieval hit rate", help: "Expected source found among retrieved passages", higherIsBetter: true, percent: true },
  { key: "mrr", label: "MRR", help: "Mean reciprocal rank of the first expected source", higherIsBetter: true },
  { key: "citation_precision", label: "Citation precision", help: "Share of cited documents that are expected sources", higherIsBetter: true, percent: true },
  { key: "citation_correctness", label: "Citation correctness", help: "Answers whose citations are all expected sources", higherIsBetter: true, percent: true },
  { key: "answer_term_recall", label: "Answer term recall", help: "Expected key facts present in answers", higherIsBetter: true, percent: true },
  { key: "abstention_accuracy", label: "Abstention accuracy", help: "No-answer questions correctly declined", higherIsBetter: true, percent: true },
  { key: "false_abstention_rate", label: "False abstention", help: "Answerable questions wrongly declined", percent: true },
  { key: "injection_resistance", label: "Injection resistance", help: "Injected instructions never echoed or followed", higherIsBetter: true, percent: true },
];

function fmt(value: EvalMetricValue | undefined, percent?: boolean): string {
  if (typeof value !== "number") return "—";
  return percent ? `${Math.round(value * 100)}%` : value.toFixed(2);
}

function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useApi<EvalRunDetail>(`/evaluation/runs/${runId}`);
  return (
    <Dialog open wide title="Evaluation run" onClose={onClose}>
      {run.loading && <Loading />}
      {run.error && <ErrorState error={run.error} />}
      {run.data && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.data.status === "completed" ? "succeeded" : run.data.status} label={run.data.status} />
            <Badge>dataset {run.data.dataset_version}</Badge>
            <Badge tone="info">{run.data.model.provider} · {run.data.model.model}</Badge>
          </div>
          <TableWrap>
            <thead><tr><Th>Q</Th><Th>Category</Th><Th>Evidence</Th><Th>Retrieval</Th><Th>Citations</Th><Th>Terms</Th><Th>Checks</Th></tr></thead>
            <tbody>
              {run.data.results.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <div className="font-mono text-xs">{r.id}</div>
                    {r.question && <div className="max-w-xs text-xs text-muted">{r.question}</div>}
                  </Td>
                  <Td className="text-xs">{r.category}</Td>
                  <Td>{r.error ? <StatusBadge status="failed" label={r.error} /> : r.evidence_status && <StatusBadge status={r.evidence_status} />}</Td>
                  <Td className="text-xs">{r.retrieval_hit === null || r.retrieval_hit === undefined ? "—" : r.retrieval_hit ? "✓ hit" : "✕ miss"}</Td>
                  <Td className="text-xs">{r.citation_correct === null || r.citation_correct === undefined ? "—" : r.citation_correct ? "✓ correct" : "✕ wrong"}</Td>
                  <Td className="text-xs">{typeof r.term_recall === "number" ? `${Math.round(r.term_recall * 100)}%` : "—"}</Td>
                  <Td className="text-xs">
                    {r.injection_resisted === false && <span className="text-bad">injection echoed </span>}
                    {r.injection_resisted === true && <span className="text-ok">injection resisted </span>}
                    {r.restricted_leak === true && <span className="text-bad">restricted leak</span>}
                    {r.restricted_leak === false && <span className="text-ok">no leak</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {run.data.results.some((r) => r.answer === undefined) && (
            <p className="text-xs text-muted">Questions and answers are hidden for roles without document-content access.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function EvaluationPage() {
  const datasets = useApi<EvalDataset[]>("/evaluation/datasets");
  const runs = useApi<EvalRun[]>("/evaluation/runs", (rs) => (rs.some((r) => ["queued", "running"].includes(r.status)) ? 3000 : null));
  const collections = useApi<Collection[]>("/collections");
  const canRun = useCan("eval:run");
  const canCreateCollections = useCan("collection:create");
  const canSeed = canRun && canCreateCollections;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const evalCollections = (collections.data ?? []).filter((c) => c.name.startsWith("Evaluation") && c.access_level);
  const seed = async () => {
    setError(null);
    try {
      const res = await api<{ queued: number; duplicates: number }>("/evaluation/datasets/v1/seed", { method: "POST" });
      setMessage(`Corpus prepared: ${res.queued} documents queued, ${res.duplicates} already present. Wait for indexing before running.`);
      collections.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const start = async () => {
    setError(null);
    try {
      await api("/evaluation/runs", { method: "POST", json: { dataset_version: "v1", collection_ids: evalCollections.map((c) => c.id) } });
      setMessage("Evaluation queued — a worker will run it.");
      runs.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const latest = runs.data?.find((r) => r.status === "completed");

  return (
    <RequirePermission permission="eval:read">
      <PageHeader
        title="Evaluation"
        description="Repeatable retrieval and answer-quality runs against a versioned, labelled question set. Deterministic checks — no LLM judge."
        actions={
          <>
            {canSeed && <Button onClick={seed}>Prepare corpus</Button>}
            {canRun && <Button variant="primary" onClick={start} disabled={!evalCollections.length}>Run evaluation</Button>}
          </>
        }
      />
      {message && <p role="status" className="mb-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">{message}</p>}
      {error && <p role="alert" className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Datasets">
          {datasets.error && <ErrorState error={datasets.error} />}
          {datasets.data?.map((d) => (
            <div key={d.version} className="text-sm">
              <div className="font-medium">{d.version} · {d.questions} questions</div>
              <p className="text-xs text-muted">{d.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(d.categories).map(([c, n]) => <Badge key={c}>{c.replace("_", " ")} ×{n}</Badge>)}
              </div>
            </div>
          ))}
          {canRun && !evalCollections.length && <p className="mt-3 text-xs text-muted">No evaluation collections visible to you yet. An org admin can prepare the corpus.</p>}
        </Card>
        <Card title={latest ? `Latest results · ${formatTime(latest.finished_at)}` : "Latest results"} className="lg:col-span-2">
          {!latest && <p className="text-sm text-muted">No completed runs yet.</p>}
          {latest && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {METRICS.map((m) => <Kpi key={m.key} label={m.label} value={fmt(latest.metrics[m.key], m.percent)} hint={m.help} />)}
              </div>
              <p className="mt-3 text-xs text-muted">
                Restricted leaks: {String(latest.metrics.restricted_leaks ?? "—")} · errors: {String(latest.metrics.errors ?? "—")} · avg latency {formatMs(latest.metrics.latency_avg_ms as number | null)} · p95 {formatMs(latest.metrics.latency_p95_ms as number | null)} · model {latest.model.provider}/{latest.model.model}
              </p>
            </>
          )}
        </Card>
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Run history</h2>
      {runs.loading && <Loading />}
      {runs.error && <ErrorState error={runs.error} onRetry={runs.reload} />}
      {runs.data?.length === 0 && <Empty title="No evaluation runs yet" />}
      {runs.data && runs.data.length > 0 && (
        <TableWrap>
          <thead><tr><Th>Started</Th><Th>Status</Th><Th>Model</Th><Th>Hit rate</Th><Th>Citations</Th><Th>Abstention</Th><Th>Injection</Th><Th>By</Th></tr></thead>
          <tbody>
            {runs.data.map((r) => (
              <tr key={r.id} className="hover:bg-panel-2">
                <Td><button className="underline" onClick={() => setOpen(r.id)}>{formatTime(r.created_at)}</button></Td>
                <Td><StatusBadge status={r.status === "completed" ? "succeeded" : r.status} label={r.status} /></Td>
                <Td className="text-xs">{r.model.provider} · {r.model.model}</Td>
                <Td>{fmt(r.metrics.retrieval_hit_rate, true)}</Td>
                <Td>{fmt(r.metrics.citation_correctness, true)}</Td>
                <Td>{fmt(r.metrics.abstention_accuracy, true)}</Td>
                <Td>{fmt(r.metrics.injection_resistance, true)}</Td>
                <Td className="text-xs text-muted">{r.created_by_email ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {open && <RunDetailDialog runId={open} onClose={() => setOpen(null)} />}
    </RequirePermission>
  );
}
