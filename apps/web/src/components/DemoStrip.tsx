"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { announce } from "@/lib/announce";
import { api, ApiError, errorText } from "@/lib/api";
import { personaFor } from "@/lib/demo";
import { pendingStore } from "@/lib/pendingStore";
import type { DemoInfo, DemoPersona, Me } from "@/lib/types";
import { demoLogin, fetchDemoInfo } from "@/lib/workspace";
import { Icon } from "./icons";
import { cx } from "./ui";

/** §4.4 polite switch message, per persona: what the new role can and can't do. */
const SWITCH_COPY: Record<DemoPersona["key"], string> = {
  engineer: "You can upload files and ask questions, but not open the admin console.",
  operator: "You can ask questions, but not upload.",
  admin: "You can do everything, including managing people and settings.",
  auditor: "You can read the audit log, but not open documents or ask questions.",
};

const RATE_LIMIT_MS = 60_000;
const TOAST_MS = 6_000;
const TOAST_GAP_PX = 16;
const DEMO_RETRY_MS = 3_000;
const DEMO_RETRY_MAX_MS = 60_000;

// Module state: a switch can change shell (/ask to /overview), which remounts the strip.
let toast: string | null = null;
let toastTimer: number | undefined;
const toastListeners = new Set<() => void>();

function setToast(text: string | null) {
  toast = text;
  window.clearTimeout(toastTimer);
  if (text) toastTimer = window.setTimeout(() => setToast(null), TOAST_MS);
  toastListeners.forEach((l) => l());
}

