import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { authFile, escapeRegExp, searchHealth, SHOTS } from "./helpers";

test.use({ storageState: authFile("engineer") });

// Journeys A + B in the workspace: add a file in Ask → Waiting/Reading → Ready → ask → open the
// cited passage. Then the file is listed in My documents.
test("engineer adds a file in Ask and gets a cited answer", async ({ page }) => {
  const health = await searchHealth(page.request);
  test.skip(!health.ok, health.reason);
  test.setTimeout(240_000); // indexing (up to 90s) plus the answer (up to 60s)

  const stamp = Date.now().toString(36);
  const filename = `zephyr-${stamp}.md`; // under the chip's 22-character limit, so it shows whole
  const fact = `The zephyr-${stamp} cooling loop must be flushed every 45 days by the facilities team.`;
  const question = `How often must the zephyr-${stamp} cooling loop be flushed?`;

  await page.goto("/ask");
  const box = page.getByRole("textbox", { name: "Your question" });
  await expect(box).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "01-ask-engineer.png"), fullPage: true });

  const chooser = page.waitForEvent("filechooser");
  await page
    .locator("form")
    .filter({ has: box })
    .getByRole("button", { name: "Add files", exact: true })
    .click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Cooling maintenance\n\n${fact}\n\nRecord each flush in the maintenance log.\n`),
  });

  // The chip polls until the worker has read the file.
  const chip = page.getByRole("list", { name: "Attached files" }).getByRole("listitem").filter({ hasText: filename });
  await expect(chip).toBeVisible();
  await expect(chip.getByText(/\bReady\b/)).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: join(SHOTS, "02-ask-file-ready.png"), fullPage: true });

  await box.fill(question);
  await box.press("Enter");
  await expect(page.getByRole("article").filter({ hasText: question })).toBeVisible();
  await expect(page.getByText("Found in your documents").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/45 days/).first()).toBeVisible();

  // Chips (Claude) and quote links (extractive) are both named "Source n: file…" (§5.7, §9 #8).
  const source = page.getByRole("button", { name: new RegExp(`^Source \\d+: ${escapeRegExp(filename)}`) }).first();
  await source.click();
  const panel = page.getByRole("complementary", { name: "Sources" }); // docked at 1440px
  await expect(panel).toBeVisible();
  await expect(panel.locator("mark").filter({ hasText: "45 days" }).first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "03-ask-citation.png"), fullPage: true });

  // The file now lives in My documents, Ready.
  await page.getByRole("link", { name: /^My documents/ }).click();
  await expect(page).toHaveURL(/\/library$/);
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row.getByText(/\bReady\b/)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "04-library.png"), fullPage: true });
});
