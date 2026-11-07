import type { DemoInfo, DemoPersona, Me } from "./types";

/** The demo persona this user is signed in as (FE detection until /auth/me carries is_demo). */
export function personaFor(me: Me | null, demo: DemoInfo | null): DemoPersona | null {
  if (!me || !demo?.enabled) return null;
  return demo.personas.find((p) => p.email.toLowerCase() === me.email.toLowerCase()) ?? null;
}

const CONSOLE_PERMISSIONS = ["ops:read", "audit:read", "user:read", "settings:manage"];

/** §2.3: only roles with console permissions see the Admin console link. */
export function canSeeConsole(permissions: string[]): boolean {
  return CONSOLE_PERMISSIONS.some((p) => permissions.includes(p));
}

/** A same-site relative path from ?next=, or null (no open redirects). Browsers read "/\host" and
 *  "/<tab>/host" as "//host", so the parsed origin is checked as well as the prefix. Dot segments
 *  normalise too: "/.//host" stays same-origin with the pathname "//host", which is a different
 *  site once returned as a path, so the normalised result is what gets validated. Browser only. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  try {
    const { origin } = window.location;
    const url = new URL(next, origin);
    if (url.origin !== origin || url.pathname.startsWith("//") || url.pathname.startsWith("/login")) return null;
    const path = url.pathname + url.search + url.hash;
    return new URL(path, origin).origin === origin ? path : null;
  } catch {
    return null;
  }
}

/** Whether these permissions can use the workspace page at `path`; the API still enforces them. */
export function canOpen(path: string, permissions: string[]): boolean {
  const has = (p: string) => permissions.includes(p);
  const pathname = path.split(/[?#]/, 1)[0];
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under("/ask") || under("/chat")) return has("chat:use");
  if (under("/library")) return has("collection:read") && (has("chat:use") || has("document:upload"));
  return true;
}

/** §4.2: after sign-in, go to a safe ?next= this user can open, else `home` (homePath(permissions)). */
export function destination(next: string | null, permissions: string[], home: string): string {
  const safe = safeNext(next);
  return safe && canOpen(safe, permissions) ? safe : home;
}

export const ROLE_LABEL: Record<string, string> = {
  org_admin: "Admin",
  operator: "Operator",
  engineer: "Engineer",
  auditor: "Auditor",
};
