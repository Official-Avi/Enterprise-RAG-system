import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { login, SHOTS } from "./helpers";

// Journey A + B: create collection → upload → processing → indexed → ask → verify citation.
test("engineer uploads a document and gets a cited answer", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const collection = `E2E ${stamp}`;
  const filename = `zephyr-${stamp}.md`;
  const fact = `The zephyr-${stamp} cooling loop must be flushed every 45 days by the facilities team.`;

  await login(page, "engineer@acme.example.com");
  await page.screenshot({ path: join(SHOTS, "01-landing-engineer.png"), fullPage: true });

  await page.getByRole("link", { name: "Collections" }).click();
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Name").fill(collection);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: collection })).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).click();
  await page.getByLabel("Into collection").selectOption({ label: collection });
  await page.getByLabel("Choose files to upload").setInputFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Cooling maintenance\n\n${fact}\n\nRecord each flush in the maintenance log.\n`),
  });
  const result = page.getByRole("listitem").filter({ hasText: filename });
  await expect(result.getByText("Queued")).toBeVisible();

  // The library polls while documents are processing; wait for the worker to index it.
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row.getByText("Indexed")).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: join(SHOTS, "02-documents.png"), fullPage: true });

  await row.getByRole("link", { name: filename }).click();
  await expect(page.getByRole("heading", { name: filename })).toBeVisible();
  await expect(page.getByText("finalize")).toBeVisible();
  await expect(page.getByText(fact)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "03-document-detail.png"), fullPage: true });

  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("button", { name: "New conversation" }).click();
  // Search only the new collection so the citation must come from our document.
  for (const box of await page.getByRole("checkbox").all()) await box.uncheck();
  await page.getByRole("checkbox", { name: new RegExp(collection) }).check();
  await page.getByRole("button", { name: "Start conversation" }).click();
  await page.getByLabel("Your question").fill(`How often must the zephyr-${stamp} cooling loop be flushed?`);
  await page.getByRole("button", { name: "Ask" }).click();

  await expect(page.getByText("Evidence found")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/45 days/).first()).toBeVisible();
  // The answer may cite source [1] in several sentences; open the first chip.
  await page.getByRole("button", { name: new RegExp(`Source 1: ${filename}`) }).first().click();
  await expect(page.getByText("Source [1]")).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("45 days");
  await expect(page.getByText(/verify critical operational steps/i)).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "04-chat-citation.png"), fullPage: true });
});
