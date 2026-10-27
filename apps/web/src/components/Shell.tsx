"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import { MeContext, useApi, useMe } from "@/lib/hooks";
import type { Me } from "@/lib/types";
import { Icon, type IconName } from "./icons";
import { Logo } from "./Logo";
import { Button, cx, ErrorState, Loading } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  permission?: string;
}

const NAV: { section: string; items: NavItem[] }[] = [
  { section: "", items: [{ href: "/", label: "Overview", icon: "overview", permission: "ops:read" }] },
  {
    section: "Knowledge Base",
    items: [
      { href: "/collections", label: "Collections", icon: "collections", permission: "collection:read" },
      { href: "/documents", label: "Documents", icon: "documents", permission: "collection:read" },
    ],
  },
  {
    section: "AI Playground",
    items: [
      { href: "/chat", label: "Chat", icon: "chat", permission: "chat:use" },
      { href: "/inspector", label: "Retrieval inspector", icon: "inspector", permission: "retrieval:inspect" },
    ],
  },
  {
    section: "Operations",
    items: [
      { href: "/jobs", label: "Job queue", icon: "jobs", permission: "job:read" },
      { href: "/workers", label: "Workers", icon: "workers", permission: "ops:read" },
      { href: "/models", label: "Model serving", icon: "models", permission: "model:read" },
      { href: "/evaluation", label: "Evaluation", icon: "evaluation", permission: "eval:read" },
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

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Org admin",
  operator: "Operator",
  engineer: "Engineer",
  auditor: "Auditor",
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const ALL_ITEMS = NAV.flatMap((g) => g.items);

/** Permission required by the most specific nav item that owns `pathname`. */
function requiredPermission(pathname: string): string | undefined {
  const owners = ALL_ITEMS.filter((i) => isActive(pathname, i.href));
  owners.sort((a, b) => b.href.length - a.href.length);
  return owners[0]?.permission;
}

function landingPage(permissions: string[]): string {
  return ALL_ITEMS.find((i) => !i.permission || permissions.includes(i.permission))?.href ?? "/";
}

function NoAccess() {
  return (
    <div role="alert" className="rounded-lg border border-border bg-panel px-4 py-6 text-center">
      <p className="font-medium">You don&apos;t have access to this page.</p>
      <p className="mt-1 text-sm text-muted">Ask an organization admin if you need it.</p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useApi<Me>("/auth/me");
  const pathname = usePathname();
  const router = useRouter();
  const permissions = me.data?.permissions;
  const mustRedirect = pathname === "/" && !!permissions && !permissions.includes("ops:read");

  useEffect(() => {
    // Send users whose role cannot see the Overview to the first page they can use.
    if (mustRedirect && permissions) router.replace(landingPage(permissions));
  }, [mustRedirect, permissions, router]);

  if (me.loading) return <Loading label="Checking your session…" />;
  if (me.error || !me.data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={me.error} onRetry={me.reload} />
      </div>
    );
  }
  const user = me.data;
  const tenant = user.memberships.find((m) => m.tenant_id === user.tenant_id);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    // Full reload on purpose: drops all client-side state after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  return (
    <MeContext.Provider value={user}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-panel md:flex">
          <div className="border-b border-border px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <Logo size={34} />
              <div>
                <div className="text-sm font-semibold leading-tight">RackFlow AI</div>
                <div className="text-xs text-muted">{tenant?.tenant_name ?? "Workspace"}</div>
              </div>
            </div>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
            {NAV.map((group) => {
              const items = group.items.filter(
                (i) => !i.permission || user.permissions.includes(i.permission),
              );
              if (!items.length) return null;
              return (
                <div key={group.section || "top"} className="mb-3">
                  {group.section && (
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {group.section}
                    </div>
                  )}
                  <ul>
                    {items.map((item) => {
                      const active = isActive(pathname, item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={cx(
                              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                              active
                                ? "bg-accent-soft font-medium text-accent"
                                : "text-muted hover:bg-panel-2 hover:text-text",
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
          </nav>
          <div className="border-t border-border px-3 py-3">
            <div className="truncate text-sm font-medium">{user.display_name}</div>
            <div className="truncate text-xs text-muted">
              {user.email} · {ROLE_LABEL[user.role] ?? user.role}
            </div>
            <Button variant="ghost" className="mt-2 w-full justify-start" onClick={logout}>
              <Icon name="logout" /> Sign out
            </Button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-2 md:hidden">
            <span className="flex items-center gap-2 font-semibold"><Logo size={26} />RackFlow AI</span>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </header>
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
            {mustRedirect ? (
              <Loading label="Opening your workspace…" />
            ) : (() => {
              // Route-level gate: pages the role cannot use are not rendered at all, so their
              // data requests never run. The API enforces the same rules independently.
              const required = requiredPermission(pathname);
              return !required || user.permissions.includes(required) ? children : <NoAccess />;
            })()}
          </main>
        </div>
      </div>
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
  if (!me.permissions.includes(permission)) {
    return (
      <div role="alert" className="rounded-lg border border-border bg-panel px-4 py-6 text-center">
        <p className="font-medium">You don&apos;t have access to this page.</p>
        <p className="mt-1 text-sm text-muted">Ask an organization admin if you need it.</p>
      </div>
    );
  }
  return <>{children}</>;
}
