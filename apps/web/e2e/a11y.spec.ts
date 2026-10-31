import { expect, test, type Page } from "@playwright/test";
import { authFile, demoInfo } from "./helpers";

// Keyboard, landmark and motion checks from spec §9 (#2, #6, #9, #10, #11, #16, #18).
// Automated axe scans (§9 #1) need @axe-core/playwright, which isn't installed yet.

/** Put the sequential-focus starting point at the top of the document, as on a fresh load,
 *  even if the page has already moved focus (e.g. into the question box). */
async function focusDocumentStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const body = document.body;
    body.setAttribute("tabindex", "-1");
    body.focus();
    body.removeAttribute("tabindex");
  });
}

/** The longest transition or animation duration on any element or ::before/::after, in ms. */
async function longestMotionMs(page: Page): Promise<{ ms: number; where: string }> {
  return page.evaluate(() => {
    const toMs = (value: string) =>
      value.split(",").map((part) => {
        const text = part.trim();
        const n = Number.parseFloat(text);
        if (Number.isNaN(n)) return 0;
        return text.endsWith("ms") ? n : n * 1000;
      });
    let ms = 0;
    let where = "none";
    for (const el of Array.from(document.querySelectorAll("*"))) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(el, pseudo);
        for (const d of [...toMs(style.transitionDuration), ...toMs(style.animationDuration)]) {
          if (d > ms) {
            ms = d;
            where = `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">${pseudo ?? ""}`;
          }
        }
      }
    }
    return { ms, where };
  });
}

// Chromium serialises 0.01ms as "1e-05s"; allow for float rounding on the way back to ms.
const REDUCED_MOTION_MAX_MS = 0.01 + 1e-6;

test.describe("landing page", () => {
  test("Skip to main content is the first Tab stop (§9 #6)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await focusDocumentStart(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  });

  test("has banner, site navigation, main and footer landmarks, and one announcer (§9 #2, #18)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveAttribute("id", "main");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).toBeAttached();
    const announcer = page.locator("#sr-announcer");
    await expect(announcer).toHaveCount(1);
    await expect(announcer).toHaveAttribute("role", "status");
    await expect(announcer).toHaveAttribute("aria-live", "polite");
  });

  test("under reduced motion every transition and animation is at most 0.01ms (§8.4, §9 #16)", async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    if ((await demoInfo(request)).enabled) {
      // The cards carry hover lifts and press scales; measure once they've rendered.
      await expect(page.locator("#demo").getByRole("button", { name: /^Continue as / }).first()).toBeVisible();
    }
    const longest = await longestMotionMs(page);
    expect(longest.ms, `longest motion: ${longest.where}`).toBeLessThanOrEqual(REDUCED_MOTION_MAX_MS);
  });
});

test.describe("/ask as the Engineer", () => {
  test.use({ storageState: authFile("engineer") });

  async function openAsk(page: Page) {
    await page.goto("/ask");
    await expect(page.getByRole("textbox", { name: "Your question" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  }

  test("the first Tab stops are Skip to question box, then Skip to main content (§9 #6)", async ({ page }) => {
    await openAsk(page);
    await focusDocumentStart(page);
    await page.keyboard.press("Tab");
    const toQuestion = page.getByRole("link", { name: "Skip to question box" });
    await expect(toQuestion).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();

    // The first one lands in the question box.
    await page.keyboard.press("Shift+Tab");
    await expect(toQuestion).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Your question" })).toBeFocused();
  });

  test("has main with an h1, Recent chats navigation and the demo region (§9 #18)", async ({ page, request }) => {
    await openAsk(page);
    const main = page.getByRole("main");
    await expect(main).toHaveAttribute("id", "main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Recent chats" })).toBeVisible();
    if ((await demoInfo(request)).enabled) {
      await expect(page.getByRole("region", { name: "Demo account" })).toBeVisible();
    }
    await expect(page.locator("#sr-announcer")).toHaveCount(1);
  });

  test("Send and Add files are at least 24×24px (§9 #9)", async ({ page }) => {
    await openAsk(page);
    const form = page.locator("form").filter({ has: page.locator("#composer-input") });
    for (const control of [
      form.getByRole("button", { name: "Send", exact: true }),
      form.getByRole("button", { name: "Add files", exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box, "control is laid out").not.toBeNull();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    }
  });

  test("under reduced motion every transition and animation is at most 0.01ms (§9 #16)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAsk(page);
    const longest = await longestMotionMs(page);
    expect(longest.ms, `longest motion: ${longest.where}`).toBeLessThanOrEqual(REDUCED_MOTION_MAX_MS);
  });
});

test.describe("/ask on a phone", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 375, height: 812 } });

  test("the sidebar drawer is a modal dialog with a visible Close that Esc dismisses (§9 #10, #11)", async ({
    page,
  }) => {
    await page.goto("/ask");
    // Below 1024px the workspace header carries the menu button (§5.2).
    await expect(page.getByRole("banner").first()).toBeVisible();
    const open = page.getByRole("button", { name: "Open sidebar" });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();

    const drawer = page.getByRole("dialog", { name: "Sidebar" });
    await expect(drawer).toBeVisible();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(drawer.getByRole("navigation", { name: "Recent chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(open).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("/library as the Engineer", () => {
  test.use({ storageState: authFile("engineer") });

  test("Skip to main content is the first Tab stop, and main has the page h1 (§9 #6, #18)", async ({ page }) => {
    await page.goto("/library");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "My documents" })).toBeVisible();
    await focusDocumentStart(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    // The question-box skip link belongs to /ask only.
    await expect(page.getByRole("link", { name: "Skip to question box" })).toHaveCount(0);
  });
});

test.describe("admin console as the Admin", () => {
  test.use({ storageState: authFile("admin") });

  test("Skip to main content is the first Tab stop (§9 #6)", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await focusDocumentStart(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  });
});
