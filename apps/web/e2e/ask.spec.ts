import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  authFile,
  documentCounts,
  expectNoHorizontalScroll,
  PERSONA_KEYS,
  PERSONAS,
  searchHealth,
  SHOTS,
  type PersonaKey,
} from "./helpers";

// The /ask workspace (spec §5): empty states, composer keys, attach, suggestions, routing.

const questionBox = (page: Page) => page.getByRole("textbox", { name: "Your question" });
const composer = (page: Page) => page.locator("form").filter({ has: page.locator("#composer-input") });
/** Each turn is an <article> (§9 #18). */
const turns = (page: Page) => page.getByRole("article");
const pageHeading = (page: Page, name: string | RegExp) =>
  page.getByRole("main").getByRole("heading", { level: 1, name });

async function openAsk(page: Page): Promise<void> {
  await page.goto("/ask");
  await expect(questionBox(page)).toBeVisible();
}

/** The §5.9 heading an empty /ask shows for this persona, given what it can see right now. */
async function expectedEmptyHeading(page: Page, key: PersonaKey): Promise<RegExp> {
  if (key === "auditor") return /^Auditors can't ask questions$/;
  const { ready, pending } = await documentCounts(page);
  if (ready > 0) return /^What would you like to know\?$/;
  if (!PERSONAS[key].canUpload) return /^Nothing to ask about yet$/;
  // A file may finish reading between this check and the page load.
  if (pending > 0) return /^(Reading your documents…|What would you like to know\?)$/;
  return /^Add a document to get started$/;
}

