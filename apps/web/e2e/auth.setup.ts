import { test as setup } from "@playwright/test";
import { authFile, PERSONA_KEYS, PERSONAS, signIn } from "./helpers";

// Runs before every spec (the "setup" project in playwright.config.ts). Each persona signs in
// once, through its demo card when the server offers it, and specs reuse the saved session with
// `test.use({ storageState: authFile(key) })`.
//
// Tests that sign out, exit the demo or switch persona sign in fresh instead, so they never end
// a session other tests rely on.
for (const key of PERSONA_KEYS) {
  setup(`sign in as the ${PERSONAS[key].title} demo persona`, async ({ page }) => {
    await signIn(page, key);
    await page.context().storageState({ path: authFile(key) });
  });
}
