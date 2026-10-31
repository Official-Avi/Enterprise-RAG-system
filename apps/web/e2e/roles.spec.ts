import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { authFile, demoInfo, demoPassword, loginAsPersona, PERSONAS, SHOTS, type PersonaKey } from "./helpers";

// Role gating across the workspace and the console (spec §2.2, §2.3, §4.4, §7, §9 #22).

const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const backToAsk = (page: Page) => mainNav(page).getByRole("link", { name: "Back to Ask", exact: true });
const adminConsole = (page: Page) => page.getByRole("link", { name: "Admin console", exact: true });
/** The sidebar row and, before the first message, the composer pill (§5.2, §5.3). */
const addFiles = (page: Page) => page.getByRole("button", { name: "Add files", exact: true });
const composer = (page: Page) => page.locator("form").filter({ has: page.locator("#composer-input") });
/** "Add files" until the first message, then the paperclip "Attach files" (§5.3). */
const attach = (page: Page) => composer(page).getByRole("button", { name: /^(Add files|Attach files)$/ });
const demoStrip = (page: Page) => page.getByRole("region", { name: "Demo account" });

test("unauthenticated users are sent to login and bad passwords are rejected", async ({ page }) => {
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login\?next=%2Fdocuments/);
  await page.getByLabel("Work email").fill(PERSONAS.engineer.email);
  await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // (Next.js also renders an empty role=alert route announcer, so match the message itself.)
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(demoPassword());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // ?next= wins when the role can open it (§2.2).
  await expect(page).toHaveURL(/\/documents$/);
  await page.screenshot({ path: join(SHOTS, "05-login-redirect.png") });
});

// §9 #22. Fresh one-click sign-ins (no saved session), half from the landing grid and half
// from the compact rows on /login. 4 demo sign-ins, well under the 30/min limit.
const SIGN_INS: { key: PersonaKey; via: "landing" | "login" }[] = [
  { key: "admin", via: "landing" },
  { key: "engineer", via: "landing" },
  { key: "operator", via: "login" },
  { key: "auditor", via: "login" },
];

