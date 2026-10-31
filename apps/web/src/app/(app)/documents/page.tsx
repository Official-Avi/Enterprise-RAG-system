"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/icons";
import {
  Button,
  Card,
  cx,
  Empty,
  ErrorState,
  inputClass,
  Loading,
  PageHeader,
  StatusBadge,
  TableWrap,
  Td,
  Th,
  UpdatedAt,
} from "@/components/ui";
import { api, ApiError, errorText, uploadFiles } from "@/lib/api";
import { formatBytes, formatTime } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { Collection, DocumentItem, Page, UploadItem } from "@/lib/types";

const ALLOWED = [".pdf", ".docx", ".txt", ".md", ".markdown"];
const MAX_BYTES = 25 * 1024 * 1024;
const ACTIVE = new Set(["queued", "processing", "deleting"]);

function precheck(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED.some((ext) => name.endsWith(ext))) return "Unsupported file type";
  if (file.size > MAX_BYTES) return "Larger than 25 MiB";
  if (file.size === 0) return "File is empty";
  return null;
}

function UploadPanel({ collections, onUploaded }: { collections: Collection[]; onUploaded: () => void }) {
  const writable = collections.filter((c) => c.access_level === "write" || c.access_level === "manage");
  const [collectionId, setCollectionId] = useState(writable[0]?.id ?? "");
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (files: File[]) => {
    // One upload at a time: a drop during an upload would otherwise start a second one.
    if (!files.length || !collectionId || progress !== null) return;
    const local: UploadItem[] = [];
    const accepted: File[] = [];
    for (const f of files) {
      const problem = precheck(f);
      if (problem) {
        local.push({ filename: f.name, status: "rejected", document_id: null, job_id: null, duplicate: false, error: { code: "CLIENT_CHECK", message: problem } });
      } else accepted.push(f);
    }
    setError(null);
    setResults(local);
    if (!accepted.length) return;
    setProgress(0);
    try {
      const res = await uploadFiles<{ items: UploadItem[] }>(`/collections/${collectionId}/documents`, accepted, setProgress);
      setResults([...local, ...res.items]);
      onUploaded();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setProgress(null);
    }
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    void send(Array.from(ev.dataTransfer.files));
  };

  if (!writable.length) {
    return (
      <Card title="Upload">
        <p className="text-sm text-muted">You don&apos;t have write access to any collection.</p>
      </Card>
    );
  }
  return (
    <Card title="Upload documents">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <label htmlFor="upload-collection" className="mb-1 block text-sm font-medium">Into collection</label>
          <select id="upload-collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className={inputClass}>
            {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "mt-3 rounded-lg border-2 border-dashed px-4 py-6 text-center",
          dragging ? "border-accent bg-accent-soft" : "border-border",
        )}
      >
        <Icon name="upload" width={22} height={22} className="mx-auto text-muted" />
        <p className="mt-2 text-sm">Drag files here, or</p>
        {/* aria-disabled, not disabled: the button keeps focus while the upload runs (§9 #5). */}
        <Button
          className="mt-2"
          aria-disabled={progress !== null || undefined}
          onClick={() => {
            if (progress === null) inputRef.current?.click();
          }}
        >
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED.join(",")}
          className="sr-only"
          aria-label="Choose files to upload"
          onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
        <p className="mt-2 text-xs text-muted">PDF, DOCX, TXT, Markdown · up to 25 MiB each · scanned PDFs are OCR-processed</p>
      </div>
      {/* Outside the live region: every progress tick would otherwise be read out. */}
      {progress !== null && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded bg-panel-2" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            {/* scaleX, not width: §8.4 animates transforms only, never layout. */}
            <div
              className="h-full w-full origin-left bg-accent transition-transform duration-150"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">Uploading… {Math.round(progress * 100)}%</p>
        </div>
      )}
      <div aria-live="polite">
        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border text-sm">
            {results.map((r, i) => (
              <li key={`${r.filename}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{r.filename}</span>
                <span className="flex items-center gap-2">
                  {r.error && <span className="text-xs text-bad">{r.error.message}</span>}
                  {r.duplicate && <span className="text-xs text-muted">Already in this collection</span>}
                  <StatusBadge status={r.status === "rejected" ? "failed" : r.status === "duplicate" ? "skipped" : "queued"} label={r.status === "rejected" ? "Rejected" : r.status === "duplicate" ? "Duplicate" : "Queued"} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function DocumentsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const collection = params.get("collection") ?? "";
  const status = params.get("status") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const collections = useApi<Collection[]>("/collections");
  const qs = new URLSearchParams();
  if (collection) qs.set("collection_id", collection);
  if (status) qs.set("status", status);
  if (params.get("q")) qs.set("q", params.get("q")!);
  qs.set("limit", "100");
  const docs = useApi<Page<DocumentItem>>(`/documents?${qs}`, (d) =>
    d.items.some((x) => ACTIVE.has(x.status)) ? 2500 : 15000,
  );
  const canUpload = useCan("document:upload");
  const canDelete = useCan("document:delete");
  const canRetry = useCan("document:retry");

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/documents?${next}`);
  };

  const act = async (doc: DocumentItem, action: "retry" | "delete") => {
    if (action === "delete" && !window.confirm(`Delete "${doc.filename}"? Its chunks and vectors will be removed.`)) return;
    try {
      await api(`/documents/${doc.id}${action === "retry" ? "/retry" : ""}`, { method: action === "retry" ? "POST" : "DELETE" });
      docs.reload();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "Action failed.");
    }
  };

  return (
    <>
      <PageHeader title="Documents" description="Upload, track processing and manage indexed knowledge." actions={<UpdatedAt at={docs.updatedAt} />} />
      {canUpload && collections.data && <div className="mb-4"><UploadPanel collections={collections.data} onUploaded={docs.reload} /></div>}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="f-col" className="mb-1 block text-xs font-medium text-muted">Collection</label>
          <select id="f-col" value={collection} onChange={(e) => setParam("collection", e.target.value)} className={inputClass}>
            <option value="">All collections</option>
            {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-muted">Status</label>
          <select id="f-status" value={status} onChange={(e) => setParam("status", e.target.value)} className={inputClass}>
            <option value="">Any status</option>
            {["queued", "processing", "indexed", "failed", "deleting"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setParam("q", q); }} className="flex items-end gap-2">
          <div>
            <label htmlFor="f-q" className="mb-1 block text-xs font-medium text-muted">Filename</label>
            <input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={inputClass} />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>
      {docs.loading && <Loading />}
      {docs.error && <ErrorState error={docs.error} onRetry={docs.reload} />}
      {docs.data && docs.data.items.length === 0 && <Empty title="No documents match">Upload files or adjust the filters.</Empty>}
      {docs.data && docs.data.items.length > 0 && (
        <TableWrap>
          <thead>
            <tr><Th>File</Th><Th>Collection</Th><Th>Status</Th><Th>Pages / chunks</Th><Th>Size</Th><Th>Uploaded</Th><Th><span className="sr-only">Actions</span></Th></tr>
          </thead>
          <tbody>
            {docs.data.items.map((d) => (
              <tr key={d.id} className="hover:bg-panel-2">
                <Td>
                  <Link href={`/documents/${d.id}`} className="font-medium hover:underline">{d.filename}</Link>
                  <div className="text-xs uppercase text-muted">{d.file_type}{d.extraction_method === "ocr" || d.extraction_method === "mixed" ? " · OCR" : ""}</div>
                </Td>
                <Td className="text-muted">{d.collection_name}</Td>
                <Td>
                  <StatusBadge status={d.status} />
                  {d.latest_job && ["running", "retry_wait"].includes(d.latest_job.status) && (
                    <div className="mt-0.5 text-xs text-muted">{d.latest_job.stage ?? d.latest_job.status} · attempt {d.latest_job.attempt_count}/{d.latest_job.max_attempts}</div>
                  )}
                  {d.status === "failed" && d.latest_job?.safe_error_message && <div className="mt-0.5 max-w-xs text-xs text-bad">{d.latest_job.safe_error_message}</div>}
                  {d.warnings.length > 0 && <div className="mt-0.5 text-xs text-warn">{d.warnings.length} warning{d.warnings.length > 1 ? "s" : ""}</div>}
                </Td>
                <Td className="tabular-nums">{d.page_count ?? "—"} / {d.chunk_count ?? "—"}</Td>
                <Td className="tabular-nums text-muted">{formatBytes(d.size_bytes)}</Td>
                <Td className="text-muted">{formatTime(d.created_at)}</Td>
                <Td className="whitespace-nowrap text-right">
                  {canRetry && d.status === "failed" && <Button onClick={() => act(d, "retry")}>Retry</Button>}{" "}
                  {canDelete && !["deleting", "deleted"].includes(d.status) && <Button variant="danger" onClick={() => act(d, "delete")}>Delete</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentsInner />
    </Suspense>
  );
}