function subscribeToast(listener: () => void) {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

const menuOpeners = new Set<() => void>();

/** Opens the §4.4 persona menu in place, for "Switch persona" entries outside the strip.
 *  Returns false when no strip is showing (not a demo session, or the demo list hasn't loaded). */
export function openPersonaMenu(): boolean {
  menuOpeners.forEach((open) => open());
  return menuOpeners.size > 0;
}

interface StripError {
  text: string;
  retry?: () => void;
}

const stripButton = cx(
  "inline-flex h-7 min-w-11 items-center justify-center gap-1 rounded-md px-2 font-medium whitespace-nowrap",
  "transition-colors duration-150 hover:bg-demo-border focus-visible:outline-offset-[-2px]",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
);

/** 32px demo indicator on every signed-in page (§4.3) with Switch persona menu and Exit (§4.4).
 *  Renders nothing unless `me` is a demo persona. Calls onSwitched(newMe) after a switch. */
export function DemoStrip({
  me,
  demo: shellDemo,
  onSwitched,
}: {
  me: Me;
  demo: DemoInfo | null;
  onSwitched: (me: Me) => void;
}) {
  const router = useRouter();
  const [retriedDemo, setRetriedDemo] = useState<DemoInfo | null>(null);
  const demo = shellDemo ?? retriedDemo;
  const persona = personaFor(me, demo);
  const isDemo = persona !== null;
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<DemoPersona["key"] | null>(null);
  const [exiting, setExiting] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [error, setError] = useState<StripError | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef<"first" | "last">("first");
  const rateTimer = useRef<number | undefined>(undefined);
  const buttonId = useId();
  const menuId = useId();

  // APG Menu Button: opening moves focus into the menu.
  useEffect(() => {
    if (!open) return;
    const items = menuItems(itemRefs.current);
    (focusOnOpen.current === "last" ? items[items.length - 1] : items[0])?.focus();
  }, [open]);

  // A press outside the button and menu closes it without moving focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => () => window.clearTimeout(rateTimer.current), []);

  // The shells fetch the demo list once. §4.3: the strip can't go missing because that one call failed.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = (delay: number) => {
      timer = window.setTimeout(() => {
        fetchDemoInfo().then(
          (info) => {
            if (!cancelled) setRetriedDemo(info);
          },
          () => {
            if (!cancelled) attempt(Math.min(delay * 2, DEMO_RETRY_MAX_MS));
          },
        );
      }, delay);
    };
    attempt(DEMO_RETRY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [demo]);

  useEffect(() => {
    if (!isDemo) return;
    const open = () => {
      focusOnOpen.current = "first";
      setOpen(true);
    };
    menuOpeners.add(open);
    return () => {
      menuOpeners.delete(open);
    };
  }, [isDemo]);

  if (!persona || !demo) return null;

  const locked = busyKey !== null || exiting || rateLimited;

  const fail = (e: unknown, retry: () => void, target?: DemoPersona) => {
    if (e instanceof ApiError && e.status === 429 && target) {
      setRateLimited(true);
      setError({ text: "Too many demo sign-ins from this network. Try again in a minute." });
      window.clearTimeout(rateTimer.current);
      rateTimer.current = window.setTimeout(() => {
        setRateLimited(false);
        setError(null);
      }, RATE_LIMIT_MS);
    } else if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
      setError({ text: "Can't reach RackFlow. Check that the server is running.", retry });
    } else if (e instanceof ApiError && e.status === 404 && target) {
      setError({ text: `The ${target.title} demo account isn't set up on this server.` });
    } else {
      setError({ text: errorText(e) });
    }
  };

  const closeMenu = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const openMenu = (focus: "first" | "last") => {
    if (!rateLimited) setError(null);
    if (open) {
      const items = menuItems(itemRefs.current);
      (focus === "last" ? items[items.length - 1] : items[0])?.focus();
      return;
    }
    focusOnOpen.current = focus;
    setOpen(true);
  };

  const switchTo = async (target: DemoPersona) => {
    setBusyKey(target.key);
    setError(null);
    let next: Me;
    try {
      next = await demoLogin(target.key);
    } catch (e) {
      setBusyKey(null);
      fail(e, () => void switchTo(target), target);
      return;
    }
    setBusyKey(null);
    // Only take focus back if the user is still in the menu (they may have pressed Escape and moved on).
    closeMenu(wrapRef.current?.contains(document.activeElement) ?? false);
    onSwitched(next);
    router.refresh();
    const message = `You're now ${target.title}. ${SWITCH_COPY[target.key] ?? ""}`.trim();
    setToast(message);
    announce(message);
  };

  const choose = (target: DemoPersona) => {
    if (locked) return;
    if (target.key === persona.key) {
      closeMenu(true);
      return;
    }
    void switchTo(target);
  };

  const exit = async () => {
    if (exiting || busyKey) return;
    setOpen(false);
    setExiting(true);
    if (!rateLimited) setError(null);
    try {
      await api<void>("/auth/logout", { method: "POST", noAuthRedirect: true });
    } catch (e) {
      // A session that already ended is as good as a logout.
      if (!(e instanceof ApiError && e.status === 401)) {
        setExiting(false);
        fail(e, () => void exit());
        return;
      }
    }
    // Client nav (§4.4). Leaving the shell unmounts its cached queries and `/` reloads the visitor;
    // a toast or hand-off still held in module state must not outlive the demo session.
    setToast(null);
    pendingStore.take();
    router.replace("/");
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(e.key === "ArrowUp" ? "last" : "first");
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(itemRefs.current);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return focusAt(index + 1);
      case "ArrowUp":
        return focusAt(index < 0 ? items.length - 1 : index - 1);
      case "Home":
        return focusAt(0);
      case "End":
        return focusAt(items.length - 1);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return closeMenu(true);
      case "Tab":
        // Tab leaves the menu and closes it; land on the neighbouring strip control.
        e.preventDefault();
        setOpen(false);
        (e.shiftKey ? buttonRef.current : exitRef.current)?.focus();
        return;
    }
    // Type-ahead: jump to the next persona whose title starts with the typed character.
    if (e.key.length === 1 && e.key.trim() && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      const order = [...items.slice(index + 1), ...items.slice(0, index + 1)];
      const hit = order.find((el) => el.dataset.title?.toLowerCase().startsWith(key));
      if (hit) {
        e.preventDefault();
        hit.focus();
      }
    }
  };

  const fullCopy = `You're ${me.display_name} (${persona.title}) · Others using this demo see the same files and chats`;

  return (
    <div
      role="region"
      aria-label="Demo account"
      className={cx(
        "sticky top-0 z-40 flex min-h-8 items-center gap-1 border-b border-demo-border bg-demo-bg px-4",
        "text-[13px] leading-5 text-demo-fg",
      )}
    >
      <SwitchToast />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 py-1">
        <strong className="shrink-0 font-semibold">
          <span className="hidden md:inline">Demo account</span>
          <span className="md:hidden">Demo</span>
        </strong>
        <span aria-hidden="true">·</span>
        {error ? (
          <span role="alert" className="min-w-0">
            <AlertGlyph />
            {error.text}
            {error.retry && (
              <button
                type="button"
                onClick={error.retry}
                className="ml-2 rounded font-semibold underline underline-offset-2 hover:no-underline"
              >
                Try again
              </button>
            )}
          </span>
        ) : (
          <span className="min-w-0 truncate" title={fullCopy}>
            <span className="hidden md:inline">{fullCopy}</span>
            <span className="md:hidden">{persona.title}</span>
          </span>
        )}
      </div>

      {/* Not positioned: the menu anchors to the sticky strip so it stays inside narrow viewports. */}
      <div ref={wrapRef} className="flex shrink-0 items-center">
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? closeMenu(false) : openMenu("first"))}
          onKeyDown={onButtonKeyDown}
          className={cx(stripButton, "aria-expanded:bg-demo-border")}
        >
          <span className="hidden md:inline">Switch persona</span>
          <span className="md:hidden">Switch</span>
          <span aria-hidden="true">▾</span>
        </button>

        {open && (
          <div
            id={menuId}
            role="menu"
            aria-labelledby={buttonId}
            onKeyDown={onMenuKeyDown}
            className={cx(
              "absolute top-full right-4 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border",
              "bg-panel p-1 text-text shadow-elev-3",
              "transition-[opacity,translate] duration-200 ease-(--ease-snappy)",
              "starting:opacity-0 motion-safe:starting:translate-y-1",
            )}
          >
            {demo.personas.map((p, i) => {
              const current = p.key === persona.key;
              const busy = busyKey === p.key;
              return (
                <button
                  key={p.key}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  aria-disabled={locked || undefined}
                  aria-busy={busy || undefined}
                  tabIndex={-1}
                  data-title={p.title}
                  onClick={() => choose(p)}
                  className={cx(
                    "flex min-h-14 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left",
                    "transition-colors duration-150 hover:bg-panel-2 focus:bg-panel-2 focus-visible:outline-offset-[-2px]",
                    locked && !busy && "opacity-50",
                    locked && "cursor-not-allowed",
                    busy && "cursor-wait",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent"
                  >
                    {p.title.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{p.title}</span>
                    <span className="block text-[13px] leading-5 text-muted">{p.summary}</span>
                  </span>
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-accent">
                    {busy ? <Spinner /> : current ? <Icon name="check" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        ref={exitRef}
        type="button"
        onClick={() => void exit()}
        aria-disabled={exiting || busyKey !== null || undefined}
        aria-busy={exiting || undefined}
        className={stripButton}
      >
        <span className="hidden md:inline">Exit demo</span>
        <span className="md:hidden">Exit</span>
      </button>
    </div>
  );
}

/** §4.4 polite toast. Visual only: announce() already speaks the same words (§9 #2). */
function SwitchToast() {
  const text = useSyncExternalStore(subscribeToast, () => toast, () => null);
  const [bottom, setBottom] = useState(TOAST_GAP_PX);

  // §10: above the composer. It moves as the new persona's page loads, so keep measuring while shown.
  useEffect(() => {
    if (!text) return;
    const place = () => {
      const composer = document.getElementById("composer-input")?.closest("form");
      setBottom(composer ? window.innerHeight - composer.getBoundingClientRect().top + TOAST_GAP_PX : TOAST_GAP_PX);
    };
    place();
    const timer = window.setInterval(place, 200);
    return () => window.clearInterval(timer);
  }, [text]);

  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 z-50 flex justify-center" style={{ bottom }}>
      <p
        className={cx(
          "max-w-md rounded-xl border border-border bg-panel px-4 py-2.5 text-sm text-text shadow-elev-3",
          "transition-[opacity,translate] duration-200 ease-(--ease-snappy)",
          "starting:opacity-0 motion-safe:starting:translate-y-1",
        )}
      >
        {text}
      </p>
    </div>
  );
}

function menuItems(refs: (HTMLButtonElement | null)[]): HTMLButtonElement[] {
  return refs.filter((el): el is HTMLButtonElement => el !== null && el.isConnected);
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      aria-hidden="true"
      className="animate-spin motion-reduce:animate-none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mr-1 inline-block -translate-y-px align-middle"
    >
      <path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01" />
    </svg>
  );
}
