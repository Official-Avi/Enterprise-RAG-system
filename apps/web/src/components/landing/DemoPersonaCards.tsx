"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { Icon } from "@/components/icons";
import { homePath } from "@/components/Shell";
import { cx } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { announce } from "@/lib/announce";
import type { DemoPersona } from "@/lib/types";
import { isUnreachable, useVisitor } from "./Visitor";

type Variant = "landing" | "compact";

/** idle: clickable · busy: signing in · spinning: busy for over 300ms · locked: another card is busy, or throttled */
type CardState = "idle" | "busy" | "spinning" | "locked";

type Notice = { kind: "throttled" } | { kind: "unreachable"; retry: () => void } | { kind: "error"; message: string };

// Final card copy from spec §4.1. Delete once auth/demo.py serves the same strings (BE MUST).
const SPEC_COPY: Partial<Record<string, Pick<DemoPersona, "summary" | "can" | "cannot">>> = {
  engineer: {
    summary: "Upload files and ask questions about them.",
    can: ["Upload files", "Ask questions with cited answers", "Make collections"],
    cannot: ["Open the admin console"],
  },
  operator: {
    summary: "Keeps file processing running smoothly.",
    can: ["Ask questions", "Watch the processing queue", "Retry failed files"],
    cannot: ["Upload files"],
  },
  admin: {
    summary: "Does everything, including people and settings.",
    can: ["Upload and ask", "Manage users and roles", "Change settings"],
    cannot: [],
  },
  auditor: {
    summary: "Checks who did what, without seeing content.",
    can: ["Read the audit log", "See file names and statuses"],
    cannot: ["Open documents or ask questions"],
  },
};

const THROTTLED = "Too many demo sign-ins from this network. Try again in a minute.";
const UNREACHABLE = "Can't reach RackFlow. Check that the server is running.";
const COOLDOWN_MS = 60_000;
const SPINNER_DELAY_MS = 300;

const GRID = "mx-auto grid max-w-[1040px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";
const MINUS = "M6 12h12";
const CHEVRON = "M9 6l6 6-6 6";

const withCopy = (p: DemoPersona): DemoPersona => ({ ...p, ...SPEC_COPY[p.key] });

// The auditor has no chat permission, so it lands in the console (§2.2).
const destination = (p: DemoPersona) => (p.key === "auditor" ? "Opens the admin console" : "Opens Ask");

const noticeText = (n: Notice) =>
  n.kind === "throttled" ? THROTTLED : n.kind === "unreachable" ? UNREACHABLE : n.message;

const noSubscribe = () => () => {};

/** `?role=auditor` only highlights that card (§4.4); a GET never signs anyone in. */
function useDeepLinkRole(): string | null {
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => "");
  const role = new URLSearchParams(search).get("role")?.toLowerCase() ?? null;
  return role === "org_admin" ? "admin" : role;
}

/** One-click demo accounts (§4.1). Hidden entirely when the server has demo mode off. */
export function DemoPersonaCards({ variant = "landing" }: { variant?: Variant }) {
  const { ready, me, demo, persona: current, unreachable, reload, signInAs } = useVisitor();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);
  const highlight = useDeepLinkRole();
  const highlightRef = useRef<HTMLButtonElement>(null);
  const scrolled = useRef(false);
  const throttled = notice?.kind === "throttled";
  const personas = demo?.enabled ? demo.personas : [];

  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  useEffect(() => {
    if (!throttled) return;
    const t = window.setTimeout(() => setNotice(null), COOLDOWN_MS);
    return () => window.clearTimeout(t);
  }, [throttled]);

  // Bring a deep-linked card into view once, unless the URL already targets an anchor.
  useEffect(() => {
    const el = highlightRef.current;
    if (variant !== "landing" || !el || scrolled.current) return;
    scrolled.current = true;
    if (!window.location.hash) el.scrollIntoView({ block: "center", behavior: "auto" });
  }, [variant, highlight, personas.length]);

  const show = (n: Notice) => {
    setNotice(n);
    announce(noticeText(n));
  };

  const choose = async (p: DemoPersona) => {
    if (inFlight.current) return;
    // The visitor's own card navigates without signing in again, so a throttle doesn't block it.
    if (me && current?.key === p.key) {
      router.push(homePath(me.permissions));
      return;
    }
    if (throttled) return;
    inFlight.current = true;
    setNotice(null);
    setSlow(false);
    setPending(p.key);
    try {
      const user = await signInAs(p.key);
      announce(`Signed in as ${p.title}`);
      // Stay busy: the cards unmount when the route changes.
      router.replace(homePath(user.permissions));
    } catch (e) {
      inFlight.current = false;
      setPending(null);
      if (e instanceof ApiError && e.status === 429) show({ kind: "throttled" });
      else if (isUnreachable(e)) show({ kind: "unreachable", retry: () => void choose(p) });
      else show({ kind: "error", message: errorText(e) });
    }
  };

  if (!ready) return <Skeletons variant={variant} />;
  if (unreachable) return <NoticeBar notice={{ kind: "unreachable", retry: reload }} variant={variant} />;
  if (personas.length === 0) return null;

  return (
    <div>
      <ul className={variant === "landing" ? GRID : "flex flex-col gap-2"}>
        {personas.map((raw) => {
          const p = withCopy(raw);
          const Card = variant === "landing" ? LandingCard : CompactRow;
          const isCurrent = !pending && current?.key === p.key;
          const locked = pending !== null || (throttled && !isCurrent);
          return (
            <li key={p.key} className="flex">
              <Card
                persona={p}
                state={pending === p.key ? (slow ? "spinning" : "busy") : locked ? "locked" : "idle"}
                isCurrent={isCurrent}
                highlighted={highlight === p.key}
                onChoose={() => void choose(p)}
                buttonRef={highlight === p.key ? highlightRef : undefined}
              />
            </li>
          );
        })}
      </ul>
      {notice && <NoticeBar notice={notice} variant={variant} />}
    </div>
  );
}

