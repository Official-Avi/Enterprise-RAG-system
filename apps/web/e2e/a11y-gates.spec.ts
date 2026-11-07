import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  CHAT_ID,
  CHAT_TITLE,
  EMPTY_COLLECTION,
  FAILED_FILE,
  FULL_COLLECTION,
  GRANTEE_EMAIL,
  holdUploads,
  mockAddMember,
  mockChat,
  mockConsole,
  mockDocuments,
  mockFirstQuestion,
  mockNoDocuments,
  mockReadingDocuments,
  RACK_ID,
  READY_FILE,
  rejectUploads,
} from "./fixtures";
import { authFile, demoInfo, expectNoAxeViolations, PERSONA_KEYS, PERSONAS } from "./helpers";

// The accessibility release gates (spec §9, M19). Part 1 is axe, §9 #1: zero violations on /, /login,
// /ask (empty, answered, sheet open), /library (uploading, failed row) and every dialog, in both
// themes. Part 2 is the keyboard behaviour axe can't see: §9 #3, #6, #7, #10, #11 and #18.
//
// States the live data can't be relied on to show use the fixed responses in fixtures.ts. Nothing
// is submitted to the server, so these tests leave no data behind.

// Motion settled at once, so axe measures final colours rather than a transition's midpoint.
test.use({ contextOptions: { reducedMotion: "reduce" } });

const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1100, height: 800 };
const PHONE = { width: 390, height: 844 };

