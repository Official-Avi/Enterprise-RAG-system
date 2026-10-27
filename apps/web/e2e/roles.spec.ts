import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { demoPassword, login, SHOTS } from "./helpers";

test("unauthenticated users are sent to login and bad passwords are rejected", async ({ page }) => {
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login\?next=%2Fdocuments/);
  await page.getByLabel("Work email").fill("engineer@acme.example.com");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
  await page.getByLabel("Password").fill(demoPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.screenshot({ path: join(SHOTS, "05-login-redirect.png") });
});

test("auditor sees status and audit trail but never document content", async ({ page }) => {
  await login(page, "auditor@acme.example.com");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Chat" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/chat");
  await expect(page.getByText("You don't have access to this page.")).toBeVisible();

  await page.goto("/documents");
  await page.getByRole("row").nth(1).getByRole("link").first().click();
  await expect(page.getByText("Your role can view metadata only, not document content.")).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("auth.login").first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "06-audit-log.png"), fullPage: true });
});

test("operator works with infrastructure, jobs, workers, models and evaluation", async ({ page }) => {
  await login(page, "operator@acme.example.com");

  await page.getByRole("link", { name: "Racks & workloads" }).click();
  await expect(page.getByText(/No hardware is discovered or controlled/)).toBeVisible();
  await expect(page.getByText("Simulated").first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "07-infrastructure.png"), fullPage: true });
  await page.getByRole("link", { name: /sim-rack-a1/ }).click();
  await expect(page.getByText("Simulated rack: all values are demo data")).toBeVisible();
  await expect(page.getByRole("list", { name: "Rack units from top" })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "08-rack-detail.png"), fullPage: true });

  await page.getByRole("link", { name: "Job queue" }).click();
  await page.getByRole("row").nth(1).getByRole("button").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Stage timeline")).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "09-job-detail.png"), fullPage: true });
  await page.keyboard.press("Escape"); // dialogs are keyboard-dismissable
  await expect(dialog).toHaveCount(0);

  await page.getByRole("link", { name: "Workers" }).click();
  await expect(page.getByText("Healthy").first()).toBeVisible();

  await page.getByRole("link", { name: "Model serving" }).click();
  await expect(page.getByText(/Extractive mode is a built-in fallback/)).toBeVisible();

  await page.getByRole("link", { name: "Evaluation" }).click();
  await expect(page.getByText("Retrieval hit rate").first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "10-evaluation.png"), fullPage: true });

  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("Queue depth")).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "11-overview-operator.png"), fullPage: true });
});
