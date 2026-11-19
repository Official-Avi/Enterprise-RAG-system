"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/demo";
import { MeContext, useApi, useMe } from "@/lib/hooks";
import { pageName, PERMISSION_COPY } from "@/lib/permissionCopy";
import type { DemoInfo, Me } from "@/lib/types";
import { fetchDemoInfo } from "@/lib/workspace";
import { NoAccess } from "./Can";
import { DemoStrip } from "./DemoStrip";
import { Icon, type IconName } from "./icons";
import { Logo } from "./Logo";
import { Button, cx, ErrorState, iconButtonClass, Loading } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  permission?: string;
}

// Chat lives in the /ask workspace now (§7 #1); "/chat" redirects there in next.config.ts.
const NAV: { section: string; items: NavItem[] }[] = [
  { section: "", items: [{ href: "/overview", label: "Overview", icon: "overview", permission: "ops:read" }] },
  {
    section: "Knowledge base",
    items: [
      { href: "/collections", label: "Collections", icon: "collections", permission: "collection:read" },
      { href: "/documents", label: "Documents", icon: "documents", permission: "collection:read" },
    ],
  },
  {
    section: "AI quality",
    items: [
      { href: "/inspector", label: "Retrieval inspector", icon: "inspector", permission: "retrieval:inspect" },
      { href: "/evaluation", label: "Evaluation", icon: "evaluation", permission: "eval:read" },
    ],
  },
  {
    section: "Operations",
    items: [
      { href: "/jobs", label: "Job queue", icon: "jobs", permission: "job:read" },
      { href: "/workers", label: "Workers", icon: "workers", permission: "ops:read" },
      { href: "/models", label: "Model serving", icon: "models", permission: "model:read" },
    ],
  },
  {
    section: "Infrastructure",
    items: [{ href: "/infrastructure", label: "Racks & workloads", icon: "racks", permission: "infra:read" }],
  },
  {
    section: "Administration",
    items: [
      { href: "/admin/users", label: "Users & roles", icon: "users", permission: "user:read" },
      { href: "/admin/audit", label: "Audit log", icon: "audit", permission: "audit:read" },
      { href: "/admin/settings", label: "Settings", icon: "settings", permission: "settings:manage" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ALL_ITEMS = NAV.flatMap((g) => g.items);

/** The most specific nav item that owns `pathname`. */
function navItemFor(pathname: string): NavItem | undefined {
  return ALL_ITEMS.filter((i) => isActive(pathname, i.href)).sort((a, b) => b.href.length - a.href.length)[0];
}

/** Whether these permissions can open the console page at `path` (true for non-console paths,
 *  which have their own rules). For ?next= checks; the API still enforces every page. */
export function canOpenConsoleRoute(path: string, permissions: string[]): boolean {
  const required = navItemFor(path.split(/[?#]/, 1)[0])?.permission;
  return !required || permissions.includes(required);
}

/** Where a user goes after sign-in: the /ask workspace if their role can chat,
 *  otherwise the first console page they can use (auditors land on Overview). */
export function homePath(permissions: string[]): string {
  if (permissions.includes("chat:use")) return "/ask";
  return ALL_ITEMS.find((i) => !i.permission || permissions.includes(i.permission))?.href ?? "/ask";
}

async function logout() {
  // noAuthRedirect: an already-expired session must not start a competing /login redirect.
  await api("/auth/logout", { method: "POST", noAuthRedirect: true }).catch(() => undefined);
  // Full reload on purpose: drops all client-side state after sign-out (§7 #6: back to /).
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

/** The console navigation, shared by the desktop sidebar and the mobile drawer.
 *  `touch` gives every row a 44px target (§10). */
function NavList({
  permissions,
  pathname,
  touch,
  onNavigate,
}: {
  permissions: string[];
  pathname: string;
  touch?: boolean;
  onNavigate?: () => void;
}) {
  // 36px rows on desktop, 44px in the touch drawer (§10). Colour is the only thing that moves.
  const base = cx(
    "flex items-center gap-2.5 rounded-md px-2 text-sm transition-colors duration-(--dur-micro) ease-out",
    "focus-visible:outline-offset-[-2px]",
  );
  const row = cx(base, touch ? "min-h-11" : "h-9");
  return (
    <>
      {permissions.includes("chat:use") && (
        <div className="mb-4 border-b border-border pb-3">
          <Link
            href="/ask"
            onClick={onNavigate}
            className={cx(row, "font-medium text-text hover:bg-panel-3 active:bg-panel-3")}
          >
            <Icon name="arrowLeft" />
            Back to Ask
          </Link>
        </div>
      )}
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || permissions.includes(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.section || "top"} className="mb-4">
            {group.section && <div className="px-2 pb-1.5 text-xs font-medium text-muted">{group.section}</div>}
            <ul className="space-y-px">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        row,
                        active
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-text-2 hover:bg-panel-3 hover:text-text active:bg-panel-3",
                      )}
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function UserBlock({ user, touch }: { user: Me; touch?: boolean }) {
  return (
    <div className="border-t border-border px-3 py-3">
      <div className="px-2">
        <div className="truncate text-sm font-medium text-text">{user.display_name}</div>
        <div className="truncate font-mono text-xs text-muted">{user.email}</div>
        <div className="mt-0.5 text-xs text-text-2">{ROLE_LABEL[user.role] ?? user.role}</div>
      </div>
      <Button variant="ghost" className={cx("mt-2 w-full justify-start px-2", touch && "min-h-11")} onClick={logout}>
        <Icon name="logout" /> Sign out
      </Button>
    </div>
  );
}

const DRAWER_ID = "console-nav-drawer";

/** Mobile navigation (below md): a native modal <dialog> that slides in from the left. */
function NavDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // A modal left open while the window widens would keep the page inert behind it.
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = (ev: MediaQueryListEvent) => {
      if (ev.matches) onClose();
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      id={DRAWER_ID}
      aria-label="Console navigation"
      onClose={onClose}
      onClick={(ev) => {
        // Clicks on the backdrop target the dialog itself; the panel fills the dialog box.
        if (ev.target === ev.currentTarget) onClose();
      }}
      className={cx(
        "fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-[min(85vw,320px)] max-w-none",
        "border-r border-border bg-panel-2 p-0 text-text shadow-elev-3",
        "backdrop:bg-[color-mix(in_oklab,var(--graphite)_55%,transparent)]",
        "-translate-x-full open:translate-x-0 starting:open:-translate-x-full",
        "transition-[translate,overlay,display] transition-discrete duration-(--dur-short) ease-(--ease-drawer)",
        "open:duration-(--dur-long)",
      )}
    >
      <div className="flex h-full flex-col">{children}</div>
    </dialog>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useApi<Me>("/auth/me");
  const pathname = usePathname();
  const router = useRouter();
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [switchedTo, setSwitchedTo] = useState<Me | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    let cancelled = false;
    fetchDemoInfo()
      .then((info) => {
        if (!cancelled) setDemo(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (me.loading) return <Loading label="Checking your session…" />;
  if (me.error || !me.data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={me.error} onRetry={me.reload} />
      </div>
    );
  }
  // After a persona switch, use the new identity at once instead of waiting for the reload.
  const user = switchedTo && switchedTo.user_id !== me.data.user_id ? switchedTo : me.data;
  const tenant = user.memberships.find((m) => m.tenant_id === user.tenant_id);
  const home = homePath(user.permissions);

  const onSwitched = (next: Me) => {
    setSwitchedTo(next);
    me.reload();
    router.replace(homePath(next.permissions));
    router.refresh();
  };

  // Route-level gate: pages the role cannot use are not rendered at all, so their data
  // requests never run. The API enforces the same rules independently.
  const required = navItemFor(pathname)?.permission;
  const allowed = !required || user.permissions.includes(required);

  return (
    <MeContext.Provider value={user}>
      <a
        href="#main"
        className={cx(
          "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[var(--z-tooltip)]",
          "focus:rounded-md focus:border focus:border-border-2 focus:bg-panel focus:px-3 focus:py-2 focus:text-sm",
          "focus:font-medium focus:text-text focus:shadow-elev-3",
        )}
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen flex-col bg-bg">
        <DemoStrip me={user} demo={demo} onSwitched={onSwitched} />
        <div className="flex flex-1">
          <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-panel-2 md:flex">
            <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
              <Link href={home} className="flex min-w-0 items-center gap-2.5 rounded-md">
                <Logo size={30} />
                <span className="min-w-0">
                  <span className="block font-display text-base leading-tight font-semibold text-text">RackFlow AI</span>
                  <span className="block truncate text-xs text-muted">{tenant?.tenant_name ?? "Workspace"}</span>
                </span>
              </Link>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
              <NavList permissions={user.permissions} pathname={pathname} />
            </nav>
            <UserBlock user={user} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-1 border-b border-border bg-panel-2 px-2 py-1 md:hidden [@media(max-height:500px)]:py-0">
              <button
                type="button"
                aria-label="Open navigation"
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
                aria-controls={DRAWER_ID}
                onClick={() => setDrawerOpen(true)}
                className={cx(iconButtonClass, "size-11 hover:bg-panel-3")}
              >
                <Icon name="menu" width={20} height={20} />
              </button>
              <Link href={home} className="flex min-h-11 items-center gap-2 rounded-md px-1 font-display font-semibold">
                <Logo size={26} />
                RackFlow AI
              </Link>
              <Button variant="ghost" className="ml-auto min-h-11" onClick={logout}>
                Sign out
              </Button>
            </header>
            <main id="main" key={user.user_id} className="mx-auto w-full max-w-7xl min-w-0 flex-1 p-4 md:p-6 lg:px-10 lg:py-8">
              {allowed ? children : <NoAccess page={pageName(pathname)} permission={required} />}
            </main>
          </div>
        </div>
      </div>
      <NavDrawer open={drawerOpen} onClose={closeDrawer}>
        <div className="flex h-14 items-center gap-2 border-b border-border pr-2 pl-4">
          <span className="flex items-center gap-2 font-display font-semibold">
            <Logo size={26} />
            RackFlow AI
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawer}
            className={cx(iconButtonClass, "ml-auto size-11 hover:bg-panel-3")}
          >
            <Icon name="close" width={20} height={20} />
          </button>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
          <NavList permissions={user.permissions} pathname={pathname} touch onNavigate={closeDrawer} />
        </nav>
        <UserBlock user={user} touch />
      </NavDrawer>
    </MeContext.Provider>
  );
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const me = useMe();
  const pathname = usePathname();
  if (!me.permissions.includes(permission)) {
    const name = pageName(pathname);
    return <NoAccess page={name === "This page" ? (PERMISSION_COPY[permission]?.page ?? name) : name} permission={permission} />;
  }
  return <>{children}</>;
}