interface CardProps {
  persona: DemoPersona;
  state: CardState;
  isCurrent: boolean;
  highlighted: boolean;
  onChoose: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

/** Shared button attributes and state styling for both variants. */
function buttonState(state: CardState) {
  return {
    "aria-busy": state === "busy" || state === "spinning" || undefined,
    "aria-disabled": state === "locked" || undefined,
    stateClass: cx(
      state === "locked" && "cursor-not-allowed opacity-50",
      (state === "busy" || state === "spinning") && "cursor-wait",
    ),
  };
}

function LandingCard({ persona: p, state, isCurrent, highlighted, onChoose, buttonRef }: CardProps) {
  const id = useId();
  const { stateClass, ...aria } = buttonState(state);
  const interactive = state === "idle";
  const pill = isCurrent ? "You're here" : p.key === "engineer" ? "Start here" : null;
  const cta = state === "spinning" ? `Signing in as ${p.title}…` : isCurrent ? "Back to workspace" : `Continue as ${p.title}`;
  const describedBy = [pill && `${id}-pill`, `${id}-who`, `${id}-sum`, `${id}-caps`, `${id}-dest`].filter(Boolean).join(" ");

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onChoose}
      aria-labelledby={`${id}-cta`}
      aria-describedby={describedBy}
      {...aria}
      className={cx(
        // The global :focus-visible rule sets a 4px radius; keep the card's 16px.
        "group flex min-h-[236px] w-full flex-col rounded-2xl border bg-panel p-5 text-left focus-visible:rounded-2xl!",
        "transition-[translate,scale,border-color,box-shadow,opacity] duration-150 ease-[var(--ease-snappy)]",
        highlighted ? "border-accent ring-2 ring-accent/30" : "border-border",
        interactive && "hover:-translate-y-0.5 hover:border-accent hover:shadow-elev-3 active:scale-[.98] active:duration-100",
        stateClass,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <Avatar title={p.title} size="lg" />
        {pill && (
          <Pill id={`${id}-pill`} current={isCurrent}>
            {pill}
          </Pill>
        )}
      </span>
      <span className="mt-3 text-lg leading-[26px] font-semibold">{p.title}</span>
      <span id={`${id}-who`} className="mt-0.5 flex min-w-0 items-baseline gap-1 text-xs text-muted">
        <span className="max-w-[50%] shrink-0 truncate">{p.display_name}</span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate font-mono" title={p.email}>
          {p.email}
        </span>
      </span>
      <span id={`${id}-sum`} className="mt-3 text-sm leading-5">
        {p.summary}
      </span>
      <span id={`${id}-caps`} className="mt-3 flex flex-col gap-1 text-[13px] leading-5">
        {p.can.slice(0, 3).map((c) => (
          <span key={c} className="flex items-start gap-2">
            <LineIcon className="text-accent">
              <Icon name="check" width={14} height={14} />
            </LineIcon>
            {c}
          </span>
        ))}
        {p.cannot.length === 0 ? (
          <span className="pl-[22px] text-muted">No limits</span>
        ) : (
          p.cannot.slice(0, 2).map((c) => (
            <span key={c} className="flex items-start gap-2 text-muted">
              <LineIcon>
                <Glyph d={MINUS} size={14} />
              </LineIcon>
              <span>
                <span className="sr-only">Can&apos;t: </span>
                {c}
              </span>
            </span>
          ))
        )}
      </span>
      <span className="mt-auto flex flex-col pt-4">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-accent">
          {state === "spinning" && <Spinner />}
          <span id={`${id}-cta`}>{cta}</span>
          {state !== "spinning" && (
            <Icon
              name="arrowRight"
              width={15}
              height={15}
              className={cx("shrink-0 transition-[translate] duration-150", interactive && "group-hover:translate-x-0.5")}
            />
          )}
        </span>
        <span id={`${id}-dest`} className="mt-0.5 text-xs text-muted">
          {destination(p)}
        </span>
      </span>
    </button>
  );
}

/** 56px row for the login page: avatar, title, summary and a chevron (§4.2). */
function CompactRow({ persona: p, state, isCurrent, highlighted, onChoose, buttonRef }: CardProps) {
  const id = useId();
  const { stateClass, ...aria } = buttonState(state);
  const interactive = state === "idle";
  const sub = state === "spinning" ? `Signing in as ${p.title}…` : isCurrent ? "Back to workspace" : p.summary;
  const labelledBy = [`${id}-title`, isCurrent && `${id}-pill`, `${id}-sub`].filter(Boolean).join(" ");

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onChoose}
      aria-labelledby={labelledBy}
      {...aria}
      className={cx(
        "flex min-h-14 w-full items-center gap-3 rounded-xl border bg-panel px-3 py-2 text-left focus-visible:rounded-xl!",
        "transition-[scale,border-color,background-color,opacity] duration-150 ease-[var(--ease-snappy)]",
        highlighted ? "border-accent ring-2 ring-accent/30" : "border-border",
        interactive && "hover:border-accent hover:bg-panel-2 active:scale-[.98] active:duration-100",
        stateClass,
      )}
    >
      <Avatar title={p.title} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span id={`${id}-title`} className="text-sm font-semibold">
            {p.title}
          </span>
          {isCurrent && (
            <Pill id={`${id}-pill`} current>
              You&apos;re here
            </Pill>
          )}
        </span>
        <span id={`${id}-sub`} className="block truncate text-xs text-muted" title={sub}>
          {sub}
        </span>
      </span>
      <span className="shrink-0 text-muted">{state === "spinning" ? <Spinner /> : <Glyph d={CHEVRON} size={16} />}</span>
    </button>
  );
}

