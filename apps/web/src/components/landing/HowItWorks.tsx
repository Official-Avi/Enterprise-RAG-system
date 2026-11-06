"use client";

// A client module only because StatusPill takes `cx` from the client-only ui module, which a
// Server Component can't call. It has no state and is still prerendered into the static page.

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";
import { CitationChip } from "@/components/workspace/CitationChip";
import type { Citation } from "@/lib/types";

const FIXTURE_CITATION: Citation = {
  marker: 1,
  document_id: "fixture",
  filename: "backup-policy-2026.md",
  page: null,
  chunk_id: null,
  quote: "",
  score: null,
};

/** The real citation chip with fixture data (§3.4). The picture around it is inert, so it can't be pressed. */
export function CiteChip({ n, active = false }: { n: number; active?: boolean }) {
  return <CitationChip citation={FIXTURE_CITATION} number={n} active={active} onActivate={() => {}} />;
}

/** Look-alike of the /ask composer (§5.3): the real one needs a signed-in workspace. `full` adds
 *  the scope chip, and the Add files label where the card has room for both. */
export function MiniComposer({ text, full = false }: { text: string; full?: boolean }) {
  return (
    <div className="rounded-3xl border border-border-strong bg-panel px-3 pb-2 pt-3 text-left shadow-elev-1">
      <p className={full ? "line-clamp-2 px-1 text-[15px] leading-6" : "truncate px-1 text-[13px] leading-6 md:max-lg:text-xs"}>
        {text}
        <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-accent" />
      </p>
      <div className="mt-2 flex items-center gap-2">
        {full ? (
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-xs font-medium lg:px-3">
            <Icon name="paperclip" width={14} height={14} />
            <span className="hidden lg:inline">Add files</span>
          </span>
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full text-muted">
            <Icon name="paperclip" width={15} height={15} />
          </span>
        )}
        {full && (
          <span className="min-w-0 truncate rounded-full border border-border-strong px-2 py-1 text-xs text-muted">
            <span className="max-[359px]:hidden">All </span>16 documents
          </span>
        )}
        <span className="ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast">
          <Icon name="send" width={15} height={15} />
        </span>
      </div>
    </div>
  );
}

function StatusSteps() {
  return (
    <>
      <div className="flex items-center gap-2 text-[13px]">
        <Icon name="file" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate font-medium">handbook.pdf</span>
        <span className="ml-auto shrink-0 tabular-nums text-muted">1.2 MB</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <StatusPill phase="queued" />
        <span className="text-xs text-muted">→</span>
        <StatusPill phase="processing" />
        <span className="text-xs text-muted">→</span>
        <StatusPill phase="indexed" />
      </div>
    </>
  );
}

function SourceLine() {
  return (
    <>
      <p className="text-sm leading-6">
        Backups are kept for 35 days <CiteChip n={1} />
      </p>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-panel px-2.5 py-2 text-[13px]">
        <CiteChip n={1} active />
        <span className="min-w-0 truncate font-medium">handbook.pdf · p. 12</span>
      </div>
    </>
  );
}

const STEPS: { title: string; body: string; picture: ReactNode }[] = [
  {
    title: "Add a file",
    body: "Drag it in or choose it. Most files are ready in under a minute.",
    picture: <StatusSteps />,
  },
  {
    title: "Ask a question",
    body: "Type it the way you'd ask a colleague.",
    picture: <MiniComposer text="How long are backups retained?" />,
  },
  {
    title: "Check the source",
    body: "Every answer shows the passage and page it came from.",
    picture: <SourceLine />,
  },
];

/** §3.4: three steps, each with a 120px static picture built from the workspace vocabulary. */
export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex min-w-0 flex-col">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold tabular-nums text-accent-contrast"
          >
            {i + 1}
          </span>
          <h3 className="mt-4 text-xl font-semibold leading-7">{s.title}</h3>
          <p className="mt-1.5 flex-1 text-[15px] leading-6 text-muted">{s.body}</p>
          <div
            aria-hidden="true"
            inert
            className="mt-5 flex h-[120px] flex-col justify-center overflow-hidden rounded-lg border border-border bg-panel-2 p-3"
          >
            {s.picture}
          </div>
        </li>
      ))}
    </ol>
  );
}
