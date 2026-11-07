"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
  Dialog,
  Empty,
  ErrorState,
  inputClass,
  Loading,
  PageHeader,
  StatusBadge,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { formatTime, shortId } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AuditEvent, Page } from "@/lib/types";

// Every action the API records, by family. The API filters by prefix, so "chat" matches all of
// chat.*. Add new record_audit actions here as well.
const ACTION_FAMILIES: { family: string; actions: string[] }[] = [
  { family: "auth", actions: ["auth.login", "auth.demo_login", "auth.logout", "auth.access_denied"] },
  { family: "chat", actions: ["chat.session.rename", "chat.session.update", "chat.session.delete"] },
  { family: "collection", actions: ["collection.create", "collection.update", "collection.delete", "collection.grant", "collection.revoke"] },
  { family: "document", actions: ["document.upload", "document.download", "document.reindex", "document.retry", "document.delete"] },
  { family: "evaluation", actions: ["evaluation.run", "evaluation.seed"] },
  {
    family: "infra",
    actions: [
      "infra.rack.create", "infra.rack.update", "infra.rack.delete",
      "infra.node.create", "infra.node.update", "infra.node.delete",
      "infra.workload.create", "infra.workload.update", "infra.workload.delete",
    ],
  },
  { family: "job", actions: ["job.cancel", "job.retry"] },
  { family: "member", actions: ["member.add", "member.role_change", "member.remove"] },
  { family: "retrieval", actions: ["retrieval.inspect"] },
  { family: "settings", actions: ["settings.update"] },
];

/** A rejected sign-in has no actor because nobody was authenticated, which is not the same as
 *  RackFlow itself doing something. */
const actorLabel = (e: AuditEvent) => e.actor_email ?? (e.action.startsWith("auth.") ? "Not signed in" : "system");

function EventDetails({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const rows: [string, string][] = event
    ? [
        ["Time", formatTime(event.created_at)],
        ["Actor", actorLabel(event)],
        ["Action", event.action],
        ["Resource", event.resource_type],
        ["Resource ID", event.resource_id ?? "None"],
        ["Outcome", event.outcome],
        ["Correlation ID", event.correlation_id ?? "None"],
      ]
    : [];
  return (
    <Dialog open={event !== null} title="Audit event" onClose={onClose} wide>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="mb-1 font-mono text-xs wrap-anywhere sm:mb-0 sm:leading-5">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-3 mb-1 text-sm font-medium">Details</h3>
      <pre className="max-h-72 overflow-auto rounded-lg bg-panel-2 p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
        {event && Object.keys(event.metadata).length ? JSON.stringify(event.metadata, null, 2) : "None recorded."}
      </pre>
    </Dialog>
  );
}

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const qs = new URLSearchParams({ limit: "50" });
  if (action) qs.set("action", action);
  if (outcome) qs.set("outcome", outcome);
  if (cursor) qs.set("cursor", cursor);
  const events = useApi<Page<AuditEvent>>(`/admin/audit-events?${qs}`);

  return (
    <RequirePermission permission="audit:read">
      <PageHeader title="Audit log" description="Security-relevant actions in this workspace. Metadata never contains passwords, secrets or document text." />
      <div className="mb-3 flex flex-wrap gap-3">
        <div>
          <label htmlFor="a-action" className="mb-1 block text-xs font-medium text-muted">Action</label>
          <select id="a-action" className={inputClass} value={action} onChange={(e) => { setCursor(null); setAction(e.target.value); }}>
            <option value="">All</option>
            {ACTION_FAMILIES.map(({ family, actions }) => (
              <optgroup key={family} label={family}>
                <option value={family}>{family}.* (all)</option>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="a-outcome" className="mb-1 block text-xs font-medium text-muted">Outcome</label>
          <select id="a-outcome" className={inputClass} value={outcome} onChange={(e) => { setCursor(null); setOutcome(e.target.value); }}>
            <option value="">All</option>
            <option value="success">success</option>
            <option value="denied">denied</option>
            <option value="failure">failure</option>
          </select>
        </div>
      </div>
      {events.loading && <Loading />}
      {events.error && <ErrorState error={events.error} onRetry={events.reload} />}
      {events.data?.items.length === 0 && <Empty title="No audit events match" />}
      {events.data && events.data.items.length > 0 && (
        <>
          <TableWrap label="Audit events">
            <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Resource</Th><Th>Outcome</Th><Th>Details</Th><Th>Correlation</Th></tr></thead>
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{formatTime(e.created_at)}</Td>
                  <Td>{e.actor_email ?? <span className="text-muted">{actorLabel(e)}</span>}</Td>
                  <Td className="font-mono text-xs whitespace-nowrap">{e.action}</Td>
                  <Td className="text-xs">{e.resource_type} <span className="font-mono text-muted">{shortId(e.resource_id)}</span></Td>
                  <Td><StatusBadge status={e.outcome === "success" ? "succeeded" : "failed"} label={e.outcome} /></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {/* The preview only shows when there is room; View always has the full text. */}
                      <span className="hidden max-w-40 truncate font-mono text-xs text-muted min-[1400px]:inline">
                        {Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : "—"}
                      </span>
                      <Button className="shrink-0 px-2 py-0.5 text-xs max-sm:min-h-11" aria-label={`View details: ${e.action}, ${formatTime(e.created_at)}`} onClick={() => setOpen(e)}>View</Button>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-muted">{shortId(e.correlation_id)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-3 flex justify-end gap-2">
            {cursor && <Button onClick={() => setCursor(null)}>Newest</Button>}
            {events.data.next_cursor && <Button onClick={() => setCursor(events.data!.next_cursor)}>Older</Button>}
          </div>
        </>
      )}
      <EventDetails event={open} onClose={() => setOpen(null)} />
    </RequirePermission>
  );
}
