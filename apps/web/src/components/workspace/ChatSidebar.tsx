"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { homePath } from "@/components/Shell";
import { cx } from "@/components/ui";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/demo";
import { useApi } from "@/lib/hooks";
import type { DocumentItem, Page } from "@/lib/types";
import type { ChatSession } from "./types";
import { useUploads } from "./UploadsContext";
import { useWorkspace } from "./WorkspaceContext";

type NavigateProps = { onNavigate?: () => void };

interface ChatSidebarProps extends NavigateProps {
  /** Persistent sidebar only: hides it (the shell also binds Ctrl+Shift+S). */
  onCollapse?: () => void;
  /** Chats created in this tab that the Recent list hasn't returned yet (§5.10 optimistic rows). */
  pendingIds?: ReadonlySet<string>;
}

// 36px rows (44px below lg, where the sidebar is a touch drawer).
const ROW =
  "flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 lg:h-9";
const ROW_IDLE = "text-text hover:bg-panel-2";
const ROW_ACTIVE = "bg-accent-soft font-medium text-text";

/** Sidebar contents (§5.2 + §5.10): logo row, New chat, Add files, My documents (+ready badge),
 *  Recent (date groups), footer (demo note, Admin console, user chip + menu).
 *  Ctrl+Shift+O (new chat) and Ctrl+Shift+S (collapse) are bound once, in WorkspaceShell. */
export function ChatSidebar({ onNavigate, onCollapse, pendingIds }: ChatSidebarProps) {
  const { me, consoleHref, persona } = useWorkspace();
  const uploads = useUploads();
  const pathname = usePathname();

  const libraryActive = pathname === "/library" || pathname.startsWith("/library/");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1 px-3">
        <Link
          href={homePath(me.permissions)}
          onClick={() => onNavigate?.()}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pr-2 text-[15px] font-semibold text-text"
        >
          <Logo size={28} />
          <span className="truncate">RackFlow AI</span>
        </Link>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            data-sidebar-toggle=""
            aria-label="Collapse sidebar"
            title="Collapse sidebar (Ctrl+Shift+S)"
            aria-keyshortcuts="Control+Shift+S"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel-2 hover:text-text"
          >
            <SidebarIcon />
          </button>
        )}
      </div>

      <div className="shrink-0 space-y-0.5 px-2">
        <Link
          href="/ask"
          onClick={() => onNavigate?.()}
          title="New chat (Ctrl+Shift+O)"
          aria-keyshortcuts="Control+Shift+O"
          className={cx(
            "mb-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 lg:h-10",
            "text-sm font-medium text-accent-contrast hover:bg-accent/90",
            "transition-[background-color,scale] duration-100 active:scale-[.98]",
          )}
        >
          <PencilIcon />
          New chat
        </Link>

        {uploads.canUpload && (
          <button
            type="button"
            onClick={() => {
              uploads.pickFiles();
              onNavigate?.();
            }}
            className={cx(ROW, ROW_IDLE)}
          >
            <Icon name="upload" className="shrink-0 text-muted" />
            Add files
          </button>
        )}

        <Link
          href="/library"
          onClick={() => onNavigate?.()}
          aria-current={libraryActive ? "page" : undefined}
          className={cx(ROW, libraryActive ? ROW_ACTIVE : ROW_IDLE)}
        >
          <Icon name="documents" className="shrink-0 text-muted" />
          <span className="flex-1 truncate">My documents</span>
          <ReadyBadge canRead={me.permissions.includes("collection:read")} />
        </Link>
      </div>

      <RecentChats onNavigate={onNavigate} pathname={pathname} pendingIds={pendingIds} />

      <div className="shrink-0 border-t border-border px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        {persona && (
          <p className="px-2.5 pb-2 text-xs text-muted">
            Shared demo account: anyone using it sees these chats.
          </p>
        )}
        {consoleHref && (
          <Link href={consoleHref} onClick={() => onNavigate?.()} className={cx(ROW, ROW_IDLE)}>
            <Icon name="settings" className="shrink-0 text-muted" />
            Admin console
          </Link>
        )}
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/** Muted count of Ready documents; hidden until known and when zero. */
function ReadyBadge({ canRead }: { canRead: boolean }) {
  const ready = useApi<Page<DocumentItem>>(canRead ? "/documents?status=indexed&limit=200" : null, 15_000);
  const count = ready.data?.items.length ?? 0;
  if (!count) return null;
  const label = count >= 200 && ready.data?.next_cursor ? "200+" : String(count);
  return (
    <>
      <span
        aria-hidden="true"
        className="badge rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium tabular-nums text-muted"
      >
        {label}
      </span>
      <span className="sr-only">, {label} ready</span>
    </>
  );
}