test.describe("one-click demo sign-in lands each role in the right place (§9 #22)", () => {
  test.beforeEach(async ({ request }) => {
    const demo = await demoInfo(request);
    test.skip(!demo.enabled, "Demo mode is off on this server (DEMO_MODE=false), so there are no persona cards");
  });

  for (const { key, via } of SIGN_INS) {
    const p = PERSONAS[key];
    const where = p.canChat ? "/ask" : "/overview";

    test(`${p.title} signs in from the ${via === "landing" ? "landing page" : "login page"} and lands on ${where}`, async ({
      page,
    }) => {
      await loginAsPersona(page, key, { via });
      await expect(page).toHaveURL(p.home);
      await expect(demoStrip(page)).toContainText(`(${p.title})`);

      if (!p.canChat) {
        // Auditor: straight into the console, which has no way back to an Ask it can't use.
        await expect(mainNav(page).getByRole("link", { name: "Audit log" })).toBeVisible();
        await expect(backToAsk(page)).toHaveCount(0);
        await expect(addFiles(page)).toHaveCount(0);
        return;
      }

      // Let the workspace finish rendering before checking what is absent.
      await expect(page.getByRole("navigation", { name: "Recent chats" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();

      if (p.canUpload) {
        await expect(addFiles(page).first()).toBeVisible();
        await expect(attach(page)).toBeVisible();
      } else {
        // Operators: hidden, not disabled (§2.3).
        await expect(addFiles(page)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Attach files" })).toHaveCount(0);
      }

      if (p.seesAdminConsole) {
        await adminConsole(page).click();
        await expect(page).toHaveURL(/\/overview$/);
      } else {
        // Engineers have no console link, but console URLs still open (the API is the boundary).
        await expect(adminConsole(page)).toHaveCount(0);
        await page.goto("/collections");
      }
      await expect(backToAsk(page)).toBeVisible();
      await backToAsk(page).click();
      await expect(page).toHaveURL(/\/ask$/);
    });
  }
});

test.describe("Engineer in the console", () => {
  test.use({ storageState: authFile("engineer") });

  test("ops pages explain the role instead of failing (§7 #4)", async ({ page }) => {
    await page.goto("/overview");
    const heading = page.getByRole("heading", { level: 1, name: "Overview needs a different role" });
    await expect(heading).toBeVisible();
    // A plain region with an h1, not an alert: the page loaded fine, it just isn't for this role.
    await expect(page.getByRole("region", { name: "Overview needs a different role" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "needs a different role" })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("link", { name: "Back to Ask" })).toBeVisible();
    await expect(backToAsk(page)).toBeVisible();
    await expect(mainNav(page).getByRole("link", { name: "Overview" })).toHaveCount(0);
  });
});

test.describe("Auditor", () => {
  test.use({ storageState: authFile("auditor") });

  test("sees status and the audit trail but never document content", async ({ page }) => {
    await page.goto("/overview");
    const nav = mainNav(page);
    await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(backToAsk(page)).toHaveCount(0);

    // The old console chat redirects to /ask, which explains the role (§5.9 E).
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/ask$/);
    await expect(page.getByRole("heading", { level: 1, name: "Auditors can't ask questions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open admin console", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your question" })).toHaveCount(0);

    await page.goto("/documents");
    await page.getByRole("row").nth(1).getByRole("link").first().click();
    await expect(page.getByText("Your role can view metadata only, not document content.")).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/auth\.(demo_)?login/).first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "06-audit-log.png"), fullPage: true });
  });
});

test.describe("Operator", () => {
  test.use({ storageState: authFile("operator") });

  test("works with infrastructure, jobs, workers, models and evaluation", async ({ page }) => {
    await page.goto("/overview");

    await mainNav(page).getByRole("link", { name: "Racks & workloads" }).click();
    await expect(page.getByText(/No hardware is discovered or controlled/)).toBeVisible();
    await expect(page.getByText("Simulated").first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "07-infrastructure.png"), fullPage: true });
    await page.getByRole("link", { name: /sim-rack-a1/ }).click();
    await expect(page.getByText("Simulated rack: all values are demo data")).toBeVisible();
    await expect(page.getByRole("list", { name: "Rack units from top" })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "08-rack-detail.png"), fullPage: true });

    await mainNav(page).getByRole("link", { name: "Job queue" }).click();
    await page.getByRole("row").nth(1).getByRole("button").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Stage timeline")).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "09-job-detail.png"), fullPage: true });
    await page.keyboard.press("Escape"); // dialogs are keyboard-dismissable
    await expect(dialog).toHaveCount(0);

    await mainNav(page).getByRole("link", { name: "Workers" }).click();
    await expect(page.getByText("Healthy").first()).toBeVisible();

    await mainNav(page).getByRole("link", { name: "Model serving" }).click();
    await expect(page.getByText(/Extractive mode is a built-in fallback/)).toBeVisible();

    await mainNav(page).getByRole("link", { name: "Evaluation" }).click();
    await expect(page.getByText("Retrieval hit rate").first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "10-evaluation.png"), fullPage: true });

    await mainNav(page).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByText("Queue depth")).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "11-overview-operator.png"), fullPage: true });
  });
});

// These end or replace their session, so they sign in fresh instead of using a saved one.
test.describe("demo strip (§4.3, §4.4)", () => {
  test.beforeEach(async ({ request }) => {
    const demo = await demoInfo(request);
    test.skip(!demo.enabled, "Demo mode is off on this server (DEMO_MODE=false)");
  });

  test("switching persona re-gates the workspace without a reload", async ({ page }) => {
    await loginAsPersona(page, "engineer");
    await expect(addFiles(page).first()).toBeVisible();

    await demoStrip(page).getByRole("button", { name: "Switch persona" }).click();
    const menu = page.getByRole("menu", { name: "Switch persona" });
    await expect(menu.getByRole("menuitemradio", { name: /^Engineer\b/ })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: /^Operator\b/ }).click();

    await expect(demoStrip(page)).toContainText("(Operator)");
    await expect(page).toHaveURL(/\/ask$/);
    await expect(addFiles(page)).toHaveCount(0);
    await expect(adminConsole(page)).toBeVisible();
    await expect(page.locator("#sr-announcer")).toContainText("You're now Operator");
  });

  test("Exit demo signs out and returns to the landing page", async ({ page }) => {
    await loginAsPersona(page, "operator");
    await demoStrip(page).getByRole("button", { name: "Exit demo" }).click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/(?:[?#].*)?$/);
    await expect(
      page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  });
});
