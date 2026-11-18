"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { announce } from "@/lib/announce";
import type { DemoPersona } from "@/lib/types";
import { isUnreachable, signedInPath, useVisitor } from "./Visitor";

type Variant = "landing" | "compact";

/** idle: clickable · busy: signing in · spinning: busy for over 300ms · locked: another card is busy, or throttled */
type CardState = "idle" | "busy" | "spinning" | "locked";

type Notice = { kind: "throttled" } | { kind: "unreachable"; retry: () => void } | { kind: "error"; message: string };

const THROTTLED = "Too many demo sign-ins from this network. Try again in a minute.";
const UNREACHABLE = "Can't reach RackFlow. Check that the server is running.";
const COOLDOWN_MS = 60_000;
const SPINNER_DELAY_MS = 300;

// Four ruled columns (two by two on tablets, a ruled stack on phones), not four floating cards.
const GRID = "grid grid-cols-1 border-t border-border sm:grid-cols-2 lg:grid-cols-4";
const COLUMN = "flex border-b border-border sm:odd:border-r lg:border-r lg:last:border-r-0";
const COMPACT = "flex flex-col gap-2";
const MINUS = "M6 12h12";
const CHEVRON = "M9 6l6 6-6 6";
const ALERT = "M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01";
const CROSS_CIRCLE = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6";

// The auditor has no chat permission, so it lands in the console (§2.2).
const destination = (p: DemoPersona) => (p.key === "auditor" ? "Opens the admin console" : "Opens Ask");

const noticeText = (n: Notice) =>
  n.kind === "throttled" ? THROTTLED : n.kind === "unreachable" ? UNREACHABLE : n.message;

const noSubscribe = () => () => {};

