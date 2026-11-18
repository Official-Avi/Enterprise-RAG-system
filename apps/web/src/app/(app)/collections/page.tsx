"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icons";
import {
  Badge,
  Button,
  cx,
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
import { announce } from "@/lib/announce";
import { api, errorText } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useApi, useCan } from "@/lib/hooks";
import type { Collection, Grant, Member } from "@/lib/types";
import { MY_DOCUMENTS } from "@/lib/workspace";

/** The workspace finds "My documents", and evaluation seeding finds its corpus, by exact name.
 *  Renaming one would quietly make the next upload or seed create a new, empty collection. */
const nameIsFixed = (c: Collection) => c.name === MY_DOCUMENTS || /^Evaluation (corpus|restricted) \(v\d+\)$/.test(c.name);

/** Field label: sentence case in the body face, above its control. */
const FIELD_LABEL = "mb-1 block text-sm font-medium text-text";
/** A radio choice: the whole row is the target, 44px on touch. */
const CHOICE =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors " +
  "duration-[var(--dur-micro)] hover:bg-panel-2 has-checked:bg-accent-soft sm:min-h-0";
const RADIO = "mt-0.5 size-4 shrink-0 accent-accent";
/** Access levels in sentence case; an unknown level shows as the API sends it. */
const ACCESS_LABEL: Record<string, string> = { read: "Read", write: "Write", manage: "Manage" };
/** Table name link: on touch, padding gives it a 44px target without changing the row height. */
const NAME_LINK = cx(
  "font-medium text-text break-words hover:text-accent hover:underline focus-visible:underline active:text-accent-hover",
  "pointer-coarse:-my-3 pointer-coarse:inline-block pointer-coarse:py-3",
);

