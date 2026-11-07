"use client";

// A client module only because StatusPill takes `cx` from the client-only ui module, which a
// Server Component can't call. It has no state and is still prerendered into the static page.

import type { ReactNode, SVGProps } from "react";
import { Icon, type IconName } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";
import { NotFoundCard } from "@/components/workspace/NotFoundCard";
import type { NotFoundContext } from "@/components/workspace/types";
import { CiteChip, MiniComposer } from "./HowItWorks";

function SearchX(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm5-2 5 5M8.5 8.5l5 5M13.5 8.5l-5 5" />
    </svg>
  );
}

function AnswerPicture() {
  return (
    <>
      <p className="text-sm leading-6">
        Backups are kept for 35 days. <CiteChip n={1} active />
      </p>
      <div className="mt-3 rounded-xl border border-accent bg-panel p-3">
        <div className="flex items-center gap-2 text-[13px]">
          <CiteChip n={1} active />
          <span className="min-w-0 truncate font-medium">backup-policy-2026.md</span>
          <span className="ml-auto shrink-0 text-muted max-[399px]:hidden">Section</span>
        </div>
        <p className="mt-2 text-[13px] leading-5">
          <mark className="rounded-[4px] bg-cite-hl-active px-0.5 text-text box-decoration-clone">
            Nightly database backups run at 02:00 UTC and are retained for 35 days.
          </mark>
        </p>
      </div>
    </>
  );
}

const THUMB_LINES = ["w-11/12", "w-full", "w-4/5", "w-full", "w-2/3", "w-11/12", "w-3/4"];

function ScanPicture() {
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[124px] w-[94px] shrink-0 max-[479px]:h-24 max-[479px]:w-[72px] -rotate-2 overflow-hidden rounded-sm border border-border bg-panel px-2.5 py-3 shadow-elev-1">
        <div className="mb-2.5 h-1.5 w-1/2 rounded-full bg-border-strong/60" />
        <div className="space-y-2">
          {THUMB_LINES.map((w, i) => (
            <div key={i} className={`h-1 rounded-full bg-border-strong/35 ${w}`} />
          ))}
        </div>
        <div className="absolute inset-x-0 top-[58%] h-0.5 bg-accent/70" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <Icon name="file" className="shrink-0 text-muted" />
          <span className="min-w-0 truncate font-medium">paper-scan.pdf</span>
        </div>
        <div className="mt-2">
          <StatusPill phase="processing" ctx={{ stage: "ocr" }} showSub />
        </div>
      </div>
    </div>
  );
}

function ComposerPicture() {
  return (
    <>
      <MiniComposer text="How long are backups retained?" full />
      <p className="mt-2 text-center text-xs text-muted">Enter to send · Shift+Enter for a new line</p>
    </>
  );
}

const NOT_FOUND_FIXTURE: NotFoundContext = {
  documentCount: 16,
  readingCount: 0,
  narrowed: false,
  canUpload: false,
  onSearchAll: () => {},
  onUpload: () => {},
};

function NotFoundPicture() {
  return <NotFoundCard retrievedCount={0} context={NOT_FOUND_FIXTURE} onRephrase={() => {}} />;
}

const ROLES = [
  { name: "Admin", line: "Everything" },
  { name: "Engineer", line: "Upload and ask" },
  { name: "Operator", line: "Ask, retry files" },
  { name: "Auditor", line: "Audit log only" },
];

function RolesPicture() {
  return (
    <ul className="grid grid-cols-2 gap-2 max-[479px]:grid-cols-1">
      {ROLES.map((r) => (
        <li
          key={r.name}
          className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-panel py-1.5 pl-1.5 pr-3 md:max-lg:pl-3"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent md:max-lg:hidden">
            {r.name[0]}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-4">{r.name}</span>
            <span className="block truncate text-xs leading-4 text-muted">{r.line}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const AUDIT = [
  { time: "09:12", who: "Priya Shah", what: "Signed in" },
  { time: "09:14", who: "Priya Shah", what: "Uploaded a file" },
  { time: "09:31", who: "Dana Kim", what: "Changed a setting" },
];

function AuditPicture() {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-panel text-[13px] leading-[18px]">
      {AUDIT.map((a) => (
        <li key={a.time} className="flex gap-3 px-3 py-[5px]">
          <span className="shrink-0 tabular-nums text-muted">{a.time}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{a.who}</span>
            <span className="block truncate text-muted">{a.what}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const icon = (name: IconName) => <Icon name={name} width={24} height={24} />;

const FEATURES: { icon: ReactNode; title: string; body: string; picture: ReactNode }[] = [
  {
    icon: icon("quote"),
    title: "Answers you can check",
    body: "Every answer links to the exact passage and page. Click a number to read the quote.",
    picture: <AnswerPicture />,
  },
  {
    icon: icon("scan"),
    title: "Reads scanned pages",
    body: "Scanned PDFs are read with text recognition, so scans of paper work too.",
    picture: <ScanPicture />,
  },
  {
    icon: icon("chat"),
    title: "Ask the way you talk",
    body: "No keywords or filters. Type a question like you'd ask a person.",
    picture: <ComposerPicture />,
  },
  {
    icon: <SearchX width={24} height={24} />,
    title: "Says so when it can't find it",
    body: "If your documents don't answer it, RackFlow tells you instead of guessing.",
    picture: <NotFoundPicture />,
  },
  {
    icon: icon("users"),
    title: "Four roles, one workspace",
    body: "Admins, Engineers, Operators and Auditors each see only what their job needs.",
    picture: <RolesPicture />,
  },
  {
    icon: icon("audit"),
    title: "Every action is recorded",
    body: "Sign-ins, uploads and setting changes are logged with who and when.",
    picture: <AuditPicture />,
  },
];

/** §3.5: the 2×3 feature grid. Pictures are decorative and inert, with fixture data, except the
 *  question and quote: asked of the seeded corpus, this question returns this passage. Pictures are
 *  the spec's 180px from lg up; a narrower card lets them grow rather than crop their text.
 *  The source card stays a look-alike: the real one's action row doesn't fit 180px, and when active
 *  it scrolls itself into view on mount, which would move this page on load. */
export function Features() {
  return (
    <ul className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {FEATURES.map((f) => (
        <li
          key={f.title}
          className="flex min-w-0 flex-col rounded-xl border border-border bg-panel p-6 shadow-[0_1px_4px_rgb(0_0_0/0.05)] sm:p-8"
        >
          <span className="text-accent">{f.icon}</span>
          <h3 className="mt-4 text-xl font-semibold leading-7">{f.title}</h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted">{f.body}</p>
          <div
            aria-hidden="true"
            inert
            className="mt-6 flex min-h-[180px] flex-col justify-center overflow-hidden rounded-lg bg-panel-2 p-3 text-left sm:p-4 md:p-3 lg:h-[180px]"
          >
            {f.picture}
          </div>
        </li>
      ))}
    </ul>
  );
}
