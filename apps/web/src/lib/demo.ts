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

export const ROLE_LABEL: Record<string, string> = {
  org_admin: "Admin",
  operator: "Operator",
  engineer: "Engineer",
  auditor: "Auditor",
};
