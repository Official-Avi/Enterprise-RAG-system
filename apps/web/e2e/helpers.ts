import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function demoPassword(): string {
  if (process.env.E2E_PASSWORD) return process.env.E2E_PASSWORD;
  return readFileSync(join(__dirname, "..", "..", "..", ".data", "demo-password.txt"), "utf8").trim();
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(demoPassword());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

export const SHOTS = join(__dirname, "..", "test-results", "screenshots");
