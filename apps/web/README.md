# RackFlow AI — web console

Next.js (App Router) + TypeScript + Tailwind CSS. All pages are client-rendered and call the API
through a same-origin rewrite (`/api/*` → `API_PROXY_TARGET`, default `http://127.0.0.1:8000`),
so the HttpOnly session cookie never crosses origins. State-changing requests send the
`X-RackFlow-CSRF` header.

```bash
npm ci
npm run dev        # http://localhost:3000 (API must be running on 127.0.0.1:8000)
npm run lint && npx tsc --noEmit && npm run build
```

`API_PROXY_TARGET` is read when the app is **built** (Next.js resolves rewrites at build time);
the Dockerfile sets it to `http://api:8000` for Docker Compose.

Security notes: model answers, document text and filenames are rendered as plain text only
(no `dangerouslySetInnerHTML`, no Markdown links/images); navigation hiding is cosmetic — the
API enforces every permission.

## End-to-end tests (Playwright)

The suite runs against a live stack; it doesn't start one. You need the API on :8000 with
`DEMO_MODE` on, a worker, and this app on :3000 (see the root README).

### One-time setup

```bash
# From backend/: the demo accounts, and the simulated racks the Operator test opens.
# (seed-infra is separate from seed-demo. Without it, "opens a simulated rack" is skipped.)
rackflow-admin seed-demo
rackflow-admin seed-infra --tenant acme

# From apps/web/:
npm ci
npx playwright install chromium        # not needed on Windows, which uses the installed Edge
```

Some tests need Ready documents and a healthy search stack. Each one skips with a message saying
what is missing, so read the skips as well as the failures.

### Running

```bash
npm run test:e2e                       # everything
npm run test:a11y                      # only the accessibility gates
npx playwright test e2e/library.spec.ts -g "status chips"
```

`auth.setup.ts` runs first and signs each demo persona in once, saving the sessions to `e2e/.auth/`
(git-ignored). That is 4 of the 30 demo sign-ins allowed per minute per IP, so keep one run going at
a time; `roles.spec.ts` adds 6 more. Screenshots go to `test-results/screenshots/` (git-ignored).

| Variable | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://127.0.0.1:3000` | The app under test |
| `E2E_BROWSER_CHANNEL` | `msedge` on Windows, else Playwright's Chromium | Browser channel; `""` forces Playwright's Chromium |
| `E2E_PASSWORD` | none | The demo password, for the email and password sign-in tests |
| `E2E_PASSWORD_FILE` | `<repo>/.data/demo-password.txt` | A file holding that password, used when `E2E_PASSWORD` isn't set |

If neither variable gives a password and the default file is missing, the password test skips and
says so. A wrong `E2E_PASSWORD_FILE` path fails instead, because it is a mistake to fix. Never point
it at `Docs/demo-password.txt`: that file holds an old value and stays out of use.

### Accessibility gates

`e2e/a11y-gates.spec.ts` holds the release gates for spec §9 and M19:

- **axe** (`@axe-core/playwright`), §9 #1: zero violations for the `wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa` and `wcag22aa` rules, in the light and dark themes. It covers `/`, `/login`, `/ask`
  (empty for each persona, answered, each sources layout, scope picker), `/library` (failed,
  uploading and rejected rows) and every dialog in the workspace and the console. Best-practice
  rules aren't part of the gate.
- **Keyboard and structure**, §9 #2, #3, #6, #7, #10, #11, #18: skip links keep the draft, a chip's
  Enter moves to its card and Back to answer returns, each dialog's initial focus, Esc, backdrop and
  browser Back on the sheet, landmarks, and one "Answer ready" announcement.

States the stack can't be relied on to show, like a failed row, use the fixed API responses in
`e2e/fixtures.ts`. The pages are real, and these tests submit nothing, so they leave no data behind.

`e2e/a11y.spec.ts` holds the remaining §9 checks: first Tab stops, target sizes and reduced motion.

### Test data

`ask.spec.ts` and `engineer-journey.spec.ts` upload real files (`e2e-*.md`, `zephyr-*.md`) and ask real
questions as the Engineer, and leave those documents and chats behind. Delete them from My documents
after a run on a stack you are demoing from.
