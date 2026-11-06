"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { openPersonaMenu } from "@/components/DemoStrip";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { homePath } from "@/components/Shell";
import { cx } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/demo";
import { useApi } from "@/lib/hooks";
import type { DocumentItem, Page } from "@/lib/types";
import { DotsIcon, secondaryButtonClass } from "./library/parts";
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
  const { me, canChat, consoleHref, persona } = useWorkspace();
  const uploads = useUploads();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const previousPath = useRef(pathname);
  const inDrawer = onNavigate !== undefined;

  const libraryActive = pathname === "/library" || pathname.startsWith("/library/");
  const readyUploads = uploads.items.filter((u) => u.phase === "indexed").length;

  // Leaving a chat for a new one from the sidebar or Ctrl+Shift+O: focus would stay on a row that
  // no longer means anything, so it moves to the question box. The drawer returns focus itself.
  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (previous === pathname || pathname !== "/ask" || inDrawer) return;
    // The question box appears once the new view has loaded its data; give up on it after a moment.
    const deadline = Date.now() + 2000;
    let frame = 0;
    const moveFocus = () => {
      if (!rootRef.current?.contains(document.activeElement)) return; // the user has moved on
      const composer = document.getElementById("composer-input");
      if (composer) composer.focus();
      else if (Date.now() > deadline) document.getElementById("main")?.focus();
      else frame = requestAnimationFrame(moveFocus);
    };
    frame = requestAnimationFrame(moveFocus);
    return () => cancelAnimationFrame(frame);
  }, [pathname, inDrawer]);

  return (
    <div ref={rootRef} data-chat-sidebar="" className="flex h-full min-h-0 flex-col">
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
        {/* §2.3: a role without chat:use is not offered chat actions. */}
        {canChat && (
          <Link
            href="/ask"
            data-new-chat=""
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
        )}

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
          <ReadyBadge canRead={me.permissions.includes("collection:read")} readyUploads={readyUploads} />
        </Link>
      </div>

      {canChat ? (
        <RecentChats onNavigate={onNavigate} pathname={pathname} pendingIds={pendingIds} />
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <div className="shrink-0 border-t border-border px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        {persona && canChat && (
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

/** Muted count of Ready documents; hidden until known and when zero. It refetches as soon as an
 *  upload from this tab turns Ready, so it never trails the chips and the heading next to it. */
function ReadyBadge({ canRead, readyUploads }: { canRead: boolean; readyUploads: number }) {
  const ready = useApi<Page<DocumentItem>>(canRead ? "/documents?status=indexed&limit=200" : null, 15_000, {
    noAuthRedirect: true,
    pauseWhenHidden: true,
  });
  const { reload } = ready;
  const seenUploads = useRef(readyUploads);
  useEffect(() => {
    if (seenUploads.current === readyUploads) return;
    seenUploads.current = readyUploads;
    reload();
  }, [readyUploads, reload]);
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

/** Chats deleted in this tab. The shell keeps its optimistic rows until the server list contains
 *  them, so a chat created here and then deleted would otherwise come back as a spinning row. It
 *  is module-level because the sidebar unmounts when collapsed; ids are never reused. */
const deletedChats = new Set<string>();

function chatPath(id: string): string {
  return `/chat/sessions/${encodeURIComponent(id)}`;
}

/** The API's own message for "can't reach the server", otherwise the caller's sentence. */
function actionError(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.status === 0 ? e.message : fallback;
}

function RecentChats({
  onNavigate,
  pathname,
  pendingIds,
}: NavigateProps & { pathname: string; pendingIds?: ReadonlySet<string> }) {
  const { sessions, announce } = useWorkspace();
  const router = useRouter();
  const todayStart = useTodayStart();
  // New titles shown from Enter until the reloaded list says the same thing.
  const [savedTitles, setSavedTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [renaming, setRenaming] = useState<{ id: string; draft: string; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState<ChatSession | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const refocusRow = useRef<string | null>(null);
  const afterDelete = useRef<HTMLElement | null>(null);
  const baseId = useId();

  const landed = sessions.items.filter((s) => savedTitles.get(s.id) === s.title);
  if (landed.length) {
    const next = new Map(savedTitles);
    for (const s of landed) next.delete(s.id);
    setSavedTitles(next);
  }

  const visible = sessions.items
    .filter((s) => !deletedChats.has(s.id))
    .map((s) => {
      const title = savedTitles.get(s.id);
      return title === undefined ? s : { ...s, title };
    });
  const groups = groupSessions(visible, todayStart);

  // Keep the open chat visible when arriving on it directly.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [pathname, groups.length]);

  // Enter or Esc in the rename box: back to that row's "⋯" button once it has rendered again.
  useEffect(() => {
    const id = refocusRow.current;
    if (renaming || !id) return;
    refocusRow.current = null;
    navRef.current?.querySelector<HTMLElement>(`[data-chat-menu="${id}"]`)?.focus();
  }, [renaming]);

  const saveRename = async (session: ChatSession, draft: string) => {
    const title = draft.trim();
    setRenaming(null);
    // Compares with the shown title, so leaving an "Untitled chat" box unchanged doesn't save that text.
    if (!title || title === titleOf(session)) return;
    setSavedTitles((m) => new Map(m).set(session.id, title));
    const forget = () =>
      setSavedTitles((m) => {
        const next = new Map(m);
        next.delete(session.id);
        return next;
      });
    try {
      await api<ChatSession>(chatPath(session.id), { method: "PATCH", json: { title } });
      announce("Chat renamed");
      sessions.reload();
    } catch (e) {
      forget();
      if (e instanceof ApiError && e.status === 404) {
        // Someone else on a shared account already removed it.
        announce("That chat no longer exists");
        sessions.reload();
        return;
      }
      setRenaming({ id: session.id, draft, error: actionError(e, "Couldn't rename this chat. Try again.") });
    }
  };

  const startDelete = (session: ChatSession) => {
    setDeleteError(null);
    setDeleting(session);
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api(chatPath(deleting.id), { method: "DELETE" });
    } catch (e) {
      // Already gone (another tab or a shared account) is what the user asked for.
      if (!(e instanceof ApiError && e.status === 404)) {
        setDeleteError(actionError(e, "Couldn't delete this chat. Try again."));
        setDeleteBusy(false);
        return;
      }
    }
    const href = `/ask/c/${deleting.id}`;
    const rows = Array.from(navRef.current?.querySelectorAll<HTMLElement>("[data-chat-row]") ?? []);
    const at = rows.findIndex((r) => r.getAttribute("href") === href);
    afterDelete.current =
      rows[at + 1] ?? rows[at - 1] ?? document.querySelector<HTMLElement>("[data-new-chat]");
    deletedChats.add(deleting.id);
    setDeleting(null);
    setDeleteBusy(false);
    announce("Chat deleted");
    sessions.reload();
    if (pathname === href) router.replace("/ask");
  };

  const empty = visible.length === 0;

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
                <span className={cx("h-3 rounded bg-border motion-safe:animate-shimmer", w)} />
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
                if (renaming?.id === session.id) {
                  return (
                    <li key={session.id}>
                      <RenameInput
                        initial={renaming.draft}
                        error={renaming.error}
                        onSave={(draft) => void saveRename(session, draft)}
                        onDone={() => {
                          refocusRow.current = session.id;
                        }}
                        onCancel={() => setRenaming(null)}
                      />
                    </li>
                  );
                }
                return (
                  <li key={session.id} className="group/row relative">
                    <Link
                      href={href}
                      title={label}
                      data-chat-row=""
                      onClick={() => onNavigate?.()}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        ROW,
                        active ? ROW_ACTIVE : cx(ROW_IDLE, "group-hover/row:bg-panel-2"),
                        // Room for the "⋯" button whenever it shows, so it never covers the title.
                        !pending && "max-lg:pr-12 [@media(hover:none)]:pr-12",
                        !pending &&
                          (active ? "lg:pr-9" : "lg:group-hover/row:pr-9 lg:group-focus-within/row:pr-9"),
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {pending && (
                        <>
                          <RowSpinner />
                          <span className="sr-only">, saving</span>
                        </>
                      )}
                    </Link>
                    {/* A row still being sent has a request in flight; its menu appears once saved. */}
                    {!pending && (
                      <ChatRowMenu
                        id={session.id}
                        title={label}
                        active={active}
                        onRename={() => setRenaming({ id: session.id, draft: titleOf(session), error: null })}
                        onDelete={() => startDelete(session)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <DeleteChatDialog
        title={deleting ? titleOf(deleting) : null}
        busy={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (!deleteBusy) setDeleting(null);
        }}
        onConfirm={() => void confirmDelete()}
        fallbackFocus={() => afterDelete.current}
      />
    </nav>
  );
}

const RENAME_MAX_CHARS = 200; // SessionPatch.title in the API

/** §5.10 inline rename. Enter or leaving the box saves; Esc keeps the old title. */
function RenameInput({
  initial,
  error,
  onSave,
  onDone,
  onCancel,
}: {
  initial: string;
  error: string | null;
  onSave: (draft: string) => void;
  /** Enter or Esc, where focus should go back to the row. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  // Enter and Esc unmount the box, which can also fire blur: only the first ending counts.
  const ended = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const end = (action: () => void) => {
    if (ended.current) return;
    ended.current = true;
    action();
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        defaultValue={initial}
        maxLength={RENAME_MAX_CHARS}
        aria-label="Chat name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onBlur={(e) => end(() => onSave(e.currentTarget.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const value = e.currentTarget.value;
            end(() => {
              onDone();
              onSave(value);
            });
          } else if (e.key === "Escape") {
            // Cancel only the rename, not the drawer dialog around it.
            e.preventDefault();
            e.stopPropagation();
            end(() => {
              onDone();
              onCancel();
            });
          }
        }}
        // 16px below lg so iOS doesn't zoom the page on focus.
        className="h-11 w-full rounded-lg border border-accent bg-panel px-2.5 text-base text-text outline-none lg:h-9 lg:text-sm"
      />
      {error && (
        <p id={errorId} role="alert" className="px-2.5 pt-1 pb-1 text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** "⋯" on a Recent row (§5.10): shown on hover, focus-within, the active row and touch devices.
 *  The menu is a popover so the scrolling list can't clip it. The top layer also ignores the
 *  drawer's transform, which would otherwise offset a plain position:fixed menu. */
function ChatRowMenu({
  id,
  title,
  active,
  onRename,
  onDelete,
}: {
  id: string;
  title: string;
  active: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<"first" | "last">("first");
  const menuId = useId();
  const label = `Actions for ${title}`;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    menu.showPopover();
    const r = trigger.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const below = r.bottom + 4;
    const top = below + m.height > window.innerHeight - 8 ? Math.max(8, r.top - m.height - 4) : below;
    const left = Math.min(Math.max(8, r.right - m.width), window.innerWidth - m.width - 8);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (focusTarget.current === "last" ? items[items.length - 1] : items[0])?.focus();
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close();
    };
    // Only a scroll that moves the "⋯" matters: a streaming answer scrolls the thread constantly.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && triggerRef.current && e.target.contains(triggerRef.current)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const show = (target: "first" | "last") => {
    focusTarget.current = target;
    setOpen(true);
  };

  /** Focus goes to the "⋯" first: the delete dialog restores focus to whatever opened it. */
  const pick = (action: () => void) => {
    triggerRef.current?.focus();
    setOpen(false);
    action();
  };

  const itemClass = cx(
    ROW,
    "justify-start text-left outline-none hover:bg-panel-2 focus-visible:bg-panel-2",
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-chat-menu={id}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : show("first"))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show(e.key === "ArrowUp" ? "last" : "first");
          }
        }}
        className={cx(
          "absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-muted",
          "transition-[opacity,background-color,color] duration-150 hover:bg-border/60 hover:text-text",
          "aria-expanded:bg-border/60 aria-expanded:text-text aria-expanded:opacity-100",
          "lg:right-1 lg:size-7 lg:pointer-coarse:size-9",
          active
            ? "opacity-100"
            : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <DotsIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          popover="manual"
          aria-label={label}
          onKeyDown={(e) =>
            onMenuKeyDown(e, menuRef.current, () => {
              setOpen(false);
              triggerRef.current?.focus();
            }, () => setOpen(false))
          }
          className={cx(
            "fixed inset-auto m-0 w-44 rounded-xl border border-border bg-panel p-1 text-text shadow-elev-3",
            "transition-opacity duration-200 ease-[var(--ease-snappy)] starting:opacity-0",
          )}
        >
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick(onRename)} className={cx(itemClass, "text-text")}>
            Rename
          </button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick(onDelete)} className={cx(itemClass, "text-bad")}>
            Delete
          </button>
        </div>
      )}
    </>
  );
}

/** §5.10 delete confirmation: native modal <dialog>, Cancel focused. */
function DeleteChatDialog({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
  fallbackFocus,
}: {
  /** The chat to delete; null keeps the dialog closed. */
  title: string | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Where focus goes on close when the "⋯" that opened the dialog went with the deleted row. */
  fallbackFocus: () => HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const open = title !== null;
  // Keep the last title so the content doesn't blank out while the dialog closes.
  const [shown, setShown] = useState(title);
  if (title !== null && title !== shown) setShown(title);
  const refocus = useEffectEvent(() => {
    const active = document.activeElement;
    if (!active || active === document.body || dialogRef.current?.contains(active)) fallbackFocus()?.focus();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      // close() returns focus to the opener when it still exists.
      dialog.close();
      refocus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      // React bubbles these two through the tree, and the drawer's own <dialog> is an ancestor below
      // 1024px: without stopPropagation, closing this dialog would close the drawer too.
      onCancel={(e) => {
        e.stopPropagation();
        // Esc: keep the dialog while the request is in flight.
        if (busy) e.preventDefault();
      }}
      onClose={(e) => {
        e.stopPropagation();
        if (open) onCancel();
      }}
      className={cx(
        "m-auto w-[min(calc(100%-32px),420px)] rounded-2xl border border-border bg-panel p-6 text-text shadow-elev-3",
        "backdrop:bg-black/40 transition-opacity duration-200 ease-[var(--ease-snappy)] starting:opacity-0",
      )}
    >
      {shown !== null && (
        <>
          <h2 id={titleId} className="text-base font-semibold">
            Delete chat?
          </h2>
          <p id={descId} className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">
            This deletes &ldquo;{shown}&rdquo; and its answers. Your documents aren&apos;t affected.
          </p>
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button ref={cancelRef} type="button" onClick={onCancel} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onConfirm();
              }}
              className={cx(
                "inline-flex h-9 items-center justify-center rounded-lg border border-border-strong bg-panel px-4",
                "text-sm font-medium text-bad transition-colors duration-150 hover:bg-bad-soft pointer-coarse:h-11",
                "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
              )}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

// ---------- Menus: user chip and Recent rows (APG menu button) ----------

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

/** Arrow keys, Home/End, type-ahead, Space (items can be links), Esc and Tab for an open menu. */
function onMenuKeyDown(
  e: ReactKeyboardEvent<HTMLElement>,
  menu: HTMLElement | null,
  onEscape: () => void,
  onTab: () => void,
) {
  const items = menuItems(menu);
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
    case " ":
      e.preventDefault();
      items[i]?.click();
      break;
    case "Escape":
      // Close only the menu, not the drawer dialog around it.
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      break;
    case "Tab":
      // Let focus move on to the next control first, then drop the menu.
      window.setTimeout(onTab, 0);
      break;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
        order.find((item) => item.textContent?.trim().toLowerCase().startsWith(key))?.focus();
      }
  }
}

function UserMenu({ onNavigate }: NavigateProps) {
  const { me, persona, consoleHref } = useWorkspace();
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
          onKeyDown={(e) => onMenuKeyDown(e, menuRef.current, closeMenu, () => setOpen(false))}
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
              onClick={(e) => {
                // The drawer closes first: while it is modal the strip is inert, and closing it
                // later would send focus back to the button that opened the drawer.
                flushSync(() => {
                  setOpen(false);
                  onNavigate?.();
                });
                // §4.4: switch in place from the strip's menu. The link is only for when no strip
                // is showing, which is when the demo list failed to load.
                if (openPersonaMenu()) e.preventDefault();
              }}
              className={itemClass}
            >
              <Icon name="users" className="shrink-0 text-muted" />
              Switch persona
            </Link>
          )}
          {consoleHref && (
            <Link
              href={consoleHref}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className={itemClass}
            >
              <Icon name="settings" className="shrink-0 text-muted" />
              Admin console
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