// ---------- Recent chats (§5.10) ----------

interface SessionRow {
  session: ChatSession;
  label: string;
}

interface SessionGroup {
  key: string;
  label: string;
  rows: SessionRow[];
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight of today; re-renders only when the date changes. */
function useTodayStart(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setToday(startOfDay(Date.now())), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

function titleOf(s: ChatSession): string {
  return s.title.trim() || "Untitled chat";
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Today / Yesterday / Previous 7 days / Previous 30 days / month, newest first. */
function groupSessions(items: ChatSession[], todayStart: number): SessionGroup[] {
  const today = new Date(todayStart);
  const daysAgo = (n: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - n).getTime();
  const yesterday = daysAgo(1);
  const week = daysAgo(7);
  const month = daysAgo(30);

  const seen = new Set<string>();
  const unique = items.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const titleCount = new Map<string, number>();
  for (const s of unique) titleCount.set(titleOf(s), (titleCount.get(titleOf(s)) ?? 0) + 1);

  const sorted = [...unique].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const groups: SessionGroup[] = [];
  for (const session of sorted) {
    const at = new Date(session.updated_at);
    const t = at.getTime();
    let key: string;
    let label: string;
    if (Number.isNaN(t) || t >= todayStart) [key, label] = ["today", "Today"];
    else if (t >= yesterday) [key, label] = ["yesterday", "Yesterday"];
    else if (t >= week) [key, label] = ["week", "Previous 7 days"];
    else if (t >= month) [key, label] = ["month", "Previous 30 days"];
    else {
      key = `m-${at.getFullYear()}-${at.getMonth()}`;
      label = at.toLocaleDateString(
        undefined,
        at.getFullYear() === today.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" },
      );
    }
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label, rows: [] };
      groups.push(group);
    }
    const title = titleOf(session);
    const repeated = (titleCount.get(title) ?? 0) > 1 && !Number.isNaN(t);
    group.rows.push({ session, label: repeated ? `${title} · ${formatTime(at)}` : title });
  }
  return groups;
}

const SKELETON_WIDTHS = ["w-3/4", "w-1/2", "w-5/6", "w-2/3", "w-2/5", "w-3/5"];

function RecentChats({
  onNavigate,
  pathname,
  pendingIds,
}: NavigateProps & { pathname: string; pendingIds?: ReadonlySet<string> }) {
  const { sessions } = useWorkspace();
  const todayStart = useTodayStart();
  const groups = useMemo(() => groupSessions(sessions.items, todayStart), [sessions.items, todayStart]);
  const navRef = useRef<HTMLElement>(null);
  const baseId = useId();

  // Keep the open chat visible when arriving on it directly.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [pathname, groups.length]);

  const empty = sessions.items.length === 0;

  return (
    <nav aria-label="Recent chats" ref={navRef} className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div aria-hidden="true" className="px-2.5 pb-1 text-xs font-semibold text-muted">
        Recent
      </div>

      {sessions.error && (
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium text-text">Couldn&apos;t load chats</p>
          <button
            type="button"
            onClick={() => sessions.reload()}
            className={cx(
              "mt-1.5 inline-flex h-11 items-center gap-1.5 rounded-lg border border-border-strong bg-panel px-3",
              "text-sm font-medium text-text transition-colors duration-150 hover:bg-panel-2 lg:h-9",
            )}
          >
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}

      {sessions.loading && empty && !sessions.error && (
        <>
          <span className="sr-only">Loading chats</span>
          <ul aria-hidden="true">
            {SKELETON_WIDTHS.map((w) => (
              <li key={w} className="flex h-11 items-center px-2.5 lg:h-9">
                <span className={cx("h-3 rounded bg-border motion-safe:animate-pulse", w)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {!sessions.loading && empty && !sessions.error && (
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium text-text">No chats yet</p>
          <p className="mt-0.5 text-xs text-muted">Your questions will appear here.</p>
        </div>
      )}

      {groups.map((group) => {
        const labelId = `${baseId}-${group.key}`;
        return (
          <div key={group.key} className="pt-3 first:pt-1">
            <div id={labelId} className="px-2.5 pb-1 text-xs font-medium text-muted">
              {group.label}
            </div>
            <ul aria-labelledby={labelId} className="space-y-px">
              {group.rows.map(({ session, label }) => {
                const href = `/ask/c/${session.id}`;
                const active = pathname === href;
                const pending = pendingIds?.has(session.id) ?? false;
                return (
                  <li key={session.id}>
                    <Link
                      href={href}
                      title={label}
                      onClick={() => onNavigate?.()}
                      aria-current={active ? "page" : undefined}
                      className={cx(ROW, active ? ROW_ACTIVE : ROW_IDLE)}
                    >
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {pending && (
                        <>
                          <RowSpinner />
                          <span className="sr-only">, saving</span>
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

// ---------- User chip + APG menu button ----------

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

function UserMenu({ onNavigate }: NavigateProps) {
  const { me, persona } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<"first" | "last">("first");
  const buttonId = useId();
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (focusTarget.current === "last" ? items[items.length - 1] : items[0])?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openMenu = (target: "first" | "last") => {
    focusTarget.current = target;
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(e.key === "ArrowUp" ? "last" : "first");
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => items[(n + items.length) % items.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(i - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case "Escape":
        // Close only the menu, not the drawer dialog around it.
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await api("/auth/logout", { method: "POST", noAuthRedirect: true }).catch(() => undefined);
    // Full reload on purpose: drops all client-side state after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  };

  const name = me.display_name.trim() || me.email;
  const initial = name.charAt(0).toUpperCase();
  const itemClass = cx(ROW, "text-text hover:bg-panel-2 focus:bg-panel-2");

  return (
    <div ref={wrapRef} className="relative mt-1">
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          onKeyDown={onMenuKeyDown}
          className={cx(
            "absolute inset-x-0 bottom-full z-20 mb-1 rounded-xl border border-border bg-panel p-1 shadow-elev-3",
            "transition-[opacity,translate] duration-200 ease-[var(--ease-snappy)]",
            "starting:opacity-0 motion-safe:starting:translate-y-1",
          )}
        >
          {persona && (
            <Link
              href="/#demo"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className={itemClass}
            >
              <Icon name="users" className="shrink-0 text-muted" />
              Switch persona
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={signingOut || undefined}
            onClick={() => void signOut()}
            className={itemClass}
          >
            <Icon name="logout" className="shrink-0 text-muted" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}

      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
        className="flex h-13 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors duration-150 hover:bg-panel-2"
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text">{name}</span>
          <span className="block truncate text-xs text-muted">{ROLE_LABEL[me.role] ?? me.role}</span>
        </span>
        <ChevronsIcon />
      </button>
    </div>
  );
}

function PencilIcon() {
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
      className="shrink-0"
    >
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h16v14H4zM9.5 5v14" />
    </svg>
  );
}

/** 12px spinner on a Recent row that hasn't been reconciled with the server list yet. */
function RowSpinner() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 shrink-0 text-muted motion-safe:animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronsIcon() {
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
      className="shrink-0 text-muted"
    >
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}
