import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import {
  acceptUploads,
  FAILED_FILE,
  mockFailedFile,
  mockSharedDocument,
  READY_FILE,
  SHARED_COLLECTION,
  SHARED_DOC_ID,
  SHARED_FILE,
} from "./fixtures";
import { authFile, documentCounts, escapeRegExp, expectNoHorizontalScroll, newestDocument, SHOTS } from "./helpers";

// "My documents" (/library, spec §6): table and cards, status chips, search, role gating.

const NO_DOCS = "This persona can't see any documents yet (seed the demo corpus or upload one first)";

const heading = (page: Page) => page.getByRole("main").getByRole("heading", { level: 1, name: "My documents" });
const table = (page: Page) => page.getByRole("table");
const tableRows = (page: Page) => table(page).locator("tbody tr");
/** Chips are named by their label and count, e.g. "Ready 12" (library/Toolbar.tsx). */
const statusChip = (page: Page, label: string) =>
  page
    .getByRole("group", { name: "Filter by status" })
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}\\W*\\d+$`) });
const card = (page: Page, filename: string) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: filename }).first();

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/library");
  await expect(heading(page)).toBeVisible();
}

test.describe("My documents as the Engineer", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 1280, height: 800 } });

  test("is titled My documents · RackFlow AI and offers Add files (§6, §9 #17)", async ({ page }) => {
    await openLibrary(page);
    await expect(page).toHaveTitle("My documents · RackFlow AI");
    await expect(page.getByRole("main").getByRole("button", { name: "Add files", exact: true })).toBeVisible();
    // The Upload button is the small-screen form of the same action.
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeHidden();
  });

  test("lists documents in a table at 1280px (§6)", async ({ page }) => {
    const { total, ready } = await documentCounts(page);
    test.skip(total === 0, NO_DOCS);

    await openLibrary(page);
    await expect(table(page)).toBeVisible();
    for (const name of ["Name", "Status", "Pages", "Added"]) {
      await expect(table(page).getByRole("columnheader", { name: new RegExp(`^${name}$`, "i") })).toBeVisible();
    }
    await expect(table(page).getByRole("columnheader", { name: "Actions" })).toBeAttached(); // sr-only
    await expect(tableRows(page).first()).toBeVisible();

    const newest = await newestDocument(page);
    if (newest) await expect(table(page)).toContainText(newest.filename);
    if (ready > 0) {
      // Ready rows link straight into a chat about that file.
      const ask = table(page).getByRole("link", { name: /^Ask about this/ }).first();
      await expect(ask).toHaveAttribute("href", /^\/ask\?doc=[0-9a-f-]{36}$/);
    }
    await page.screenshot({ path: join(SHOTS, "30-library-1280.png"), fullPage: true });
  });

  test("status chips filter the list (§6)", async ({ page }) => {
    const { total, ready } = await documentCounts(page);
    test.skip(total === 0, NO_DOCS);

    await openLibrary(page);
    await expect(tableRows(page).first()).toBeVisible();
    const all = statusChip(page, "All");
    await expect(all).toHaveAttribute("aria-pressed", "true");

    test.skip(ready === 0, "No Ready documents, so there is no Ready chip to pick");
    const readyChip = statusChip(page, "Ready");
    await readyChip.click();
    await expect(readyChip).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");
    await expect(tableRows(page).first()).toBeVisible();
    // The Status cell only: a row's text runs its cells together, and a file name could say Ready.
    await expect(tableRows(page).locator("td:nth-child(2)").filter({ hasNotText: "Ready" })).toHaveCount(0);

    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(readyChip).toHaveAttribute("aria-pressed", "false");
  });

  test("search says when nothing matches, and Clear search brings the list back (§6)", async ({ page }) => {
    const { total } = await documentCounts(page);
    test.skip(total === 0, NO_DOCS);

    await openLibrary(page);
    const search = page.getByRole("searchbox", { name: "Search by file name" });
    await expect(search).toBeVisible();
    const q = `no-such-file-${Date.now().toString(36)}`;
    await search.fill(q);
    await expect(page.getByRole("heading", { name: `No documents match “${q}”` })).toBeVisible();

    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(tableRows(page).first()).toBeVisible();
  });
});

// Fixed responses: these need a collection grant and a failed file a live stack can't promise.
test.describe("My documents with collection access (§6)", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 1280, height: 800 } });

  const myUserId = async (page: Page) =>
    ((await (await page.request.get("/api/v1/auth/me")).json()) as { user_id: string }).user_id;
  const openMenu = async (page: Page) => {
    await openLibrary(page);
    await page.getByRole("button", { name: `Actions for ${FAILED_FILE}` }).first().click();
    const menu = page.getByRole("menu", { name: `Actions for ${FAILED_FILE}` });
    await expect(menu).toBeVisible();
    return menu;
  };
  const confirmDeletion = async (page: Page) => {
    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    return dialog;
  };

  test("a file opened with Ask about this isn't listed under My documents", async ({ page }) => {
    await mockSharedDocument(page);
    await page.goto(`/ask?doc=${SHARED_DOC_ID}`);
    const chip = page.getByRole("list", { name: "Attached files" }).getByRole("listitem").filter({ hasText: SHARED_FILE });
    await expect(chip).toBeVisible();

    await page.getByRole("link", { name: /^My documents/ }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(tableRows(page).filter({ hasText: SHARED_FILE })).toContainText(SHARED_COLLECTION);

    await page.getByLabel("Collection").selectOption({ label: "My documents" });
    await expect(tableRows(page).filter({ hasText: READY_FILE })).toBeVisible();
    await expect(tableRows(page).filter({ hasText: SHARED_FILE })).toHaveCount(0);
    await expect(statusChip(page, "All")).toHaveAccessibleName(/\b1$/);
  });

  test("a file added on this page is listed under My documents before the list catches up", async ({ page }) => {
    const filename = "e2e-library-new.pdf";
    await acceptUploads(page, filename, SHARED_DOC_ID);
    await openLibrary(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("main").getByRole("button", { name: "Add files", exact: true }).click();
    await (await chooser).setFiles({ name: filename, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
    await expect(tableRows(page).filter({ hasText: filename })).toContainText("My documents");
    await expect(tableRows(page).filter({ hasText: filename })).not.toContainText("Uploading");
  });

  test("read access offers neither Try again nor Delete, even to the uploader", async ({ page }) => {
    await mockFailedFile(page, { level: "read", uploadedBy: await myUserId(page) });
    const menu = await openMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Download" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Try again" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  });

  test("write access offers Try again, and Delete only on your own file", async ({ page }) => {
    await mockFailedFile(page, { level: "write", uploadedBy: await myUserId(page) });
    const mine = await openMenu(page);
    await expect(mine.getByRole("menuitem", { name: "Try again" })).toBeVisible();
    await expect(mine.getByRole("menuitem", { name: "Delete" })).toBeVisible();

    await mockFailedFile(page, { level: "write" });
    const theirs = await openMenu(page);
    await expect(theirs.getByRole("menuitem", { name: "Try again" })).toBeVisible();
    await expect(theirs.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  });

  test("a refused Try again talks about the collection, not the role", async ({ page }) => {
    await mockFailedFile(page, { level: "write" });
    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Try again" }).click();
    const alert = page.getByRole("alert").filter({ hasText: FAILED_FILE });
    await expect(alert).toContainText("write access to its collection");
    await expect(alert).not.toContainText("role");
  });

  test("a 404 on Delete isn't announced as a removal while the file is still there", async ({ page }) => {
    await mockFailedFile(page, { level: "manage" });
    const dialog = await confirmDeletion(page);
    await expect(dialog.getByText("You don't have write access")).toBeVisible();
    await expect(page.locator("#sr-announcer")).not.toContainText("is being removed");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(tableRows(page).filter({ hasText: FAILED_FILE })).not.toContainText("Removing");
  });

  test("a 404 on Delete counts as done when the file is really gone", async ({ page }) => {
    await mockFailedFile(page, { level: "manage", deleteRemovedIt: true });
    const dialog = await confirmDeletion(page);
    await expect(dialog).toBeHidden();
    await expect(page.locator("#sr-announcer")).toContainText(`${FAILED_FILE} is being removed.`);
    await expect(tableRows(page).filter({ hasText: FAILED_FILE })).toHaveCount(0);
  });
});

test.describe("My documents on a phone", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 375, height: 812 } });

  test("lists documents as cards with an Upload button at 375px (§6, §10)", async ({ page }) => {
    const newest = await newestDocument(page);
    if (!newest) {
      test.skip(true, NO_DOCS);
      return;
    }

    await openLibrary(page);
    await expect(card(page, newest.filename)).toBeVisible();
    await expect(table(page)).toBeHidden();
    await expect(page.getByRole("button", { name: `Actions for ${newest.filename}` }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Add files", exact: true })).toBeHidden();
    await page.screenshot({ path: join(SHOTS, "31-library-375.png"), fullPage: true });
  });
});

test.describe("My documents at a 320px viewport", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 320, height: 640 } });

  test("has no horizontal scroll (§9 #15)", async ({ page }) => {
    const newest = await newestDocument(page);
    await openLibrary(page);
    if (newest) await expect(card(page, newest.filename)).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Add a document to get started" })).toBeVisible();
    await expectNoHorizontalScroll(page, 320, "main#main");
  });
});

test.describe("My documents as the Operator", () => {
  test.use({ storageState: authFile("operator"), viewport: { width: 1280, height: 800 } });

  test("is read-only apart from Try again (§2.3, §6)", async ({ page }) => {
    const { total } = await documentCounts(page);
    await openLibrary(page);
    await expect(page.getByRole("button", { name: /^(Add files|Upload)$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose a file" })).toHaveCount(0);

    if (total === 0) {
      await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
      return;
    }
    const firstRow = tableRows(page).first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole("button", { name: /^Actions for / }).click();
    const menu = page.getByRole("menu", { name: /^Actions for / });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Download" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
});

test.describe("My documents as the Auditor", () => {
  test.use({ storageState: authFile("auditor") });

  test("explains the role and points at the console (§6)", async ({ page }) => {
    await page.goto("/library");
    await expect(
      page.getByRole("heading", { level: 1, name: "Auditors see file details in the admin console" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Documents", exact: true })).toHaveAttribute("href", "/documents");
    await expect(table(page)).toHaveCount(0);
  });
});
