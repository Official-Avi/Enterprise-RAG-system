"use client";

import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Badge,
  Button,
  Dialog,
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
import { useApi, useCan, useMe } from "@/lib/hooks";
import type { Member } from "@/lib/types";

const ROLES: { value: Member["role"]; label: string; help: string }[] = [
  { value: "org_admin", label: "Org admin", help: "Everything, including members, settings and all collections" },
  { value: "operator", label: "Operator", help: "Queues, workers, models, infrastructure and evaluation" },
  { value: "engineer", label: "Engineer", help: "Upload documents, create collections, ask questions" },
  { value: "auditor", label: "Auditor", help: "Read-only status and audit log; never document content" },
];

function AddMember({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setError(null);
    try {
      const res = await api<{ temporary_password: string | null }>("/admin/users", {
        method: "POST",
        json: { email: String(f.get("email")), display_name: String(f.get("name")), role: String(f.get("role")) },
      });
      onAdded();
      if (res.temporary_password) setTemp(res.temporary_password);
      else setOpen(false);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Button variant="primary" onClick={() => { setTemp(null); setError(null); setOpen(true); }}>Add member</Button>
      <Dialog open={open} title="Add workspace member" onClose={() => setOpen(false)}>
        {temp ? (
          <div className="space-y-3 text-sm">
            <p>Account created. Share this one-time password through a secure channel; it will not be shown again.</p>
            <code className="block rounded-md bg-panel-2 px-3 py-2 font-mono">{temp}</code>
            <div className="flex justify-end"><Button variant="primary" onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="m-email" className="mb-1 block text-sm font-medium">Email</label>
              <input id="m-email" name="email" type="email" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="m-name" className="mb-1 block text-sm font-medium">Display name</label>
              <input id="m-name" name="name" required maxLength={200} className={inputClass} />
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Role</legend>
              {ROLES.map((r, i) => (
                <label key={r.value} className="mb-1 flex items-start gap-2 text-sm">
                  <input type="radio" name="role" value={r.value} defaultChecked={i === 2} className="mt-1" />
                  <span><span className="font-medium">{r.label}</span> <span className="text-muted">— {r.help}</span></span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted">Existing accounts are added to this workspace without changing their password.</p>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Add</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export default function UsersPage() {
  const members = useApi<{ items: Member[] }>("/admin/users");
  const canManage = useCan("user:manage");
  const me = useMe();
  const [error, setError] = useState<string | null>(null);

  const changeRole = async (m: Member, role: string) => {
    if (!window.confirm(`Change ${m.email} from ${m.role} to ${role}? This applies to their active sessions immediately.`)) return;
    setError(null);
    try {
      await api(`/admin/users/${m.user_id}/roles`, { method: "PATCH", json: { role } });
    } catch (e) {
      setError(errorText(e));
    }
    members.reload();
  };
  const remove = async (m: Member) => {
    if (!window.confirm(`Remove ${m.email} from this workspace? Their sessions and collection grants are revoked.`)) return;
    setError(null);
    try {
      await api(`/admin/users/${m.user_id}`, { method: "DELETE" });
    } catch (e) {
      setError(errorText(e));
    }
    members.reload();
  };

  return (
    <RequirePermission permission="user:read">
      <PageHeader
        title="Users & roles"
        description="Workspace members and their roles. Collection-level access is managed from each collection."
        actions={canManage && <AddMember onAdded={members.reload} />}
      />
      {error && <p role="alert" className="mb-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {members.loading && <Loading />}
      {members.error && <ErrorState error={members.error} onRetry={members.reload} />}
      {members.data && (
        <TableWrap>
          <thead><tr><Th>Member</Th><Th>Role</Th><Th>Joined</Th><Th>Last sign-in</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {members.data.items.map((m) => (
              <tr key={m.user_id}>
                <Td>
                  <div className="font-medium">{m.display_name}{m.user_id === me.user_id && <span className="ml-2 text-xs text-muted">(you)</span>}</div>
                  <div className="text-xs text-muted">{m.email}</div>
                </Td>
                <Td>
                  {canManage ? (
                    <select aria-label={`Role for ${m.email}`} className={`${inputClass} w-36`} value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  ) : (
                    <Badge>{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</Badge>
                  )}
                </Td>
                <Td className="text-muted">{formatTime(m.joined_at)}</Td>
                <Td className="text-muted">{formatTime(m.last_login_at)}</Td>
                <Td className="text-right">{canManage && m.user_id !== me.user_id && <Button variant="danger" onClick={() => remove(m)}>Remove</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </RequirePermission>
  );
}