/** ?next= from the current URL. Read on click so the landing page's markup stays static. */
const nextParam = () => new URLSearchParams(window.location.search).get("next");

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
      router.push(signedInPath(nextParam(), me.permissions));
      return;
    }
    if (throttled) {
      announce(THROTTLED);
      return;
    }
    inFlight.current = true;
    setNotice(null);
    setSlow(false);
    setPending(p.key);
    announce(`Signing in as ${p.title}`);
    try {
      const user = await signInAs(p.key);
      announce(`Signed in as ${p.title}`);
      // Stay busy: the cards unmount when the route changes.
      router.replace(signedInPath(nextParam(), user.permissions));
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
      <ul className={variant === "landing" ? GRID : COMPACT}>
        {personas.map((p) => {
          const Card = variant === "landing" ? LandingCard : CompactRow;
          const isCurrent = !pending && current?.key === p.key;
          const locked = pending !== null || (throttled && !isCurrent);
          return (
            <li key={p.key} className={variant === "landing" ? COLUMN : "flex"}>
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
    cursorClass: cx(
      state === "locked" && "cursor-not-allowed",
      (state === "busy" || state === "spinning") && "cursor-wait",
    ),
  };
}

/** One ruled column per persona. The button holds only its CTA, so its name matches its visible
 *  text (WCAG 2.5.3); its ::after stretches over the column, so the whole column is one target. */
function LandingCard({ persona: p, state, isCurrent, highlighted, onChoose, buttonRef }: CardProps) {
  const id = useId();
  const { cursorClass, ...aria } = buttonState(state);
  const interactive = state === "idle";
  const busy = state === "busy" || state === "spinning";
  const tag = isCurrent ? "You're here" : p.key === "engineer" ? "Start here" : null;
  const cta = state === "spinning" ? `Signing in as ${p.title}…` : isCurrent ? "Back to workspace" : `Continue as ${p.title}`;
  const describedBy = [tag && `${id}-pill`, isCurrent && `${id}-title`, `${id}-who`, `${id}-caps`, `${id}-dest`]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      title={`${p.display_name}, ${p.email}`}
      className={cx(
        "group relative flex w-full flex-col p-6 text-left",
        "transition-[background-color,opacity] duration-[var(--dur-micro)] ease-out",
        highlighted && "bg-accent-soft/60 shadow-[inset_0_2px_0_var(--accent)]",
        interactive && "hover:bg-panel-2 has-[button:active]:bg-panel-3",
        busy && "bg-panel-2",
        state === "locked" && "opacity-55",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span id={`${id}-title`} className="font-display text-title font-semibold text-text">
          {p.title}
        </span>
        {tag && (
          <Tag id={`${id}-pill`} current={isCurrent}>
            {tag}
          </Tag>
        )}
      </span>
      {/* The sign-in address only: the title already names the role, and the capability rows
          below say what the summary would. The display name stays in the column's tooltip. */}
      <span id={`${id}-who`} className="mt-1 block truncate font-mono text-xs text-muted">
        {p.email}
      </span>
      <span id={`${id}-caps`} className="mt-4 flex flex-col gap-1 text-sm leading-6">
        {p.can.slice(0, 3).map((c) => (
          <span key={c} className="flex items-start gap-2 text-text">
            <LineIcon className="text-accent">
              <Icon name="check" />
            </LineIcon>
            {c}
          </span>
        ))}
        {p.cannot.length === 0 ? (
          <span className="pl-6 text-muted">No limits</span>
        ) : (
          p.cannot.slice(0, 2).map((c) => (
            <span key={c} className="flex items-start gap-2 text-muted">
              <LineIcon>
                <Glyph d={MINUS} size={16} />
              </LineIcon>
              <span>
                <span className="sr-only">Can&apos;t: </span>
                {c}
              </span>
            </span>
          ))
        )}
      </span>
      <span className="mt-auto flex flex-col gap-1 pt-6">
        <span className="flex items-center gap-2 font-display text-base font-medium text-accent">
          {state === "spinning" && <Spinner />}
          <button
            ref={buttonRef}
            type="button"
            onClick={onChoose}
            aria-describedby={describedBy}
            {...aria}
            className={cx(
              "min-h-6 text-left underline-offset-4 after:absolute after:inset-0 aria-disabled:cursor-not-allowed",
              interactive && "group-hover:underline",
              // The ring goes on the ::after, inset, so it traces the column without crossing its rules.
              "focus-visible:outline-none! focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-[var(--focus)]",
              cursorClass,
            )}
          >
            {cta}
          </button>
        </span>
        <span id={`${id}-dest`} className="text-sm text-muted">
          {destination(p)}
        </span>
      </span>
    </div>
  );
}

/** 56px row for the login page: avatar, title, summary and a chevron. */
function CompactRow({ persona: p, state, isCurrent, highlighted, onChoose, buttonRef }: CardProps) {
  const { cursorClass, ...aria } = buttonState(state);
  const interactive = state === "idle";
  const busy = state === "busy" || state === "spinning";
  const sub = state === "spinning" ? `Signing in as ${p.title}…` : isCurrent ? "Back to workspace" : p.summary;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onChoose}
      {...aria}
      className={cx(
        "flex min-h-14 w-full items-center gap-3 rounded-card border bg-panel px-3 py-2 text-left focus-visible:rounded-card! aria-disabled:cursor-not-allowed",
        "transition-[background-color,border-color,opacity] duration-[var(--dur-micro)] ease-out",
        highlighted ? "border-accent bg-accent-soft/40" : "border-border",
        interactive && "hover:border-border-strong hover:bg-panel-2 active:bg-panel-3",
        busy && "bg-panel-2",
        cursorClass,
        state === "locked" && "opacity-55",
      )}
    >
      <Avatar title={p.title} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display text-sm font-medium text-text">{p.title}</span>
          {isCurrent && <Tag current>You&apos;re here</Tag>}
        </span>
        {/* A touch screen has no tooltip, so narrow rows wrap instead of cutting the summary. */}
        <span className="block text-xs text-muted sm:truncate" title={sub}>
          {sub}
        </span>
      </span>
      <span className="shrink-0 text-muted">{state === "spinning" ? <Spinner /> : <Glyph d={CHEVRON} size={16} />}</span>
    </button>
  );
}

/** Placeholders in the shape of what is coming: ruled columns, or rows on the login page. */
function Skeletons({ variant }: { variant: Variant }) {
  const bar = "animate-shimmer rounded-sm bg-panel-3 motion-reduce:animate-none";
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading demo accounts…</span>
      {variant === "landing" ? (
        <div aria-hidden="true" className={GRID}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cx(COLUMN, "h-[304px] flex-col gap-3 p-6")}>
              <div className={cx(bar, "h-6 w-1/2")} />
              <div className={cx(bar, "h-4 w-3/4")} />
              <div className={cx(bar, "mt-4 h-4 w-full")} />
              <div className={cx(bar, "h-4 w-5/6")} />
              <div className={cx(bar, "h-4 w-2/3")} />
              <div className={cx(bar, "mt-auto h-5 w-1/2")} />
            </div>
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className={COMPACT}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={cx(bar, "h-14 rounded-card")} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoticeBar({ notice, variant }: { notice: Notice; variant: Variant }) {
  const throttled = notice.kind === "throttled";
  return (
    <div
      className={cx(
        // Sticky so that on a one-column phone layout it stays on screen beside the tapped column.
        "sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-[var(--z-raised)] flex flex-wrap items-center gap-x-3 gap-y-2",
        "rounded-card px-4 py-3 text-sm max-sm:shadow-elev-3",
        variant === "landing" ? "mt-4" : "mt-3",
        throttled ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad",
      )}
    >
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <span className="flex h-5 shrink-0 items-center">
          <Glyph d={throttled ? ALERT : CROSS_CIRCLE} size={16} />
        </span>
        {noticeText(notice)}
      </p>
      {notice.kind === "unreachable" && (
        <button type="button" onClick={notice.retry} className="key min-h-11 focus-visible:outline-offset-2 sm:min-h-10">
          <Icon name="refresh" />
          Try again
        </button>
      )}
    </div>
  );
}

/** The initial is generated content: it is decoration, not part of the button's visible label (2.5.3). */
function Avatar({ title }: { title: string }) {
  return (
    <span
      aria-hidden="true"
      data-initial={title.charAt(0).toUpperCase()}
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-full border border-border-2 bg-panel-2 font-display text-sm font-semibold text-text-2",
        "before:content-[attr(data-initial)]",
      )}
    />
  );
}

/** A small tag: "Start here" in the accent, "You're here" in the ok colour with a check, so the
 *  state never rests on colour alone. Square-cornered chip, never a pill. */
function Tag({ id, current, children }: { id?: string; current: boolean; children: ReactNode }) {
  return (
    <span
      id={id}
      className={cx(
        "badge inline-flex h-6 shrink-0 items-center gap-1 rounded-chip px-2 text-xs font-medium",
        current ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent",
      )}
    >
      {current && <Icon name="check" width={12} height={12} />}
      {children}
    </span>
  );
}

/** Centres a 16px icon on the first 24px line of a capability. */
function LineIcon({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("flex h-6 shrink-0 items-center", className)}>{children}</span>;
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
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}