const questionBox = (page: Page) => page.getByRole("textbox", { name: "Your question" });
const scopeChip = (page: Page) => page.getByRole("button", { name: /^Searching:/ });
const sourcesDialog = (page: Page) => page.getByRole("dialog", { name: /^Sources \(/ });
/** The inline chip in the newest answer, which is the answer the sources panel shows. */
const lastChip = (page: Page) => page.getByRole("main").getByRole("button", { name: /^Source 1:/ }).last();
const addFiles = (page: Page) => page.getByRole("main").getByRole("button", { name: "Add files", exact: true });

async function openChat(page: Page): Promise<void> {
  await mockDocuments(page);
  await mockChat(page);
  await page.goto(`/ask/c/${CHAT_ID}`);
  await expect(lastChip(page)).toBeVisible();
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/library");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "My documents" })).toBeVisible();
}

async function pickFile(page: Page, opener: Locator, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await opener.click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e-a11y") });
}

/** The first Actions control for a chat in Recent. It only fades in on hover or focus. */
async function openChatRowMenu(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Recent chats" }).getByRole("button", { name: `Actions for ${CHAT_TITLE}` }).click();
  await expect(page.getByRole("menu", { name: `Actions for ${CHAT_TITLE}` })).toBeVisible();
}

async function openFailedRowMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${FAILED_FILE}` }).first().click();
  await expect(page.getByRole("menu", { name: `Actions for ${FAILED_FILE}` })).toBeVisible();
}

// ---------- every console dialog ----------

interface ConsoleDialog {
  label: string;
  path: string;
  /** Presses whatever opens the dialog. */
  open: (page: Page) => Promise<void>;
  dialog: string;
  /** §9 #10's initial focus: the first field, the safe choice or the heading. */
  focus: (dialog: Locator) => Locator;
}

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const firstField = (dialog: Locator) => dialog.locator("input, select, textarea").first();
const safeChoice = (name: string) => (dialog: Locator) => dialog.getByRole("button", { name, exact: true });
const heading = (dialog: Locator) => dialog.getByRole("heading").first();

const CONSOLE_DIALOGS: ConsoleDialog[] = [
  {
    label: "New collection",
    path: "/collections",
    open: (page) => button(page, "New collection"),
    dialog: "New collection",
    focus: firstField,
  },
  {
    label: "Edit collection",
    path: "/collections",
    open: (page) => button(page, `Edit ${EMPTY_COLLECTION}`),
    dialog: "Edit collection",
    focus: firstField,
  },
  {
    label: "Delete an empty collection",
    path: "/collections",
    open: (page) => button(page, `Delete ${EMPTY_COLLECTION}`),
    dialog: "Delete this collection?",
    focus: safeChoice("Cancel"),
  },
  {
    label: "Delete a collection with documents",
    path: "/collections",
    open: (page) => button(page, `Delete ${FULL_COLLECTION}`),
    dialog: "This collection isn't empty",
    focus: safeChoice("Cancel"),
  },
  {
    label: "Manage access",
    path: "/collections",
    open: async (page) => {
      await button(page, `Manage access to ${EMPTY_COLLECTION}`);
      await expect(page.getByRole("button", { name: `Revoke access for ${GRANTEE_EMAIL}` })).toBeVisible();
    },
    dialog: `Access to ${EMPTY_COLLECTION}`,
    // The grants load after it opens, above the field that was first at that moment.
    focus: (dialog) => dialog.getByLabel("Member"),
  },
  {
    label: "Revoke access",
    path: "/collections",
    open: async (page) => {
      await button(page, `Manage access to ${EMPTY_COLLECTION}`);
      await button(page, `Revoke access for ${GRANTEE_EMAIL}`);
    },
    dialog: "Revoke access?",
    focus: safeChoice("Cancel"),
  },
  {
    label: "Job details",
    path: "/jobs",
    open: async (page) => {
      await page.getByRole("table").getByRole("button").first().click();
      await expect(page.getByText("Stage timeline")).toBeVisible();
    },
    dialog: "Job 00000000",
    focus: heading,
  },
  {
    label: "Cancel job",
    path: "/jobs",
    open: async (page) => {
      await page.getByRole("table").getByRole("button").first().click();
      await button(page, "Cancel job");
    },
    dialog: "Cancel this job?",
    focus: safeChoice("Keep job"),
  },
  {
    label: "Delete document",
    path: "/documents",
    open: (page) => button(page, `Delete ${READY_FILE}`),
    dialog: "Delete this document?",
    focus: safeChoice("Cancel"),
  },
  {
    label: "Evaluation run",
    path: "/evaluation",
    open: async (page) => {
      await page.getByRole("table").getByRole("button").first().click();
      await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
    },
    dialog: "Evaluation run",
    focus: heading,
  },
  {
    label: "Register rack",
    path: "/infrastructure",
    open: (page) => button(page, "Register rack"),
    dialog: "Register logical rack",
    focus: firstField,
  },
  {
    label: "Register workload",
    path: "/infrastructure",
    open: (page) => button(page, "Register workload"),
    dialog: "Register logical workload",
    focus: firstField,
  },
  {
    label: "Add node",
    path: `/infrastructure/${RACK_ID}`,
    open: (page) => button(page, "Add node"),
    dialog: "Add node to e2e-a11y-rack",
    focus: firstField,
  },
  {
    label: "Add member",
    path: "/admin/users",
    open: (page) => button(page, "Add member"),
    dialog: "Add workspace member",
    focus: firstField,
  },
];

async function openConsoleDialog(page: Page, entry: ConsoleDialog): Promise<Locator> {
  await mockConsole(page);
  await page.goto(entry.path);
  await entry.open(page);
  const dialog = page.getByRole("dialog", { name: entry.dialog });
  await expect(dialog).toBeVisible();
  return dialog;
}

// ---------- part 1: axe ----------

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe, ${colorScheme} theme (§9 #1)`, () => {
    test.use({ colorScheme });

    test.describe("public pages", () => {
      test("/", async ({ page, request }) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if ((await demoInfo(request)).enabled) {
          await expect(page.locator("#demo").getByRole("button", { name: /^Continue as / }).first()).toBeVisible();
        }
        await expectNoAxeViolations(page, "the landing page");
      });

      test("/ with a file turned down", async ({ page }) => {
        await page.goto("/");
        const hero = page.getByRole("region", { name: /^Ask your documents\./ });
        await hero.locator('input[type="file"]').setInputFiles({
          name: "e2e-a11y-old.doc",
          mimeType: "application/msword",
          buffer: Buffer.from("e2e-a11y"),
        });
        await expect(hero.getByRole("alert")).toBeVisible();
        await expectNoAxeViolations(page, "the landing page rejecting a file");
      });

      test("/login", async ({ page, request }) => {
        await page.goto("/login");
        await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
        if ((await demoInfo(request)).enabled) {
          await expect(page.getByRole("region", { name: "Use a demo account" }).getByRole("button").first()).toBeVisible();
        }
        await expectNoAxeViolations(page, "the login page");
      });
    });

    test.describe("/ask empty, per persona", () => {
      for (const key of PERSONA_KEYS) {
        test.describe(PERSONAS[key].title, () => {
          test.use({ storageState: authFile(key) });

          test(`/ask as the ${PERSONAS[key].title}`, async ({ page }) => {
            await page.goto("/ask");
            await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
            await expectNoAxeViolations(page, `empty /ask as the ${PERSONAS[key].title}`);
          });
        });
      }
    });

    test.describe("/ask as the Engineer", () => {
      test.use({ storageState: authFile("engineer"), viewport: DESKTOP });

      test("with no documents yet", async ({ page }) => {
        await mockNoDocuments(page);
        await page.goto("/ask");
        await expect(page.getByRole("heading", { level: 1, name: "Add a document to get started" })).toBeVisible();
        await expectNoAxeViolations(page, "/ask with no documents");
      });

      test("with a file getting ready", async ({ page }) => {
        await mockReadingDocuments(page);
        await page.goto("/ask");
        await expect(scopeChip(page)).toContainText("getting ready");
        await expectNoAxeViolations(page, "/ask with a file getting ready");
      });

      test("with an attachment uploading", async ({ page }) => {
        await mockDocuments(page);
        const release = await holdUploads(page);
        await page.goto("/ask");
        await pickFile(page, page.locator("form").filter({ has: questionBox(page) }).getByRole("button", { name: "Add files", exact: true }), "e2e-a11y-upload.pdf");
        await expect(page.getByRole("list", { name: "Attached files" }).getByRole("listitem")).toBeVisible();
        await expectNoAxeViolations(page, "/ask with an attachment uploading");
        await release();
      });

      test("the scope popover", async ({ page }) => {
        await mockDocuments(page);
        await page.goto("/ask");
        await scopeChip(page).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expectNoAxeViolations(page, "the scope popover");
      });

      test("answered, with chips, quotes and a not-found card", async ({ page }) => {
        await openChat(page);
        await expectNoAxeViolations(page, "an answered chat");
      });

      test("sources docked at 1440px", async ({ page }) => {
        await openChat(page);
        await lastChip(page).click();
        await expect(page.getByRole("complementary", { name: "Sources" })).toBeVisible();
        await expectNoAxeViolations(page, "the docked sources panel");
      });

      test("the Recent chat menu", async ({ page }) => {
        await openChat(page);
        await openChatRowMenu(page);
        await expectNoAxeViolations(page, "the Recent chat menu");
      });

      test("the delete chat dialog", async ({ page }) => {
        await openChat(page);
        await openChatRowMenu(page);
        await page.getByRole("menuitem", { name: "Delete" }).click();
        await expect(page.getByRole("dialog", { name: "Delete chat?" })).toBeVisible();
        await expectNoAxeViolations(page, "the delete chat dialog");
      });

      test("the demo persona menu", async ({ page, request }) => {
        test.skip(!(await demoInfo(request)).enabled, "Demo mode is off on this server, so there is no demo strip");
        await mockDocuments(page);
        await page.goto("/ask");
        await page.getByRole("region", { name: "Demo account" }).getByRole("button", { name: "Switch persona" }).click();
        await expect(page.getByRole("menu", { name: "Switch persona" })).toBeVisible();
        await expectNoAxeViolations(page, "the demo persona menu");
      });
    });

    test.describe("/ask at 1100px", () => {
      test.use({ storageState: authFile("engineer"), viewport: LAPTOP });

      test("the sources drawer", async ({ page }) => {
        await openChat(page);
        await lastChip(page).click();
        await expect(sourcesDialog(page)).toBeVisible();
        await expectNoAxeViolations(page, "the sources drawer");
      });
    });

    test.describe("/ask on a phone", () => {
      test.use({ storageState: authFile("engineer"), viewport: PHONE });

      test("answered", async ({ page }) => {
        await openChat(page);
        await expectNoAxeViolations(page, "an answered chat on a phone");
      });

      test("the sources sheet", async ({ page }) => {
        await openChat(page);
        await lastChip(page).click();
        await expect(sourcesDialog(page)).toBeVisible();
        await expectNoAxeViolations(page, "the sources sheet");
      });

      test("the scope sheet", async ({ page }) => {
        await mockDocuments(page);
        await page.goto("/ask");
        await scopeChip(page).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expectNoAxeViolations(page, "the scope sheet");
      });

      test("the sidebar drawer", async ({ page }) => {
        await mockDocuments(page);
        await page.goto("/ask");
        await page.getByRole("button", { name: "Open sidebar" }).click();
        await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
        await expectNoAxeViolations(page, "the sidebar drawer");
      });
    });

    test.describe("/library as the Engineer", () => {
      test.use({ storageState: authFile("engineer"), viewport: { width: 1280, height: 800 } });

      test("a failed row", async ({ page }) => {
        await mockDocuments(page);
        await openLibrary(page);
        await expect(page.getByRole("table")).toContainText(FAILED_FILE);
        await expectNoAxeViolations(page, "/library with a failed row");
      });

      test("an uploading row", async ({ page }) => {
        await mockDocuments(page);
        const release = await holdUploads(page);
        await openLibrary(page);
        await pickFile(page, addFiles(page), "e2e-a11y-upload.pdf");
        await expect(page.getByRole("row").filter({ hasText: "e2e-a11y-upload.pdf" })).toContainText("Uploading");
        await expectNoAxeViolations(page, "/library with an uploading row");
        await release();
      });

      test("a row the server turned down", async ({ page }) => {
        await mockDocuments(page);
        await rejectUploads(page, "e2e-a11y-rejected.pdf");
        await openLibrary(page);
        await pickFile(page, addFiles(page), "e2e-a11y-rejected.pdf");
        await expect(page.getByRole("row").filter({ hasText: "e2e-a11y-rejected.pdf" })).toContainText("Not accepted");
        await expectNoAxeViolations(page, "/library with a rejected row");
      });

      test("with no documents yet", async ({ page }) => {
        await mockNoDocuments(page);
        await openLibrary(page);
        await expect(page.getByRole("heading", { name: "Add a document to get started" })).toBeVisible();
        await expectNoAxeViolations(page, "/library with no documents");
      });

      test("the row menu", async ({ page }) => {
        await mockDocuments(page);
        await openLibrary(page);
        await openFailedRowMenu(page);
        await expectNoAxeViolations(page, "the library row menu");
      });

      test("the delete dialog", async ({ page }) => {
        await mockDocuments(page);
        await openLibrary(page);
        await openFailedRowMenu(page);
        await page.getByRole("menuitem", { name: "Delete" }).click();
        await expect(page.getByRole("dialog", { name: `Delete ${FAILED_FILE}?` })).toBeVisible();
        await expectNoAxeViolations(page, "the library delete dialog");
      });
    });

    test.describe("/library on a phone", () => {
      test.use({ storageState: authFile("engineer"), viewport: PHONE });

      test("a failed card", async ({ page }) => {
        await mockDocuments(page);
        await openLibrary(page);
        await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: FAILED_FILE })).toBeVisible();
        await expectNoAxeViolations(page, "/library cards with a failed row");
      });
    });

    test.describe("/library as the Admin", () => {
      test.use({ storageState: authFile("admin"), viewport: { width: 1280, height: 800 } });

      test("a failed row with Details for admins", async ({ page }) => {
        await mockDocuments(page);
        await openLibrary(page);
        await page.getByRole("table").getByText("Details for admins").click();
        await expect(page.getByRole("table")).toContainText("NO_EXTRACTABLE_TEXT");
        await expectNoAxeViolations(page, "/library with admin details open");
      });
    });

    test.describe("console dialogs as the Admin", () => {
      test.use({ storageState: authFile("admin"), viewport: { width: 1280, height: 800 } });

      for (const entry of CONSOLE_DIALOGS) {
        test(entry.label, async ({ page }) => {
          await openConsoleDialog(page, entry);
          await expectNoAxeViolations(page, `the ${entry.label} dialog`);
        });
      }

      test("Add member, one-time password panel", async ({ page }) => {
        await mockAddMember(page);
        await page.goto("/admin/users");
        await page.getByRole("button", { name: "Add member", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add workspace member" });
        await dialog.getByLabel("Email").fill("e2e-a11y-new@acme.example.com");
        await dialog.getByLabel("Display name").fill("e2e-a11y new");
        await dialog.getByRole("button", { name: "Add", exact: true }).click();
        await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
        await expectNoAxeViolations(page, "the one-time password panel");
      });
    });

    test.describe("console on a phone", () => {
      test.use({ storageState: authFile("admin"), viewport: PHONE });

      test("the navigation drawer", async ({ page }) => {
        await page.goto("/overview");
        await page.getByRole("button", { name: "Open navigation" }).click();
        await expect(page.getByRole("dialog", { name: "Console navigation" })).toBeVisible();
        await expectNoAxeViolations(page, "the console navigation drawer");
      });
    });
  });
}

