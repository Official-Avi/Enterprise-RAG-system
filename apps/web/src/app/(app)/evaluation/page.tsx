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

/** The collections evaluation seeding creates for the dataset (evaluation/seed.py). Exact, so that
 *  a collection someone happens to call "Evaluation reports" stays out of the labelled metrics. */
const DATASET = "v1";
const CORPUS_NAMES = [`Evaluation corpus (${DATASET})`, `Evaluation restricted (${DATASET})`];

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

const errorCount = (r: EvalRun) => (typeof r.metrics.errors === "number" ? r.metrics.errors : 0);
/** Runs from before the completed_with_errors status finished as plain "completed", so the count
 *  in their metrics is what gives them away. */
const hasErrors = (r: EvalRun) => r.status === "completed_with_errors" || (r.status === "completed" && errorCount(r) > 0);
const isFinished = (r: EvalRun) => r.status === "completed" || r.status === "completed_with_errors";
const isActive = (r: EvalRun) => r.status === "queued" || r.status === "running";

function RunStatus({ run }: { run: EvalRun }) {
  // "stale" is the amber warning badge: errors must never read as a green check.
  if (hasErrors(run)) return <StatusBadge status="stale" label="Completed with errors" />;
  return <StatusBadge status={run.status === "completed" ? "succeeded" : run.status} label={run.status} />;
}

function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = useApi<EvalRunDetail>(`/evaluation/runs/${runId}`);
  return (
    <Dialog open wide title="Evaluation run" onClose={onClose}>
      {run.loading && <Loading />}
      {run.error && <ErrorState error={run.error} onRetry={run.reload} />}
      {run.data && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatus run={run.data} />
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
          {/* A row that errored never had a question; a scored row without one had it hidden by the API. */}
          {run.data.results.some((r) => !r.error && r.question === undefined) && (
            <p className="text-xs text-muted">Questions and answers are hidden unless you can read document content in every collection this run searched.</p>
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
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const evalCollections = (collections.data ?? []).filter((c) => CORPUS_NAMES.includes(c.name) && c.access_level);
  const canStart = evalCollections.length > 0;

  const seed = async () => {
    if (seeding) return;
    setSeeding(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ queued: number; duplicates: number; rejected: string[] }>(`/evaluation/datasets/${DATASET}/seed`, { method: "POST" });
      setStartedRunId(null);
      if (res.rejected.length) {
        // Scores from a partial corpus would look like real results, so never call this one ready.
        setError(`The corpus isn't ready: ${res.rejected.length} file${res.rejected.length === 1 ? " was" : "s were"} refused (${res.queued} queued, ${res.duplicates} already present). Fix this and prepare it again before running. ${res.rejected.join("; ")}.`);
      } else {
        setMessage(
          res.queued
            ? `Corpus prepared: ${res.queued} documents queued for indexing, ${res.duplicates} already present. Wait until Documents shows them as indexed before running.`
            : `Corpus is ready: all ${res.duplicates} documents are already present.`,
        );
      }
      collections.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSeeding(false);
    }
  };
  const start = async () => {
    if (starting || !canStart) return;
    setStarting(true);
    setError(null);
    try {
      const run = await api<EvalRun>("/evaluation/runs", { method: "POST", json: { dataset_version: DATASET, collection_ids: evalCollections.map((c) => c.id) } });
      setMessage(null);
      setStartedRunId(run.id);
      runs.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  };
  // Tied to the run itself, so the note goes away when the run finishes. Until the list has caught
  // up with the new run, it is still waiting.
  const startedRun = runs.data?.find((r) => r.id === startedRunId);
  const waiting = startedRunId !== null && (!startedRun || isActive(startedRun));

  const finished = runs.data?.filter(isFinished) ?? [];
  // The headline is the newest run that answered every question. A run with errors counts failed
  // questions as misses, so its figures aren't comparable: it only leads when nothing else exists.
  const clean = finished.find((r) => !hasErrors(r));
  const latest = clean ?? finished[0];
  const newestWithErrors = finished[0] && hasErrors(finished[0]) ? finished[0] : undefined;

  return (
    <RequirePermission permission="eval:read">
      <PageHeader
        title="Evaluation"
        description="Repeatable retrieval and answer-quality runs against a versioned, labelled question set. Deterministic checks — no LLM judge."
        actions={
          <>
            {canSeed && <Button aria-disabled={seeding || undefined} onClick={() => void seed()}>{seeding ? "Preparing…" : "Prepare corpus"}</Button>}
            {canRun && <Button variant="primary" aria-disabled={starting || !canStart || undefined} onClick={() => void start()}>{starting ? "Starting…" : "Run evaluation"}</Button>}
          </>
        }
      />
      {/* One always-mounted status region, so changes in it are announced. */}
      <div role="status">
        {(message || waiting) && (
          <p className="mb-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
            {waiting ? "Evaluation queued. A worker will run it, and the result appears below." : message}
          </p>
        )}
      </div>
      {error && <p role="alert" className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Datasets">
          {datasets.loading && <Loading />}
          {datasets.error && <ErrorState error={datasets.error} onRetry={datasets.reload} />}
          {datasets.data?.map((d) => (
            <div key={d.version} className="text-sm">
              <div className="font-medium">{d.version} · {d.questions} questions</div>
              <p className="text-xs text-muted">{d.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(d.categories).map(([c, n]) => <Badge key={c}>{c.replace("_", " ")} ×{n}</Badge>)}
              </div>
            </div>
          ))}
          {canRun && collections.data && !evalCollections.length && <p className="mt-3 text-xs text-muted">No evaluation collections visible to you yet. An org admin can prepare the corpus.</p>}
          {/* Run evaluation stays unavailable without this list, so the failure needs saying. */}
          {canRun && collections.error && <div className="mt-3"><ErrorState error={collections.error} onRetry={collections.reload} /></div>}
        </Card>
        <Card title={latest ? `Latest results · ${formatTime(latest.finished_at)}` : "Latest results"} className="lg:col-span-2">
          {runs.loading && <Loading />}
          {runs.error && !runs.data && <p className="text-sm text-muted">Unavailable until the run history below loads.</p>}
          {runs.data && !latest && <p className="text-sm text-muted">No completed runs yet.</p>}
          {latest && (
            <>
              {hasErrors(latest) ? (
                <p role="note" className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
                  Every run so far had errors, so treat these figures with care: this run had {errorCount(latest) || "some"} question{errorCount(latest) === 1 ? "" : "s"} fail, and these figures leave those out.
                </p>
              ) : (
                newestWithErrors && (
                  <p role="note" className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
                    The newest run ({formatTime(newestWithErrors.finished_at)}) finished with errors, so these figures come from the latest run without any.
                  </p>
                )
              )}
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
                <Td><button className="inline-flex min-h-6 items-center underline" onClick={() => setOpen(r.id)}>{formatTime(r.created_at)}</button></Td>
                <Td><RunStatus run={r} /></Td>
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
