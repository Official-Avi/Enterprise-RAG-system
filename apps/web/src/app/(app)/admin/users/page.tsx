"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/icons";
import { RequirePermission } from "@/components/Shell";
import {
  Badge,
  Button,
  ConfirmDialog,
  cx,
  Dialog,
  ErrorState,
  inputClass,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useApi, useCan, useMe } from "@/lib/hooks";
import type { Member } from "@/lib/types";
import { fetchDemoInfo } from "@/lib/workspace";

const ROLES: { value: Member["role"]; label: string; help: string }[] = [
  { value: "org_admin", label: "Org admin", help: "Everything, including members, settings and all collections" },
  { value: "operator", label: "Operator", help: "Queues, workers, models, infrastructure and evaluation" },
  { value: "engineer", label: "Engineer", help: "Upload documents, create collections, ask questions" },
  { value: "auditor", label: "Auditor", help: "Read-only status and audit log; never document content" },
];

/** Rows in the shape of the member table while it loads. The status text is for screen readers. */
function TableSkeleton() {
  return (
    <div role="status" className="divide-y divide-border border-y border-border">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="h-9 bg-panel-2" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-6 px-3 py-3">
          <div className="w-48 space-y-2">
            <div className="h-4 w-32 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
            <div className="h-3 w-44 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
          </div>
          <div className="h-8 w-36 motion-safe:animate-shimmer rounded-input bg-panel-3" />
          <div className="hidden h-4 w-28 motion-safe:animate-shimmer rounded-sm bg-panel-3 sm:block" />
        </div>
      ))}
    </div>
  );
}

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
          <div className="space-y-4 text-sm">
            <p className="text-text-2">Account created. Share this one-time password through a secure channel; it will not be shown again.</p>
            <code className="block rounded-md bg-graphite px-3 py-3 font-mono text-base text-graphite-ink select-all wrap-anywhere">{temp}</code>
            <div className="flex justify-end"><Button variant="primary" onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="m-email" className="mb-2 block text-sm font-medium text-text">Email</label>
              <input id="m-email" name="email" type="email" required className={cx(inputClass, "focus-visible:border-accent")} />
            </div>
            <div>
              <label htmlFor="m-name" className="mb-2 block text-sm font-medium text-text">Display name</label>
              <input id="m-name" name="name" required maxLength={200} className={cx(inputClass, "focus-visible:border-accent")} />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">Role</legend>
              {/* Ruled options: the whole row picks the role, the chosen one takes the accent fill. */}
              <div className="divide-y divide-border overflow-hidden rounded-card border border-border">
                {ROLES.map((r, i) => (
                  <label
                    key={r.value}
                    className={cx(
                      "flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 text-sm transition-colors duration-[var(--dur-micro)]",
                      "hover:bg-panel-2 active:bg-panel-3 has-checked:bg-accent-soft has-focus-visible:bg-panel-2",
                    )}
                  >
                    <input type="radio" name="role" value={r.value} defaultChecked={i === 2} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
                    <span className="min-w-0">
                      <span className="block font-medium text-text">{r.label}</span>
                      <span className="block text-text-2">{r.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-muted">Existing accounts are added to this workspace without changing their password.</p>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
                <Icon name="cross" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
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

function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

/** Choosing an option only stages the change, so arrow keys can step through the list (WCAG 3.2.2).
 *  Apply asks for confirmation; only then does the role change. */
function RoleSelect({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const [draft, setDraft] = useState<Member["role"] | null>(null);
  const [applied, setApplied] = useState<Member["role"] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  // The reload has caught up with the change just made.
  if (applied !== null && applied === member.role) setApplied(null);
  const current = applied ?? member.role;

  const apply = async () => {
    await api(`/admin/users/${member.user_id}/roles`, { method: "PATCH", json: { role: draft } });
    // Apply and Undo disappear with the draft, so focus needs somewhere to go right away.
    flushSync(() => {
      setConfirming(false);
      setApplied(draft);
      setDraft(null);
    });
    selectRef.current?.focus();
    onChanged();
  };

  return (
    <div className="flex min-w-40 flex-col gap-2">
      <select
        ref={selectRef}
        aria-label={`Role for ${member.email}`}
        className={inputClass}
        value={draft ?? current}
        onChange={(e) => {
          const next = e.target.value as Member["role"];
          setDraft(next === current ? null : next);
        }}
      >
        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {draft && (
        <div className="flex gap-2">
          <Button variant="primary" size="sm" aria-label={`Apply role change for ${member.email}`} onClick={() => setConfirming(true)}>Apply</Button>
          <Button
            size="sm"
            aria-label={`Undo role change for ${member.email}`}
            onClick={() => {
              setDraft(null);
              selectRef.current?.focus();
            }}
          >
            Undo
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Change this role?"
        confirmLabel="Change role"
        variant="primary"
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      >
        <p>Change {member.email} from {roleLabel(current)} to {roleLabel(draft ?? current)}? This applies to their active sessions immediately.</p>
      </ConfirmDialog>
    </div>
  );
}

export default function UsersPage() {
  const members = useApi<{ items: Member[] }>("/admin/users");
  const canManage = useCan("user:manage");
  const me = useMe();
  const [removing, setRemoving] = useState<Member | null>(null);
  // Shared demo accounts stay usable for every visitor. This only hides the controls; protecting
  // them for real is the API's job.
  const [personaEmails, setPersonaEmails] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchDemoInfo()
      .then((info) => {
        if (!cancelled && info.enabled) setPersonaEmails(info.personas.map((p) => p.email.toLowerCase()));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async () => {
    if (!removing) return;
    await api(`/admin/users/${removing.user_id}`, { method: "DELETE" });
    setRemoving(null);
    members.reload();
  };

  return (
    <RequirePermission permission="user:read">
      <PageHeader
        title="Users & roles"
        description="Workspace members and their roles. Collection-level access is managed from each collection."
        actions={canManage && <AddMember onAdded={members.reload} />}
      />
      {members.loading && <TableSkeleton />}
      {members.error && <ErrorState error={members.error} onRetry={members.reload} />}
      {members.data && (
        <TableWrap label="Workspace members">
          <thead><tr><Th>Member</Th><Th>Role</Th><Th>Joined</Th><Th>Last sign-in</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>
            {members.data.items.map((m) => {
              const isMe = m.user_id === me.user_id;
              const isPersona = personaEmails.includes(m.email.toLowerCase());
              return (
                <tr key={m.user_id} className="transition-colors duration-[var(--dur-micro)] hover:bg-panel-2">
                  <Td>
                    <div className="font-medium text-text">{m.display_name}{isMe && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}</div>
                    <div className="mt-0.5 font-mono text-xs whitespace-nowrap text-muted">{m.email}</div>
                  </Td>
                  <Td>
                    {canManage && !isMe && !isPersona ? (
                      <RoleSelect member={m} onChanged={members.reload} />
                    ) : (
                      <div className="whitespace-nowrap">
                        <Badge>{roleLabel(m.role)}</Badge>
                        {canManage && <div className="mt-2 text-xs text-muted">{isPersona ? "Shared demo account" : "Another admin can change this"}</div>}
                      </div>
                    )}
                  </Td>
                  <Td className="text-muted">{formatTime(m.joined_at)}</Td>
                  <Td className="text-muted">{m.last_login_at ? formatTime(m.last_login_at) : "Never"}</Td>
                  <Td className="text-right">
                    {canManage && !isMe && !isPersona && (
                      <Button variant="danger" aria-label={`Remove ${m.email}`} onClick={() => setRemoving(m)}>Remove</Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this member?"
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      >
        <p>Remove {removing?.email} from this workspace? Their sessions and collection grants are revoked.</p>
      </ConfirmDialog>
    </RequirePermission>
  );
}
