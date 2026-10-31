"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { DemoStrip } from "@/components/DemoStrip";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { homePath } from "@/components/Shell";
import { cx, ErrorState } from "@/components/ui";
import { announce } from "@/lib/announce";
import { canSeeConsole, personaFor } from "@/lib/demo";
import { MeContext, useApi } from "@/lib/hooks";
import type { ChatSession, DemoInfo, Me } from "@/lib/types";
import { fetchDemoInfo } from "@/lib/workspace";
import { ChatSidebar } from "./ChatSidebar";
import { DropOverlay } from "./DropOverlay";
import type { WorkspaceApi } from "./types";
import { UploadsProvider } from "./UploadsProvider";
import { WorkspaceContext } from "./WorkspaceContext";

// §5.10: fetched once here; 200 is also the API's cap.
const SESSIONS_PATH = "/chat/sessions?limit=200";
const DESKTOP_QUERY = "(min-width: 1024px)";

/** Workspace frame (§5.1–5.2): loads /auth/me (redirects to /login on 401), provides
 *  WorkspaceContext + UploadsProvider, demo strip, sidebar (persistent >=1024px, drawer below),
 *  slim mobile header, DropOverlay, and <main id="main">. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const meQ = useApi<Me>("/auth/me");
  const router = useRouter();
  const pathname = usePathname();
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  // The user returned by a persona switch, shown until the /auth/me refetch lands.
  const [switched, setSwitched] = useState<{ me: Me; at: number } | null>(null);
  const showSkeleton = useDelay(300);
  useVisualViewport();

  useEffect(() => {
    let cancelled = false;
    // Demo info only decorates the UI (strip, persona), so a failure is not an error state.
    fetchDemoInfo().then(
      (d) => {
        if (!cancelled) setDemo(d);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const user = switched && (meQ.updatedAt ?? 0) < switched.at ? switched.me : meQ.data;

  if (!user) {
    // A 401 is already redirecting to /login, so keep the skeleton instead of flashing an error.
    if (meQ.error && meQ.error.status !== 401) {
      return (
        <div className="grid h-[var(--app-h,100dvh)] place-items-center bg-bg px-4">
          <div className="w-full max-w-md">
            <ErrorState error={meQ.error} onRetry={meQ.reload} />
          </div>
        </div>
      );
    }
    return showSkeleton ? <ShellSkeleton /> : <div aria-busy="true" className="h-[var(--app-h,100dvh)] bg-bg" />;
  }

  const canChat = user.permissions.includes("chat:use");
  const onSwitched = (newMe: Me) => {
    setSwitched({ me: newMe, at: Date.now() });
    meQ.reload();
    router.replace(homePath(newMe.permissions));
  };

  return (
    <MeContext.Provider value={user}>
      {canChat && pathname.startsWith("/ask") && <SkipLink target="composer-input">Skip to question box</SkipLink>}
      <SkipLink target="main">Skip to main content</SkipLink>
      <div className="flex h-[var(--app-h,100dvh)] flex-col overflow-hidden bg-bg text-text">
        <DemoStrip me={user} demo={demo} onSwitched={onSwitched} />
        {/* Keyed by user so a persona switch drops the previous user's chats, uploads and drafts. */}
        <WorkspaceFrame key={user.user_id} me={user} demo={demo} reloadMe={meQ.reload}>
          {children}
        </WorkspaceFrame>
      </div>
    </MeContext.Provider>
  );
}

