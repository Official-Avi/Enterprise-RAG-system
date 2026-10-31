"use client";

// A client module only because StatusPill takes `cx` from the client-only ui module, which a
// Server Component can't call. It has no state and is still prerendered into the static page.

import type { ReactNode, SVGProps } from "react";
import { Icon, type IconName } from "@/components/icons";
import { StatusPill } from "@/components/StatusPill";
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
        Nightly backups are kept for 35 days. <CiteChip n={1} active />
      </p>
      <div className="mt-3 rounded-xl border border-accent bg-panel p-3">
        <div className="flex items-center gap-2 text-[13px]">
          <CiteChip n={1} active />
          <span className="truncate font-medium">backup-policy.pdf</span>
          <span className="ml-auto shrink-0 text-muted">Page 2</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-[22px]">
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
    <div className="flex h-full items-center gap-4">
      <div className="relative h-[124px] w-[94px] shrink-0 -rotate-2 overflow-hidden rounded-sm border border-border bg-panel px-2.5 py-3 shadow-elev-1">
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
          <span className="truncate font-medium">inspection-notes-scan.pdf</span>
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
    <div className="flex h-full flex-col justify-center">
      <MiniComposer text="What does the backup policy say about retention?" full />
      <p className="mt-2 text-center text-xs text-muted">Enter to send · Shift+Enter for a new line</p>
    </div>
  );
}

function NotFoundPicture() {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="rounded-xl border border-border bg-panel p-4">
        <div className="flex gap-3">
          <SearchX className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Not found in your documents</p>
            <p className="mt-0.5 text-[13px] leading-5 text-muted">
              I searched 16 documents and found nothing about this.
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2 sm:pl-7">
          <span className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-xs font-medium">
            Rephrase
          </span>
          <span className="hidden h-8 items-center rounded-lg border border-border-strong px-3 text-xs font-medium sm:inline-flex">
            Upload a document
          </span>
        </div>
      </div>
    </div>
  );
}

const ROLES = [
  { name: "Admin", line: "Everything" },
  { name: "Engineer", line: "Upload and ask" },
  { name: "Operator", line: "Ask, retry files" },
  { name: "Auditor", line: "Audit log only" },
];

function RolesPicture() {
  return (
    <ul className="grid h-full grid-cols-2 content-center gap-2">
      {ROLES.map((r) => (
        <li key={r.name} className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-panel py-1.5 pl-1.5 pr-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
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
  { time: "09:14", who: "Priya Shah", what: "Uploaded backup-policy.pdf" },
  { time: "09:31", who: "Dana Kim", what: "Changed the upload limit" },
];

function AuditPicture() {
  return (
    <div className="flex h-full flex-col justify-center">
      <ul className="divide-y divide-border rounded-lg border border-border bg-panel text-[13px]">
        {AUDIT.map((a) => (
          <li key={a.time} className="flex items-center gap-3 px-3 py-2.5">
            <span className="shrink-0 tabular-nums text-muted">{a.time}</span>
            <span className="shrink-0 font-medium">{a.who}</span>
            <span className="min-w-0 truncate text-muted">{a.what}</span>
          </li>
        ))}
      </ul>
    </div>
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

/** §3.5: the 2×3 feature grid. Pictures are decorative static markup with fixture data. */
export function Features() {
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {FEATURES.map((f) => (
        <li
          key={f.title}
          className="flex flex-col rounded-xl border border-border bg-panel p-6 shadow-[0_1px_4px_rgb(0_0_0/0.05)] sm:p-8"
        >
          <span className="text-accent">{f.icon}</span>
          <h3 className="mt-4 text-xl font-semibold leading-7">{f.title}</h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted">{f.body}</p>
          <div aria-hidden="true" className="mt-6 h-[180px] overflow-hidden rounded-lg bg-panel-2 p-3 text-left sm:p-4">
            {f.picture}
          </div>
        </li>
      ))}
    </ul>
  );
}
