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

  // Chips (Claude) and quote links (extractive) are both named "Source n: file…" (§5.7, §9 #8).
  const source = page.getByRole("button", { name: new RegExp(`^Source \\d+: ${escapeRegExp(filename)}`) }).first();
  await source.click();
  const panel = page.getByRole("complementary", { name: "Sources" }); // docked at 1440px
  await expect(panel).toBeVisible();
  // The quote is a sentence of this file; which one depends on how the model worded its claim.
  await expect(panel.locator("mark").filter({ hasText: /flushed every 45 days|Record each flush/ }).first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "03-ask-citation.png"), fullPage: true });

  // The file now lives in My documents, Ready.
  await page.getByRole("link", { name: /^My documents/ }).click();
  await expect(page).toHaveURL(/\/library$/);
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row.getByText(/\bReady\b/)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "04-library.png"), fullPage: true });
});

// The console's own way in: a new collection, the /documents upload panel, the detail page. No
// question is asked, so this needs the worker and search but not the answer model.
test("engineer adds a file from the Documents page and reads it back", async ({ page }) => {
  const health = await searchHealth(page.request);
  test.skip(!health.ok, health.reason);
  test.setTimeout(180_000); // indexing (up to 90s) plus cleaning up

  const stamp = Date.now().toString(36);
  const collection = `E2E ${stamp}`;
  const filename = `console-${stamp}.md`;
  const fact = `The console-${stamp} cooling loop must be flushed every 45 days by the facilities team.`;
  const write = { headers: { "X-RackFlow-CSRF": "1" } };

  try {
    await page.goto("/collections");
    await page.getByRole("button", { name: "New collection" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(collection);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: collection })).toBeVisible();

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Documents" }).click();
    await page.getByLabel("Into collection").selectOption({ label: collection });
    await page.getByLabel("Choose files to upload").setInputFiles({
      name: filename,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Cooling maintenance\n\n${fact}\n\nRecord each flush in the maintenance log.\n`),
    });
    await expect(page.getByRole("listitem").filter({ hasText: filename })).toBeVisible();

    // The table polls while documents are processing.
    const row = page.getByRole("row").filter({ hasText: filename });
    await expect(row.getByText("Indexed")).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: join(SHOTS, "12-documents.png"), fullPage: true });

    await row.getByRole("link", { name: filename, exact: true }).click();
    await expect(page.getByRole("heading", { name: filename })).toBeVisible();
    await expect(page.getByText("finalize", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(fact)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "13-document-detail.png"), fullPage: true });
  } finally {
    // The demo accounts are shared, so leave nothing behind. A collection can only go once the
    // worker has finished deleting its documents.
    const list = await page.request.get("/api/v1/collections?limit=500");
    const created = ((await list.json()) as { id: string; name: string }[]).find((c) => c.name === collection);
    if (created) {
      const docs = await page.request.get(`/api/v1/documents?collection_id=${created.id}`);
      for (const d of ((await docs.json()) as { items: { id: string }[] }).items) {
        await page.request.delete(`/api/v1/documents/${d.id}`, write);
      }
      await expect
        .poll(async () => (await page.request.delete(`/api/v1/collections/${created.id}`, write)).status(), {
          timeout: 60_000,
        })
        .toBe(204);
    }
  }
});