// ---------- part 2: keyboard and structure ----------

test.describe("skip links on /ask keep the draft (§9 #6)", () => {
  test.use({ storageState: authFile("engineer"), viewport: DESKTOP });

  test("Skip to question box focuses the box", async ({ page }) => {
    await mockDocuments(page);
    await page.goto("/ask");
    const box = questionBox(page);
    await box.fill("e2e-a11y draft");
    await page.getByRole("link", { name: "Skip to question box" }).focus();
    await page.keyboard.press("Enter");
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("e2e-a11y draft");
  });

  test("Skip to main content focuses main", async ({ page }) => {
    await mockDocuments(page);
    await page.goto("/ask");
    await questionBox(page).fill("e2e-a11y draft");
    await page.getByRole("link", { name: "Skip to main content" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
    await expect(questionBox(page)).toHaveValue("e2e-a11y draft");
  });
});

test.describe("landmarks at desktop width (§9 #18)", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 1280, height: 800 } });

  for (const path of ["/ask", "/library"]) {
    test(`${path} has a banner outside main`, async ({ page }) => {
      await mockDocuments(page);
      await page.goto(path);
      await expect(page.locator("main#main")).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();
    });
  }

  test("each turn is an article with a sr-only h3, and the transcript is not a live region", async ({ page }) => {
    await openChat(page);
    const articles = page.getByRole("article");
    await expect(articles.first().getByRole("heading", { level: 3, name: "You asked" })).toBeAttached();
    await expect(articles.nth(1).getByRole("heading", { level: 3, name: "Answer" })).toBeAttached();
    await expect(page.locator("main [aria-live], main [role='log']")).toHaveCount(0);
  });
});

