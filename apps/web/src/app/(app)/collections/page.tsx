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
import type { Collection, Grant, Member } from "@/lib/types";

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

function ManageAccess({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const grants = useApi<Grant[]>(`/collections/${collection.id}/permissions`);
  const canListMembers = useCan("user:read");
  const members = useApi<{ items: Member[] }>(canListMembers ? "/admin/users" : null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<Grant["permission"]>("read");

  const setGrant = async (uid: string, permission: string) => {
    setError(null);
    try {
      await api(`/collections/${collection.id}/permissions/${uid}`, { method: "PUT", json: { permission } });
      grants.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const revoke = async (g: Grant) => {
    if (!window.confirm(`Revoke ${g.email}'s access to "${collection.name}"? Their existing chat citations from it will be hidden.`)) return;
    setError(null);
    try {
      await api(`/collections/${collection.id}/permissions/${g.user_id}`, { method: "DELETE" });
      grants.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const granted = new Set(grants.data?.map((g) => g.user_id));
  const candidates = members.data?.items.filter((m) => !granted.has(m.user_id) && m.role !== "org_admin" && m.role !== "auditor") ?? [];

  return (
    <Dialog open wide title={`Access to ${collection.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        {collection.visibility === "restricted"
          ? "Restricted: only org admins, the creator and the people below can search this collection."
          : "Workspace collection: all engineers and operators can read it. Grants below add write or manage rights."}
        {" "}Auditors never receive document content.
      </p>
      {grants.loading && <Loading />}
      {grants.error && <ErrorState error={grants.error} />}
      {grants.data && grants.data.length === 0 && <p className="text-sm text-muted">No explicit grants.</p>}
      <ul className="divide-y divide-border">
        {grants.data?.map((g) => (
          <li key={g.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span><span className="font-medium">{g.display_name}</span> <span className="text-xs text-muted">{g.email}</span></span>
            <span className="flex items-center gap-2">
              <select aria-label={`Access level for ${g.email}`} className={`${inputClass} w-28`} value={g.permission} onChange={(e) => setGrant(g.user_id, e.target.value)}>
                <option value="read">read</option><option value="write">write</option><option value="manage">manage</option>
              </select>
              <Button variant="danger" onClick={() => revoke(g)}>Revoke</Button>
            </span>
          </li>
        ))}
      </ul>
      {canListMembers ? (
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); if (userId) void setGrant(userId, level); setUserId(""); }}>
          <div className="min-w-56 flex-1">
            <label htmlFor="g-user" className="mb-1 block text-xs font-medium text-muted">Member</label>
            <select id="g-user" className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose a member…</option>
              {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} ({m.email})</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="g-level" className="mb-1 block text-xs font-medium text-muted">Access</label>
            <select id="g-level" className={inputClass} value={level} onChange={(e) => setLevel(e.target.value as Grant["permission"])}>
              <option value="read">read</option><option value="write">write</option><option value="manage">manage</option>
            </select>
          </div>
          <Button type="submit" variant="primary" disabled={!userId}>Grant</Button>
        </form>
      ) : (
        <p className="mt-4 text-xs text-muted">Ask an org admin to grant access to additional members.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
    </Dialog>
  );
}

export default function CollectionsPage() {
  const list = useApi<Collection[]>("/collections");
  const canCreate = useCan("collection:create");
  const [managing, setManaging] = useState<Collection | null>(null);
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
            <tr><Th>Name</Th><Th>Visibility</Th><Th>Your access</Th><Th>Documents</Th><Th>Updated</Th><Th><span className="sr-only">Actions</span></Th></tr>
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
                <Td className="text-right">{c.access_level === "manage" && <Button onClick={() => setManaging(c)}>Manage access</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {managing && <ManageAccess collection={managing} onClose={() => { setManaging(null); list.reload(); }} />}
    </>
  );
}
