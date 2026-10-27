"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  ErrorState,
  inputClass,
  Loading,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { Collection } from "@/lib/types";

function CreateCollection({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/collections", {
        method: "POST",
        json: {
          name: String(f.get("name")),
          description: String(f.get("description") ?? ""),
          visibility: String(f.get("visibility")),
        },
      });
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>New collection</Button>
      <Dialog open={open} title="New collection" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="c-name" className="mb-1 block text-sm font-medium">Name</label>
            <input id="c-name" name="name" required maxLength={200} className={inputClass} />
          </div>
          <div>
            <label htmlFor="c-desc" className="mb-1 block text-sm font-medium">Description</label>
            <textarea id="c-desc" name="description" rows={2} maxLength={2000} className={inputClass} />
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Visibility</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="visibility" value="tenant" defaultChecked className="mt-1" />
              <span>Workspace — all engineers and operators in this workspace can search it.</span>
            </label>
            <label className="mt-1 flex items-start gap-2 text-sm">
              <input type="radio" name="visibility" value="restricted" className="mt-1" />
              <span>Restricted — only you, org admins and explicitly granted users.</span>
            </label>
          </fieldset>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>Create</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export default function CollectionsPage() {
  const list = useApi<Collection[]>("/collections");
  const canCreate = useCan("collection:create");
  return (
    <>
      <PageHeader
        title="Collections"
        description="Knowledge collections group documents and control who can search them."
        actions={canCreate && <CreateCollection onCreated={list.reload} />}
      />
      {list.loading && <Loading />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && (
        <Empty title="No collections yet">Create a collection, then upload documents into it.</Empty>
      )}
      {list.data && list.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr><Th>Name</Th><Th>Visibility</Th><Th>Your access</Th><Th>Documents</Th><Th>Updated</Th></tr>
          </thead>
          <tbody>
            {list.data.map((c) => (
              <tr key={c.id} className="hover:bg-panel-2">
                <Td>
                  <Link href={`/documents?collection=${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  {c.description && <div className="text-xs text-muted">{c.description}</div>}
                </Td>
                <Td><Badge tone={c.visibility === "restricted" ? "warn" : "neutral"}>{c.visibility === "restricted" ? "Restricted" : "Workspace"}</Badge></Td>
                <Td>{c.access_level ? <Badge tone="accent">{c.access_level}</Badge> : <span className="text-xs text-muted">Metadata only</span>}</Td>
                <Td className="tabular-nums">{c.document_count}</Td>
                <Td className="text-muted">{formatTime(c.updated_at)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