test.describe("one announcement per answer (§9 #2, #3)", () => {
  test.use({ storageState: authFile("engineer"), viewport: DESKTOP });

  test("says Answer ready once, without the question or a percentage", async ({ page }) => {
    const question = "e2e-a11y how long are backups kept?";
    await mockDocuments(page);
    await mockFirstQuestion(page, question);
    await page.goto("/ask");
    await expect(page.locator("#sr-announcer")).toHaveAttribute("role", "status");
    await page.evaluate(() => {
      const said: string[] = [];
      Object.assign(window, { __said: said });
      new MutationObserver(() => {
        const text = document.getElementById("sr-announcer")?.textContent ?? "";
        if (text) said.push(text);
      }).observe(document.getElementById("sr-announcer") as HTMLElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });

    await questionBox(page).fill(question);
    await questionBox(page).press("Enter");
    await expect(lastChip(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/ask/c/${CHAT_ID}$`));

    const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
    expect(said.filter((text) => /Answer ready/.test(text))).toHaveLength(1);
    expect(said.join(" ")).not.toContain(question);
    expect(said.join(" ")).not.toContain("%");
  });
});

// §9 #7 at each of the three layouts in §5.7.
for (const { layout, viewport } of [
  { layout: "docked panel at 1440px", viewport: DESKTOP },
  { layout: "drawer at 1100px", viewport: LAPTOP },
  { layout: "sheet at 390px", viewport: PHONE },
]) {
  test.describe(`citation chips, ${layout} (§9 #7)`, () => {
    test.use({ storageState: authFile("engineer"), viewport });

    test("Enter focuses the source card; Back to answer returns to the chip", async ({ page }) => {
      await openChat(page);
      const chip = lastChip(page);
      await chip.focus();
      await page.keyboard.press("Enter");
      const cardHeading = page.locator('[data-marker="1"] [data-card-heading]');
      await expect(cardHeading).toBeFocused();
      await expect(cardHeading).toContainText(READY_FILE);

      await page.getByRole("button", { name: "Back to answer" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-marker="1"]')).toBeHidden(); // a closed sheet stays mounted
      await expect(chip).toBeFocused();
    });

    test("Esc closes the sources and returns to the chip", async ({ page }) => {
      await openChat(page);
      const chip = lastChip(page);
      await chip.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-marker="1"] [data-card-heading]')).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-marker="1"]')).toBeHidden(); // a closed sheet stays mounted
      await expect(chip).toBeFocused();
    });
  });
}

test.describe("sources drawer (§5.7, §9 #10, #11)", () => {
  test.use({ storageState: authFile("engineer"), viewport: LAPTOP });

  test("has a visible Close, and the backdrop closes it", async ({ page }) => {
    await openChat(page);
    const chip = lastChip(page);
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(sourcesDialog(page).getByRole("button", { name: "Close", exact: true })).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(sourcesDialog(page)).toBeHidden();
    await expect(chip).toBeFocused();
  });
});

test.describe("sources sheet (§5.7, §9 #10, #11)", () => {
  test.use({ storageState: authFile("engineer"), viewport: PHONE });

  async function openSheet(page: Page): Promise<Locator> {
    await openChat(page);
    const chip = lastChip(page);
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(sourcesDialog(page)).toBeVisible();
    return chip;
  }

  test("pages through the sources and keeps focus on a pager button at either end", async ({ page }) => {
    await openSheet(page);
    const sheet = sourcesDialog(page);
    await expect(sheet).toContainText("1 of 2");
    const next = sheet.getByRole("button", { name: "Next source" });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toContainText("2 of 2");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
  });

  test("the Close button closes it and returns to the chip", async ({ page }) => {
    const chip = await openSheet(page);
    await sourcesDialog(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(sourcesDialog(page)).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test("the backdrop closes it", async ({ page }) => {
    await openSheet(page);
    await page.mouse.click(10, 10);
    await expect(sourcesDialog(page)).toBeHidden();
  });

  test("browser Back closes it and stays on the chat", async ({ page }) => {
    await openSheet(page);
    await page.goBack();
    await expect(sourcesDialog(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/ask/c/${CHAT_ID}$`));
  });
});

test.describe("workspace dialogs (§9 #10)", () => {
  test.use({ storageState: authFile("engineer"), viewport: { width: 1280, height: 800 } });

  test("library delete: Cancel has focus; Esc closes and returns to the row menu button", async ({ page }) => {
    await mockDocuments(page);
    await openLibrary(page);
    await openFailedRowMenu(page);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: `Delete ${FAILED_FILE}?` });
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Actions for ${FAILED_FILE}` }).first()).toBeFocused();
  });

  test("chat delete: Cancel has focus; Esc closes and returns to the row menu button", async ({ page }) => {
    await openChat(page);
    await openChatRowMenu(page);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete chat?" });
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Actions for ${CHAT_TITLE}` })).toBeFocused();
  });
});

test.describe("console dialogs (§9 #10)", () => {
  test.use({ storageState: authFile("admin"), viewport: { width: 1280, height: 800 } });

  for (const entry of CONSOLE_DIALOGS) {
    test(`${entry.label}: initial focus, and Esc closes it`, async ({ page }) => {
      const dialog = await openConsoleDialog(page, entry);
      await expect(entry.focus(dialog)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    });
  }

  test("Esc on a form dialog returns focus to the button that opened it", async ({ page }) => {
    await mockConsole(page);
    await page.goto("/collections");
    const opener = page.getByRole("button", { name: "New collection", exact: true });
    await opener.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New collection" })).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