function Skeletons({ variant }: { variant: Variant }) {
  const landing = variant === "landing";
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading demo accounts…</span>
      <div aria-hidden="true" className={landing ? GRID : "flex flex-col gap-2"}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cx(
              "animate-pulse border border-border bg-panel-2 motion-reduce:animate-none",
              landing ? "h-[236px] rounded-2xl" : "h-14 rounded-xl",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function NoticeBar({ notice, variant }: { notice: Notice; variant: Variant }) {
  const throttled = notice.kind === "throttled";
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm",
        variant === "landing" ? "mx-auto mt-4 max-w-[1040px]" : "mt-3",
        throttled ? "border-warn/30 bg-warn-soft text-warn" : "border-bad/30 bg-bad-soft text-bad",
      )}
    >
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <span aria-hidden="true" className="font-semibold">
          {throttled ? "!" : "✕"}
        </span>
        {noticeText(notice)}
      </p>
      {notice.kind === "unreachable" && (
        <button
          type="button"
          onClick={notice.retry}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-strong bg-panel px-3 text-sm font-medium text-text transition-colors duration-150 hover:bg-panel-2 focus-visible:rounded-lg! sm:min-h-9"
        >
          <Icon name="refresh" width={15} height={15} />
          Try again
        </button>
      )}
    </div>
  );
}

function Avatar({ title, size }: { title: string; size: "lg" | "sm" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent",
        size === "lg" ? "h-10 w-10 text-base" : "h-9 w-9 text-sm",
      )}
    >
      {title.charAt(0).toUpperCase()}
    </span>
  );
}

function Pill({ id, current, children }: { id: string; current: boolean; children: ReactNode }) {
  return (
    <span
      id={id}
      className={cx(
        "badge inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        current ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent",
      )}
    >
      {current && <Icon name="check" width={12} height={12} />}
      {children}
    </span>
  );
}

/** Centres a 14px icon on the first 20px line of a capability. */
function LineIcon({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("flex h-5 shrink-0 items-center", className)}>{children}</span>;
}

function Glyph({ d, size }: { d: string; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" className="shrink-0 animate-spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}