function WorkspaceFrame({
  me,
  demo,
  reloadMe,
  children,
}: {
  me: Me;
  demo: DemoInfo | null;
  reloadMe: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const drawerId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Set when the focused toggle is about to unmount, so focus moves to its counterpart.
  const refocusToggle = useRef(false);
  // The drawer remembers the path it was opened on, so any navigation closes it.
  const [drawerOpenAt, setDrawerOpenAt] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ChatSession[]>([]);

  const perms = me.permissions;
  const canChat = perms.includes("chat:use");
  const canUpload = perms.includes("document:upload");
  const sessionsQ = useApi<{ items: ChatSession[] }>(canChat ? SESSIONS_PATH : null);

  const drawerOpen = !isDesktop && drawerOpenAt !== null && drawerOpenAt === pathname;
  const sidebarShown = isDesktop && !collapsed;
  // Esc, the backdrop, the Close button and every sidebar link close the drawer.
  const closeDrawer = useCallback(() => setDrawerOpenAt(null), []);

  const fetched = canChat ? (sessionsQ.data?.items ?? []) : [];
  const fetchedIds = new Set(fetched.map((s) => s.id));
  const unreconciled = optimistic.filter((s) => !fetchedIds.has(s.id));
  const sessionItems = [...unreconciled, ...fetched];
  const pendingIds = new Set(unreconciled.map((s) => s.id));

  /** Desktop collapse/expand from a button: that button unmounts, so its counterpart takes focus. */
  const setCollapsedFromButton = (next: boolean) => {
    refocusToggle.current = focusInSidebarRegion();
    setCollapsed(next);
  };

  useEffect(() => {
    if (!refocusToggle.current) return;
    refocusToggle.current = false;
    document.querySelector<HTMLElement>("[data-sidebar-toggle]")?.focus();
  }, [collapsed]);

  const openSidebar = () => {
    if (isDesktop) setCollapsed(false);
    else setDrawerOpenAt(pathname);
  };

  useEffect(() => {
    // The only bindings for Ctrl+Shift+O (new chat, also from a collapsed or closed sidebar) and
    // Ctrl+Shift+S (collapse/expand; the drawer below 1024px). e.code covers non-Latin layouts.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const key = e.code === "KeyO" ? "o" : e.code === "KeyS" ? "s" : e.key.toLowerCase();
      if (key === "o" && canChat) {
        e.preventDefault();
        setDrawerOpenAt(null);
        router.push("/ask");
      } else if (key === "s") {
        e.preventDefault();
        if (isDesktop) {
          refocusToggle.current = focusInSidebarRegion();
          setCollapsed((c) => !c);
        } else setDrawerOpenAt((at) => (at === pathname ? null : pathname));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canChat, isDesktop, pathname, router]);

  const value: WorkspaceApi = {
    me,
    reloadMe,
    canChat,
    canUpload,
    consoleHref: consoleHrefFor(perms),
    demo,
    persona: personaFor(me, demo),
    sessions: {
      items: sessionItems,
      loading: canChat && sessionsQ.loading,
      error: canChat ? sessionsQ.error : undefined,
      reload: sessionsQ.reload,
    },
    addOptimisticSession: (session) =>
      setOptimistic((list) => [session, ...list.filter((s) => s.id !== session.id)]),
    openSidebar,
    announce,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      <UploadsProvider canUpload={canUpload}>
        <div className="flex min-h-0 flex-1">
          {sidebarShown && (
            <div
              data-sidebar-region=""
              className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-border bg-bg"
            >
              <ChatSidebar onCollapse={() => setCollapsedFromButton(true)} pendingIds={pendingIds} />
            </div>
          )}
          {!isDesktop && (
            <SidebarDrawer id={drawerId} open={drawerOpen} onClose={closeDrawer} pendingIds={pendingIds} />
          )}
          <div className="flex min-w-0 flex-1 flex-col bg-panel">
            {!sidebarShown && (
              <WorkspaceHeader
                mainRef={mainRef}
                canChat={canChat}
                homeHref={homePath(perms)}
                menu={
                  isDesktop
                    ? { label: "Show sidebar", onClick: () => setCollapsedFromButton(false) }
                    : { label: "Open sidebar", onClick: openSidebar, expanded: drawerOpen, controls: drawerId }
                }
              />
            )}
            <main
              id="main"
              ref={mainRef}
              tabIndex={-1}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
            >
              {children}
            </main>
          </div>
        </div>
        <DropOverlay />
      </UploadsProvider>
    </WorkspaceContext.Provider>
  );
}

/** True when focus sits in a part of the frame (sidebar or slim header) that a toggle unmounts. */
function focusInSidebarRegion(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest("[data-sidebar-region]") !== null;
}

/** §2.3: the first console page the role can open, or null for roles without console access. */
function consoleHrefFor(perms: string[]): string | null {
  if (!canSeeConsole(perms)) return null;
  if (perms.includes("ops:read")) return "/overview";
  if (perms.includes("audit:read")) return "/admin/audit";
  if (perms.includes("user:read")) return "/admin/users";
  return "/admin/settings";
}

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-md text-text transition-colors duration-150 " +
  "hover:bg-panel-2 lg:size-10";

function WorkspaceHeader({
  mainRef,
  canChat,
  homeHref,
  menu,
}: {
  mainRef: RefObject<HTMLElement | null>;
  canChat: boolean;
  homeHref: string;
  menu: { label: string; onClick: () => void; expanded?: boolean; controls?: string };
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // Scroll does not bubble, but a capture listener on <main> sees the page's own message list.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.scrollHeight > t.clientHeight) setScrolled(t.scrollTop > 0);
    };
    main.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => main.removeEventListener("scroll", onScroll, { capture: true });
  }, [mainRef]);

  return (
    <header
      data-sidebar-region=""
      className={cx(
        "flex h-14 shrink-0 items-center gap-1 border-b px-2 transition-colors duration-150",
        "[@media(max-height:500px)]:h-11",
        scrolled ? "border-border bg-panel/85 backdrop-blur" : "border-transparent",
      )}
    >
      <button
        type="button"
        onClick={menu.onClick}
        data-sidebar-toggle=""
        title={`${menu.label} (Ctrl+Shift+S)`}
        aria-keyshortcuts="Control+Shift+S"
        aria-label={menu.label}
        aria-haspopup={menu.controls ? "dialog" : undefined}
        aria-expanded={menu.controls ? Boolean(menu.expanded) : undefined}
        aria-controls={menu.controls}
        className={iconButton}
      >
        <Icon name="menu" width={20} height={20} />
      </button>
      {canChat && (
        <Link href="/ask" aria-label="New chat" title="New chat (Ctrl+Shift+O)" className={iconButton}>
          <PencilIcon />
        </Link>
      )}
      <Link
        href={homeHref}
        className="ml-1 flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 text-[15px] font-semibold"
      >
        <Logo size={24} />
        <span className="truncate">RackFlow AI</span>
      </Link>
    </header>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** Below 1024px: the sidebar as a native modal <dialog> sliding in from the left (§5.1, §9 #10).
 *  Esc, the backdrop, the visible Close button and any navigation close it. */
function SidebarDrawer({
  id,
  open,
  onClose,
  pendingIds,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  pendingIds: ReadonlySet<string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      id={id}
      aria-label="Sidebar"
      onClose={onClose}
      onClick={(e) => {
        // The content wrapper ignores pointer events, so clicks beside the panel land here.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx(
        "group fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-text",
        "transition-[display,overlay] transition-discrete duration-200",
        "backdrop:bg-transparent backdrop:transition-colors backdrop:duration-200",
        "open:backdrop:bg-black/40 starting:open:backdrop:bg-transparent",
      )}
    >
      <div className="pointer-events-none flex h-full">
        <div
          className={cx(
            "pointer-events-auto flex h-full w-[min(85vw,320px)] shrink-0 flex-col overflow-y-auto",
            "border-r border-border bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "-translate-x-full transition-[translate] duration-200 ease-[var(--ease-drawer)]",
            "group-open:translate-x-0 group-open:duration-[260ms] starting:group-open:-translate-x-full",
          )}
        >
          <ChatSidebar onNavigate={onClose} pendingIds={pendingIds} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sidebar"
          className={cx(
            "pointer-events-auto m-1 grid size-11 shrink-0 place-items-center rounded-full bg-panel text-text",
            "shadow-elev-3 transition-opacity duration-200 opacity-0 group-open:opacity-100",
            "starting:group-open:opacity-0",
          )}
        >
          <Icon name="close" width={20} height={20} />
        </button>
      </div>
    </dialog>
  );
}

/** §9 #6: visually hidden until focused; moves focus to the target (falls back to <main>). */
function SkipLink({ target, children }: { target: string; children: ReactNode }) {
  return (
    <a
      href={`#${target}`}
      onClick={(e) => {
        const el = document.getElementById(target) ?? document.getElementById("main");
        if (!el) return;
        e.preventDefault();
        el.focus();
      }}
      className={cx(
        "sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100]",
        "focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-medium",
        "focus:text-text focus:shadow-elev-3",
      )}
    >
      {children}
    </a>
  );
}

function ShellSkeleton() {
  const block = "rounded-md bg-border";
  return (
    <div aria-busy="true" className="flex h-[var(--app-h,100dvh)] overflow-hidden bg-bg">
      <div role="status" className="sr-only">
        Loading your workspace…
      </div>
      <div
        aria-hidden="true"
        className="hidden w-[260px] shrink-0 flex-col gap-3 border-r border-border p-3 motion-safe:animate-pulse lg:flex"
      >
        <div className={cx(block, "h-8 w-36")} />
        <div className="h-10 rounded-full bg-border" />
        <div className={cx(block, "h-9")} />
        <div className="mt-4 flex flex-col gap-2">
          {["w-4/5", "w-3/5", "w-2/3", "w-1/2"].map((w) => (
            <div key={w} className={cx(block, "h-6", w)} />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col bg-panel motion-safe:animate-pulse">
        <div className="flex h-14 items-center gap-2 px-2 lg:hidden">
          <div className="size-11 rounded-md bg-panel-2" />
          <div className="h-6 w-32 rounded-md bg-panel-2" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 md:px-6">
          <div className="h-9 w-80 max-w-full rounded-md bg-panel-2" />
          <div className="h-[104px] w-full max-w-[768px] rounded-3xl bg-panel-2" />
        </div>
      </div>
    </div>
  );
}

/** True after `ms` have passed since mount (avoids a skeleton flash on fast loads). */
function useDelay(ms: number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setPast(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return past;
}

// Module-level so useSyncExternalStore keeps one subscription instead of resubscribing per render.
function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** >= 1024px: persistent sidebar. The frame only renders after /auth/me loads on the client,
 *  so the server snapshot is never shown. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/** §5.1: track the visual viewport in --app-h so the composer stays above the iOS keyboard.
 *  height × scale ignores pinch-zoom, which shrinks the visual viewport without a keyboard. */
function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--app-h", `${Math.round(vv.height * vv.scale)}px`);
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      root.style.removeProperty("--app-h");
    };
  }, []);
}
