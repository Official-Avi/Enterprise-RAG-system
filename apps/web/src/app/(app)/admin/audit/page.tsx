"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
  cx,
  Dialog,
  Empty,
  ErrorState,
  inputClass,
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
      <dl className="divide-y divide-border border-y border-border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-xs wrap-anywhere text-text sm:leading-5">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-6 mb-2 text-sm font-medium">Details</h3>
      <pre className="cut-sm max-h-72 overflow-auto bg-graphite p-4 font-mono text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-graphite-ink">
        {event && Object.keys(event.metadata).length ? JSON.stringify(event.metadata, null, 2) : "None recorded."}
      </pre>
    </Dialog>
  );
}

/** Rows in the shape of the audit table while it loads. The status text is for screen readers. */
function TableSkeleton() {
  return (
    <div role="status" className="divide-y divide-border border-y border-border">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="h-9 bg-panel-2" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-6 px-3 py-3">
          <div className="h-4 w-36 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
          <div className="h-4 w-44 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
          <div className="hidden h-4 w-32 motion-safe:animate-shimmer rounded-sm bg-panel-3 sm:block" />
          <div className="hidden h-6 w-16 motion-safe:animate-shimmer rounded-chip bg-panel-3 md:block" />
        </div>
      ))}
    </div>
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
      <div className="mb-4 flex flex-wrap items-end gap-4 border-b border-border pb-4">
        <div className="w-full sm:w-64">
          <label htmlFor="a-action" className="mb-2 block text-sm font-medium text-text">Action</label>
          <select id="a-action" className={cx(inputClass, "focus-visible:border-accent")} value={action} onChange={(e) => { setCursor(null); setAction(e.target.value); }}>
            <option value="">All</option>
            {ACTION_FAMILIES.map(({ family, actions }) => (
              <optgroup key={family} label={family}>
                <option value={family}>{family}.* (all)</option>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="a-outcome" className="mb-2 block text-sm font-medium text-text">Outcome</label>
          <select id="a-outcome" className={cx(inputClass, "focus-visible:border-accent")} value={outcome} onChange={(e) => { setCursor(null); setOutcome(e.target.value); }}>
            <option value="">All</option>
            <option value="success">success</option>
            <option value="denied">denied</option>
            <option value="failure">failure</option>
          </select>
        </div>
      </div>
      {events.loading && <TableSkeleton />}
      {events.error && <ErrorState error={events.error} onRetry={events.reload} />}
      {events.data?.items.length === 0 && <Empty title="No audit events match" />}
      {events.data && events.data.items.length > 0 && (
        <>
          <TableWrap label="Audit events">
            <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Resource</Th><Th>Outcome</Th><Th>Details</Th><Th>Correlation</Th></tr></thead>
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id} className="transition-colors duration-[var(--dur-micro)] hover:bg-panel-2">
                  <Td className="whitespace-nowrap text-muted tabular-nums">{formatTime(e.created_at)}</Td>
                  <Td>{e.actor_email ? <span className="font-mono text-xs whitespace-nowrap">{e.actor_email}</span> : <span className="text-muted">{actorLabel(e)}</span>}</Td>
                  <Td className="font-mono text-xs whitespace-nowrap">{e.action}</Td>
                  <Td className="text-xs">{e.resource_type} {e.resource_id ? <span className="font-mono text-muted">{shortId(e.resource_id)}</span> : null}</Td>
                  <Td><StatusBadge status={e.outcome === "success" ? "succeeded" : "failed"} label={e.outcome} /></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {/* The preview only shows when there is room; View always has the full text. */}
                      <span className="hidden max-w-40 truncate font-mono text-xs text-muted min-[1400px]:inline">
                        {Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : "None"}
                      </span>
                      <Button size="sm" className="shrink-0" aria-label={`View details: ${e.action}, ${formatTime(e.created_at)}`} onClick={() => setOpen(e)}>View</Button>
                    </div>
                  </Td>
                  <Td className="text-xs text-muted">{e.correlation_id ? <span className="font-mono">{shortId(e.correlation_id)}</span> : "None"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-4 flex justify-end gap-2">
            {cursor && <Button onClick={() => setCursor(null)}>Newest</Button>}
            {events.data.next_cursor && <Button onClick={() => setCursor(events.data!.next_cursor)}>Older</Button>}
          </div>
        </>
      )}
      <EventDetails event={open} onClose={() => setOpen(null)} />
    </RequirePermission>
  );
}