function CreateCollection({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy) return;
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
      <Button
        variant="primary"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        New collection
      </Button>
      <Dialog open={open} title="New collection" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="c-name" className={FIELD_LABEL}>Name</label>
            <input id="c-name" name="name" required maxLength={200} className={inputClass} />
          </div>
          <div>
            <label htmlFor="c-desc" className={FIELD_LABEL}>Description</label>
            <textarea id="c-desc" name="description" rows={2} maxLength={2000} className={inputClass} />
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-text">Visibility</legend>
            <label className={CHOICE}>
              <input type="radio" name="visibility" value="tenant" defaultChecked className={RADIO} />
              <span>
                <span className="font-medium text-text">Workspace:</span>{" "}
                <span className="text-text-2">all engineers and operators in this workspace can search it.</span>
              </span>
            </label>
            <label className={`mt-1 ${CHOICE}`}>
              <input type="radio" name="visibility" value="restricted" className={RADIO} />
              <span>
                <span className="font-medium text-text">Restricted:</span>{" "}
                <span className="text-text-2">only you, org admins and explicitly granted users.</span>
              </span>
            </label>
          </fieldset>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" aria-busy={busy || undefined} aria-disabled={busy || undefined}>Create</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function EditCollection({ collection, onClose, onSaved }: { collection: Collection; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fixed = nameIsFixed(collection);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy) return;
    const f = new FormData(ev.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const description = String(f.get("description") ?? "");
    const changes: { name?: string; description?: string } = {};
    if (!fixed && name !== collection.name) changes.name = name;
    if (description !== collection.description) changes.description = description;
    if (!fixed && !name) {
      setError("Enter a name.");
      return;
    }
    if (!Object.keys(changes).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/collections/${collection.id}`, { method: "PATCH", json: changes });
      announce(`Saved ${name || collection.name}.`);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="Edit collection" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="e-name" className={FIELD_LABEL}>Name</label>
          <input
            id="e-name"
            name="name"
            required
            maxLength={200}
            defaultValue={collection.name}
            readOnly={fixed}
            aria-describedby={fixed ? "e-name-note" : undefined}
            className={`${inputClass} read-only:bg-panel-2 read-only:text-text-2`}
          />
          {fixed && <p id="e-name-note" className="mt-1 flex items-start gap-1.5 text-xs text-muted"><Icon name="lock" width={14} height={14} aria-hidden="true" className="mt-px shrink-0" />RackFlow finds this collection by its name, so the name can&apos;t be changed.</p>}
        </div>
        <div>
          <label htmlFor="e-desc" className={FIELD_LABEL}>Description</label>
          <textarea id="e-desc" name="description" rows={2} maxLength={2000} defaultValue={collection.description} className={inputClass} />
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" aria-busy={busy || undefined} aria-disabled={busy || undefined}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteCollection({ collection, onClose, onDeleted }: { collection: Collection; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = collection.document_count;
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/collections/${collection.id}`, { method: "DELETE" });
      announce(`Deleted ${collection.name}.`);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={count ? "This collection isn't empty" : "Delete this collection?"} onClose={onClose}>
      {count ? (
        <p className="text-sm [overflow-wrap:anywhere]">
          <span className="font-medium">{collection.name}</span> still holds {count} document{count === 1 ? "" : "s"}. Delete {count === 1 ? "it" : "them"} first, then come back to delete the collection.
        </p>
      ) : (
        <p className="text-sm [overflow-wrap:anywhere]">
          <span className="font-medium">{collection.name}</span> will be deleted, along with its access grants. This can&apos;t be undone.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button data-autofocus onClick={onClose}>Cancel</Button>
        {count ? (
          <Link href={`/documents?collection=${collection.id}`} className="key key-primary max-sm:min-h-11 sm:min-h-9 sm:px-3">
            Open its documents
          </Link>
        ) : (
          <Button variant="danger" aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function ManageAccess({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const grants = useApi<Grant[]>(`/collections/${collection.id}/permissions`);
  const canListMembers = useCan("user:read");
  const members = useApi<{ items: Member[] }>(canListMembers ? "/admin/users" : null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<Grant["permission"]>("read");
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const setGrant = async (uid: string, permission: string) => {
    setError(null);
    try {
      await api(`/collections/${collection.id}/permissions/${uid}`, { method: "PUT", json: { permission } });
      grants.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const revoke = async () => {
    if (!revoking || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await api(`/collections/${collection.id}/permissions/${revoking.user_id}`, { method: "DELETE" });
      setRevoking(null);
      grants.reload();
    } catch (e) {
      setRevokeError(errorText(e));
    } finally {
      setRevokeBusy(false);
    }
  };
  const granted = new Set(grants.data?.map((g) => g.user_id));
  const candidates = members.data?.items.filter((m) => !granted.has(m.user_id) && m.role !== "org_admin" && m.role !== "auditor") ?? [];

  return (
    <>
      <Dialog open wide title={`Access to ${collection.name}`} onClose={onClose}>
        <p className="mb-4 max-w-[72ch] text-sm text-text-2">
          {collection.visibility === "restricted"
            ? "Restricted: only org admins, the creator and the people below can search this collection."
            : "Workspace collection: all engineers and operators can read it. Grants below add write or manage rights."}
          {" "}Auditors never receive document content.
        </p>
        {grants.loading && <Loading />}
        {grants.error && <ErrorState error={grants.error} onRetry={grants.reload} />}
        {grants.data && grants.data.length === 0 && <p className="text-sm text-muted">No explicit grants.</p>}
        <ul className="divide-y divide-border border-y border-border empty:hidden">
          {grants.data?.map((g) => (
            <li key={g.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]"><span className="font-medium">{g.display_name}</span> <span className="font-mono text-xs text-muted">{g.email}</span></span>
              <span className="flex items-center gap-2">
                <select aria-label={`Access level for ${g.email}`} className={`${inputClass} w-28!`} value={g.permission} onChange={(e) => setGrant(g.user_id, e.target.value)}>
                  <option value="read">read</option><option value="write">write</option><option value="manage">manage</option>
                </select>
                <Button
                  variant="danger"
                  aria-label={`Revoke access for ${g.email}`}
                  onClick={() => {
                    setRevokeError(null);
                    setRevoking(g);
                  }}
                >
                  Revoke
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {canListMembers ? (
          <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); if (userId) void setGrant(userId, level); setUserId(""); }}>
            <div className="min-w-56 flex-1">
              <label htmlFor="g-user" className={FIELD_LABEL}>Member</label>
              <select id="g-user" className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose a member…</option>
                {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} ({m.email})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="g-level" className={FIELD_LABEL}>Access</label>
              <select id="g-level" className={inputClass} value={level} onChange={(e) => setLevel(e.target.value as Grant["permission"])}>
                <option value="read">read</option><option value="write">write</option><option value="manage">manage</option>
              </select>
            </div>
            {/* The handler ignores a submit with no member chosen. */}
            <Button type="submit" variant="primary" aria-disabled={!userId || undefined}>Grant</Button>
          </form>
        ) : (
          <p className="mt-4 text-xs text-muted">Ask an org admin to grant access to additional members.</p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      </Dialog>
      {/* A sibling, not a child: Esc closes this one and leaves the access dialog open. */}
      <Dialog open={revoking !== null} title="Revoke access?" onClose={() => setRevoking(null)}>
        <p className="text-sm [overflow-wrap:anywhere]">
          {revoking?.email} loses access to &quot;{collection.name}&quot;. Their existing chat citations from it will be hidden.
        </p>
        {revokeError && <p role="alert" className="mt-3 text-sm text-bad">{revokeError}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button data-autofocus onClick={() => setRevoking(null)}>Cancel</Button>
          <Button variant="danger" aria-busy={revokeBusy || undefined} aria-disabled={revokeBusy || undefined} onClick={() => void revoke()}>
            {revokeBusy ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export default function CollectionsPage() {
  const list = useApi<Collection[]>("/collections");
  const canCreate = useCan("collection:create");
  const canManage = useCan("collection:manage");
  const [managing, setManaging] = useState<Collection | null>(null);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [deleting, setDeleting] = useState<Collection | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <PageHeader
        title="Collections"
        description="Knowledge collections group documents and control who can search them."
        actions={canCreate && <CreateCollection onCreated={list.reload} />}
      />
      {/* Holds focus after a delete, when the row's own button is gone. */}
      <div ref={listRef} tabIndex={-1} className="outline-none">
        {list.loading && <Loading />}
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.data && list.data.length === 0 && (
          <Empty title="No collections yet">{canCreate ? "Create a collection, then upload documents into it." : "An Engineer or Admin can create one."}</Empty>
        )}
        {list.data && list.data.length > 0 && (
          <TableWrap>
            <thead>
              <tr><Th>Name</Th><Th>Visibility</Th><Th>Your access</Th><Th className="text-right">Documents</Th><Th>Updated</Th><Th className="relative"><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {list.data.map((c) => {
                const manageable = c.access_level === "manage";
                return (
                  <tr key={c.id} className="transition-colors duration-[var(--dur-micro)] hover:bg-panel-2">
                    <Td>
                      <Link
                        href={`/documents?collection=${c.id}`}
                        className={NAME_LINK}
                      >
                        {c.name}
                      </Link>
                      {c.description && <div className="mt-0.5 max-w-[60ch] text-sm text-muted">{c.description}</div>}
                    </Td>
                    <Td>
                      <Badge tone={c.visibility === "restricted" ? "warn" : "neutral"}>
                        <span className="inline-flex items-center gap-1">
                          {c.visibility === "restricted" && <Icon name="lock" width={12} height={12} aria-hidden="true" />}
                          {c.visibility === "restricted" ? "Restricted" : "Workspace"}
                        </span>
                      </Badge>
                    </Td>
                    <Td>{c.access_level ? <Badge>{ACCESS_LABEL[c.access_level] ?? c.access_level}</Badge> : <span className="text-sm text-muted">Metadata only</span>}</Td>
                    <Td className="text-right tabular-nums">{c.document_count}</Td>
                    <Td className="whitespace-nowrap text-muted tabular-nums">{formatTime(c.updated_at)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <span className="inline-flex gap-2">
                        {manageable && canManage && <Button aria-label={`Manage access to ${c.name}`} onClick={() => setManaging(c)}>Manage access</Button>}
                        {manageable && canManage && <Button aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>Edit</Button>}
                        {manageable && canManage && <Button variant="danger" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>Delete</Button>}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </div>
      {managing && <ManageAccess collection={managing} onClose={() => { setManaging(null); list.reload(); }} />}
      {editing && <EditCollection collection={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {deleting && (
        <DeleteCollection
          collection={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            // Closed before focus moves: everything behind a modal dialog is inert.
            flushSync(() => setDeleting(null));
            listRef.current?.focus();
            list.reload();
          }}
        />
      )}
    </>
  );
}