test.describe("empty /ask per role (§5.9)", () => {
  for (const key of PERSONA_KEYS) {
    const p = PERSONAS[key];
    test.describe(p.title, () => {
      test.use({ storageState: authFile(key) });

      test(`shows the ${p.title} empty state`, async ({ page }) => {
        const expected = await expectedEmptyHeading(page, key);
        await page.goto("/ask");
        const heading = pageHeading(page, expected);
        await expect(heading).toBeVisible();
        const text = (await heading.innerText()).trim();

        if (text === "Auditors can't ask questions") {
          // Full page, no composer (§5.9 E).
          await expect(page.getByRole("link", { name: "Open admin console", exact: true })).toBeVisible();
          await expect(questionBox(page)).toHaveCount(0);
        } else if (text === "Nothing to ask about yet") {
          await expect(page.getByRole("link", { name: "Open job queue", exact: true })).toBeVisible();
        } else if (text === "Add a document to get started") {
          await expect(page.getByRole("main").getByRole("button", { name: "Choose a file", exact: true })).toBeVisible();
          await expect(questionBox(page)).toBeVisible();
        } else if (text === "What would you like to know?") {
          await expect(page.getByRole("main")).toContainText(/I'll answer from your \d+ documents? and show the exact passage\./);
          await expect(questionBox(page)).toBeVisible();
        } else {
          await expect(questionBox(page)).toBeVisible();
        }
        // §5.9: /ask never auto-opens the latest chat on a shared account.
        await expect(page).toHaveURL(/\/ask$/);
        await expect(turns(page)).toHaveCount(0);
        await page.screenshot({ path: join(SHOTS, `20-ask-empty-${key}.png`), fullPage: true });
      });
    });
  }
});

test.describe("Ask as the Engineer", () => {
  test.use({ storageState: authFile("engineer") });

  test("is titled Ask · RackFlow AI (§9 #17)", async ({ page }) => {
    await openAsk(page);
    await expect(page).toHaveTitle("Ask · RackFlow AI");
  });

  test("/chat redirects to /ask (§2.1)", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/ask$/);
    await expect(questionBox(page)).toBeVisible();
  });

  test("IME Enter doesn't send; Shift+Enter adds a new line (§5.3, §9 #4)", async ({ page }) => {
    await openAsk(page);
    const box = questionBox(page);
    await box.fill("What is the backup retention");

    // An Enter that confirms an IME candidate arrives with isComposing (or keyCode 229 in some
    // browsers). Playwright's keyboard can't compose, so dispatch both forms directly.
    await box.evaluate((el) => {
      const composing = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(composing);
      const legacy = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(legacy, "keyCode", { get: () => 229 });
      el.dispatchEvent(legacy);
    });

    // Shift+Enter inserts a newline, and typing carries on in the same box.
    await box.press("Shift+Enter");
    await page.keyboard.type("and who owns it?");
    await expect(box).toHaveValue("What is the backup retention\nand who owns it?");
    await expect(box).toBeFocused();
    await expect(turns(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/ask$/);
  });

  test("Send is aria-disabled, never disabled, while the box is empty (§5.3, §9 #5)", async ({ page }) => {
    await openAsk(page);
    const send = composer(page).getByRole("button", { name: "Send", exact: true });
    await expect(send).toHaveAttribute("aria-disabled", "true");
    await expect(send).not.toHaveAttribute("disabled");
    // Pressing it does nothing (force: Playwright treats aria-disabled as not clickable), and the
    // box keeps the hint wired up.
    await send.click({ force: true });
    await expect(turns(page)).toHaveCount(0);
    await expect(questionBox(page)).toHaveAttribute("aria-describedby", "composer-hint");
    await expect(page.locator("#composer-hint")).toHaveText("Enter to send · Shift+Enter for a new line");
    await questionBox(page).fill("Anything");
    await expect(send).toHaveAttribute("aria-disabled", "false");
  });

  test("Add files opens the native picker and the file shows as a chip (§5.5, §9 #12)", async ({ page }) => {
    await openAsk(page);
    const filename = `e2e-${Date.now().toString(36)}.md`; // short enough that the chip shows it whole

    const chooser = page.waitForEvent("filechooser");
    await composer(page).getByRole("button", { name: "Add files", exact: true }).click();
    await (await chooser).setFiles({
      name: filename,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Attach check\n\nUploaded by the Playwright suite at ${new Date().toISOString()}.\n`),
    });

    const chips = page.getByRole("list", { name: "Attached files" });
    const chip = chips.getByRole("listitem").filter({ hasText: filename });
    await expect(chip).toBeVisible();
    await expect(chip.getByRole("button", { name: `Remove ${filename}` })).toBeVisible();
    // Uploading, then Waiting or Reading (or Couldn't read when search is down): never blank.
    await expect(chip).toContainText(/Uploading|Waiting|Reading|Ready|Already added|Couldn't read|Not accepted/);
    await page.screenshot({ path: join(SHOTS, "21-ask-attached.png") });

    // Removing the chip only stops showing it; the document stays in My documents.
    await chip.getByRole("button", { name: `Remove ${filename}` }).click();
    await expect(chip).toHaveCount(0);
    await expect(questionBox(page)).toBeFocused();
  });

  test("a suggested question sends at once (§5.11)", async ({ page }) => {
    const { ready } = await documentCounts(page);
    test.skip(ready === 0, "The Engineer has no Ready documents, so /ask shows no suggestions (index the demo corpus first)");

    await openAsk(page);
    const suggestions = page.getByRole("list", { name: "Suggested questions" });
    const chip = suggestions.getByRole("button").first();
    await expect(chip).toBeVisible();
    // The first line of the chip is the question; a second line names the file.
    const question = (await chip.locator("span").first().innerText()).trim();
    expect(question).not.toBe("");

    await chip.click();
    await expect(turns(page).filter({ hasText: question })).toBeVisible();
    await expect(suggestions).toHaveCount(0); // chips hide after the first message
    await expect(questionBox(page)).toHaveValue("");
  });

  test("Enter sends, clears the box and keeps focus there (§5.3, §9 #17)", async ({ page }) => {
    const health = await searchHealth(page.request);
    test.skip(!health.ok, health.reason);
    const { ready } = await documentCounts(page);
    test.skip(ready === 0, "The Engineer has no Ready documents to ask about (index the demo corpus first)");

    await openAsk(page);
    const box = questionBox(page);
    const question = "What does the backup policy say about retention?";
    await box.fill(question);
    await box.press("Enter");

    await expect(turns(page).filter({ hasText: question })).toBeVisible();
    await expect(box).toBeFocused();
    // An answer or an honest "not found", never an error card.
    await expect(
      page.getByText(/^(Found in your documents|Not found in your documents|Your documents don't answer this)$/).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert").filter({ hasText: /Something went wrong|Can't reach RackFlow/ })).toHaveCount(0);
    await expect(box).toHaveValue("");
    // The chat now has its own URL and title (§5.8, §9 #17).
    await expect(page).toHaveURL(/\/ask\/c\/[0-9a-f-]{36}$/);
    await expect(page).toHaveTitle(/^.+ · RackFlow AI$/);
    await expect(page).not.toHaveTitle("Ask · RackFlow AI");
    await page.screenshot({ path: join(SHOTS, "22-ask-answered.png"), fullPage: true });
  });
});

test.describe("Ask at a 320px viewport (§9 #15)", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 320, height: 640 } });

  test("has no horizontal scroll", async ({ page }) => {
    await openAsk(page);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, 320, "main#main");
    await page.screenshot({ path: join(SHOTS, "23-ask-320.png"), fullPage: true });
  });
});
