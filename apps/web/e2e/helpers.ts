import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SHOTS = join(__dirname, "..", "test-results", "screenshots");

// ---------- personas (backend auth/demo.py, seeded by `rackflow-admin seed-demo`) ----------

/** In API order, which is also the order of the landing-page cards (§3.3). */
export const PERSONA_KEYS = ["engineer", "operator", "admin", "auditor"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export interface Persona {
  title: string;
  email: string;
  /** Where homePath() sends the role after any sign-in (§2.2). */
  home: RegExp;
  canChat: boolean;
  canUpload: boolean;
  /** §2.3: the role has ops:read, audit:read, user:read or settings:manage. */
  seesAdminConsole: boolean;
}

export const PERSONAS: Record<PersonaKey, Persona> = {
  engineer: {
    title: "Engineer",
    email: "engineer@acme.example.com",
    home: /\/ask$/,
    canChat: true,
    canUpload: true,
    seesAdminConsole: false,
  },
  operator: {
    title: "Operator",
    email: "operator@acme.example.com",
    home: /\/ask$/,
    canChat: true,
    canUpload: false,
    seesAdminConsole: true,
  },
  admin: {
    title: "Admin",
    email: "admin@acme.example.com",
    home: /\/ask$/,
    canChat: true,
    canUpload: true,
    seesAdminConsole: true,
  },
  auditor: {
    title: "Auditor",
    email: "auditor@acme.example.com",
    home: /\/overview$/,
    canChat: false,
    canUpload: false,
    seesAdminConsole: true,
  },
};

/** Saved session per persona, written once by auth.setup.ts (git-ignored). Reusing it keeps the
 *  suite under the sign-in limits: 10 password attempts a minute per IP and email, 30 one-click
 *  demo sign-ins a minute per IP (the Next proxy doesn't forward client IPs, so the browser and
 *  every test share one IP). */
export const authFile = (key: PersonaKey) => join(__dirname, ".auth", `${key}.json`);

// ---------- sign-in ----------

const PASSWORD_FILE = join(__dirname, "..", "..", "..", ".data", "demo-password.txt");

export function demoPassword(): string {
  if (process.env.E2E_PASSWORD) return process.env.E2E_PASSWORD;
  return readFileSync(PASSWORD_FILE, "utf8").trim();
}

/** The demo password when it is known on this machine, else null (for "never shown" checks). */
export function knownDemoPassword(): string | null {
  if (process.env.E2E_PASSWORD) return process.env.E2E_PASSWORD;
  if (!existsSync(PASSWORD_FILE)) return null;
  return readFileSync(PASSWORD_FILE, "utf8").trim() || null;
}

export interface DemoInfo {
  enabled: boolean;
  personas: { key: string; title: string; display_name: string; email: string }[];
}

/** GET /auth/demo (public). Treats any failure as "demo mode off". */
export async function demoInfo(request: APIRequestContext): Promise<DemoInfo> {
  const res = await request.get("/api/v1/auth/demo").catch(() => null);
  if (!res?.ok()) return { enabled: false, personas: [] };
  return (await res.json()) as DemoInfo;
}

/** One-click demo sign-in through the persona cards (§4.1): the landing grid, or the compact
 *  rows on /login (§4.2). Waits until the role's home page (§2.2) has rendered. */
export async function loginAsPersona(
  page: Page,
  key: PersonaKey,
  { via = "landing" }: { via?: "landing" | "login" } = {},
): Promise<void> {
  const p = PERSONAS[key];
  await page.goto(via === "landing" ? "/#demo" : "/login");
  // Landing cards are named by their CTA; compact rows by "{Title} {summary}".
  const card =
    via === "landing"
      ? page.locator("#demo").getByRole("button", { name: `Continue as ${p.title}`, exact: true })
      : page
          .getByRole("region", { name: "Use a demo account" })
          .getByRole("button", { name: new RegExp(`^${p.title}\\b`) });
  await expect(card, `the ${p.title} demo card (is DEMO_MODE on and the persona seeded?)`).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(p.home);
  await expect(page.locator("main#main")).toBeVisible();
}

/** Fallback: email and password, with the password from E2E_PASSWORD or .data/demo-password.txt. */
export async function loginWithPassword(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  // exact: the show toggle is labelled "Show password".
  await page.getByLabel("Password", { exact: true }).fill(demoPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  await expect(page.locator("main#main")).toBeVisible();
}

/** Demo card when the server offers that persona, else the password form. */
export async function signIn(page: Page, key: PersonaKey): Promise<void> {
  const info = await demoInfo(page.request);
  if (info.enabled && info.personas.some((p) => p.key === key)) await loginAsPersona(page, key);
  else await loginWithPassword(page, PERSONAS[key].email);
}

// ---------- server state ----------

const SEARCH_CHECKS = ["database", "vector_store", "vector_collection", "embeddings"] as const;

/** GET /health/ready (routers/health.py): `{status, checks:{database, vector_store,
 *  vector_collection, embeddings}}`, 503 when any is false. Uploads only become Ready, and
 *  questions only get answers, when all four pass. `reason` is ready to use with test.skip(). */
export async function searchHealth(request: APIRequestContext): Promise<{ ok: boolean; reason: string }> {
  const res = await request.get("/api/v1/health/ready", { timeout: 30_000 }).catch(() => null);
  if (!res) return { ok: false, reason: "The API readiness check (/api/v1/health/ready) could not be reached" };
  const body = (await res.json().catch(() => null)) as { checks?: Record<string, boolean> } | null;
  const checks = body?.checks ?? {};
  const down = SEARCH_CHECKS.filter((k) => checks[k] !== true);
  if (!down.length) return { ok: true, reason: "" };
  return {
    ok: false,
    reason: `Search is unavailable (/api/v1/health/ready reports ${down.join(", ")} not ready), so documents can't be indexed or answered`,
  };
}

interface DocumentSummary {
  id: string;
  filename: string;
  status: string;
}

async function listDocuments(page: Page, query: string): Promise<DocumentSummary[]> {
  const res = await page.request.get(`/api/v1/documents?limit=200${query}`);
  if (!res.ok()) return [];
  return ((await res.json()) as { items: DocumentSummary[] }).items;
}

/** What the signed-in persona can see, as /ask and /library count it (indexed = Ready). */
export async function documentCounts(page: Page): Promise<{ ready: number; pending: number; total: number }> {
  const [ready, queued, processing, all] = await Promise.all([
    listDocuments(page, "&status=indexed"),
    listDocuments(page, "&status=queued"),
    listDocuments(page, "&status=processing"),
    listDocuments(page, ""),
  ]);
  return { ready: ready.length, pending: queued.length + processing.length, total: all.length };
}

/** The newest document the signed-in persona can see (the first row of /library), if any. */
export async function newestDocument(page: Page): Promise<DocumentSummary | null> {
  const res = await page.request.get("/api/v1/documents?limit=1");
  if (!res.ok()) return null;
  return ((await res.json()) as { items: DocumentSummary[] }).items[0] ?? null;
}

// ---------- assertions ----------

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** §9 #15: no sideways page scroll. Call it once the page's content has loaded. `scroller` also
 *  checks an inner scroll container (the workspace <main> scrolls on its own). */
export async function expectNoHorizontalScroll(page: Page, width: number, scroller?: string): Promise<void> {
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth, `document scrollWidth at a ${width}px viewport`).toBeLessThanOrEqual(width);
  if (!scroller) return;
  const inner = await page
    .locator(scroller)
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(inner.scroll, `${scroller} scrolls sideways at ${width}px`).toBeLessThanOrEqual(inner.client);
}
