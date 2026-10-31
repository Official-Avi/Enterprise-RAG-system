import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { authFile, demoInfo, escapeRegExp, expectNoHorizontalScroll, knownDemoPassword, SHOTS } from "./helpers";

// The public landing page (spec §3, §4.1) and the login page (§4.2).

/** The hero section, named by its h1 "Ask your documents. See the exact page." */
const hero = (page: Page) => page.getByRole("region", { name: /^Ask your documents\./ });
const siteNav = (page: Page) => page.getByRole("navigation", { name: "Site" });
const demoCards = (page: Page) => page.locator("#demo").getByRole("button", { name: /^Continue as / });

test.describe("landing page", () => {
  test("has its own title and the tool as the hero (§9 #17)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("RackFlow AI · Ask your documents, see the source");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask your documents. See the exact page.");
    await expect(siteNav(page).getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "00-landing.png"), fullPage: true });
  });

  test("the hero dropzone has a native file-input button (§9 #12)", async ({ page }) => {
    await page.goto("/");
    const zone = hero(page);
    const choose = zone.getByRole("button", { name: "Choose a file", exact: true });
    await expect(choose).toBeVisible();
    // Drag is never the only path: a real <input type=file> sits behind the button.
    const input = zone.locator('input[type="file"]');
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute("accept", /\.pdf/);
    const chooser = page.waitForEvent("filechooser");
    await choose.click();
    expect((await chooser).isMultiple()).toBe(true);
  });

  test("demo cards show each persona's email and never a password (§4.1)", async ({ page, request }) => {
    const demo = await demoInfo(request);
    test.skip(!demo.enabled, "Demo mode is off on this server (DEMO_MODE=false), so the demo section is hidden");

    await page.goto("/");
    const section = page.locator("#demo");
    await expect(section.getByRole("heading", { level: 2, name: "Try it with a demo account" })).toBeVisible();
    await expect(demoCards(page)).toHaveCount(demo.personas.length);
    for (const p of demo.personas) {
      const card = section.getByRole("button", { name: `Continue as ${p.title}`, exact: true });
      await expect(card).toBeVisible();
      await expect(card).toContainText(p.email);
      await expect(card).toContainText(p.key === "auditor" ? "Opens the admin console" : "Opens Ask");
    }
    if (demo.personas.some((p) => p.key === "engineer")) {
      await expect(section.getByRole("button", { name: "Continue as Engineer", exact: true })).toContainText("Start here");
    }

    // Nothing on the page, or in the persona list it was built from, carries a password.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const listing = await (await request.get("/api/v1/auth/demo")).text();
    expect(listing).not.toMatch(/password/i);
    const password = knownDemoPassword();
    if (password) {
      expect(await page.content()).not.toContain(password);
      expect(listing).not.toContain(password);
    }
  });

  test("?role= only highlights a card; a GET never signs anyone in (§4.4)", async ({ page, request }) => {
    const demo = await demoInfo(request);
    test.skip(
      !demo.personas.some((p) => p.key === "auditor"),
      "The Auditor demo persona isn't offered on this server (DEMO_MODE off or not seeded)",
    );

    await page.goto("/?role=auditor");
    await expect(page.locator("#demo").getByRole("button", { name: "Continue as Auditor", exact: true })).toBeInViewport();
    expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
    await expect(siteNav(page).getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  });
});

test.describe("landing page, signed in", () => {
  test.use({ storageState: authFile("engineer") });

  test("the top bar offers Open workspace, and the visitor's own card goes back (§3.0, §4.1)", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(siteNav(page).getByRole("link", { name: "Open workspace" })).toHaveAttribute("href", "/ask");
    await expect(siteNav(page).getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);

    const demo = await demoInfo(request);
    if (demo.personas.some((p) => p.key === "engineer")) {
      await expect(page.locator("#demo").getByRole("button", { name: "Back to workspace", exact: true })).toBeVisible();
    }
  });
});

test.describe("login page", () => {
  test("offers the demo accounts above an accessible email form (§4.2, §9 #19)", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Sign in · RackFlow AI");

    const demo = await demoInfo(request);
    if (demo.enabled) {
      const block = page.getByRole("region", { name: "Use a demo account" });
      await expect(block.getByRole("button")).toHaveCount(demo.personas.length);
      for (const p of demo.personas) {
        await expect(block.getByRole("button", { name: new RegExp(`^${escapeRegExp(p.title)}\\b`) })).toBeVisible();
      }
      await expect(page.locator('input[type="password"]')).toHaveCount(1); // only the email form's
    }

    await expect(page.getByLabel("Work email")).toHaveAttribute("autocomplete", "username");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
  });
});

test.describe("at a 320px viewport (§9 #15)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the landing page has no horizontal scroll", async ({ page, request }) => {
    const demo = await demoInfo(request);
    await page.goto("/");
    await expect(hero(page).getByRole("button", { name: "Choose a file", exact: true })).toBeVisible();
    // The cards arrive after hydration; measure once they are in the layout.
    if (demo.enabled) await expect(demoCards(page).first()).toBeVisible();
    await expectNoHorizontalScroll(page, 320);
    await page.screenshot({ path: join(SHOTS, "00-landing-320.png"), fullPage: true });
  });

  test("the login page has no horizontal scroll", async ({ page, request }) => {
    const demo = await demoInfo(request);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    if (demo.enabled) {
      await expect(page.getByRole("region", { name: "Use a demo account" }).getByRole("button").first()).toBeVisible();
    }
    await expectNoHorizontalScroll(page, 320);
  });
});
