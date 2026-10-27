"use client";

import { useState } from "react";
import { RequirePermission } from "@/components/Shell";
import {
  Button,
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

const ACTIONS = ["auth", "member", "collection", "document", "job", "settings", "infra", "evaluation", "retrieval"];

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
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
            {ACTIONS.map((a) => <option key={a} value={a}>{a}.*</option>)}
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
          <TableWrap>
            <thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Resource</Th><Th>Outcome</Th><Th>Details</Th><Th>Correlation</Th></tr></thead>
            <tbody>
              {events.data.items.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{formatTime(e.created_at)}</Td>
                  <Td>{e.actor_email ?? <span className="text-muted">system</span>}</Td>
                  <Td className="font-mono text-xs">{e.action}</Td>
                  <Td className="text-xs">{e.resource_type} <span className="font-mono text-muted">{shortId(e.resource_id)}</span></Td>
                  <Td><StatusBadge status={e.outcome === "success" ? "succeeded" : "failed"} label={e.outcome} /></Td>
                  <Td className="max-w-xs truncate font-mono text-xs text-muted">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : "—"}</Td>
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
    </RequirePermission>
  );
}
