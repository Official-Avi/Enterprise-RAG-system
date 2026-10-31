# RackFlow AI: UI Design Spec (v1)

Status: approved for build, 2026-10-29. Sources: 22 specialist reports, plus the chatpdf.com, Atlas and current-app studies (§14).

Tags: **FE** frontend, **BE** backend work required. Effort: **S** ≤ 1 day, **M** 2–4 days, **L** ≥ 5 days.

Every BE item comes with a FE fallback that works on today's API.

---

## 1. Design principles

1. **The tool is the hero.** Where to drop a file and where to type a question must be obvious within 2 seconds on every screen.
2. **File first, sign-in second.** A dropped file or typed question is never lost to a login step.
3. **Every answer shows its proof.** Numbered sources lead to the exact passage and page. "Not found" is a calm, honest result.
4. **Plain words in the workspace.** Use Ready, Reading and Not found in your documents. Pipeline vocabulary stays in the admin console.
5. **Hide what a role can never use; explain what people try anyway.** No dead button without a reason.
6. **Built for projectors and shared accounts.** Readable at 1280×720, demo state always visible, no tours, no auto-opened history.
7. **Quiet motion, honest progress.** Motion only signals state. No fake percentages, no fake typing.

---

## 2. Information architecture

### 2.1 Route map

Use **one root layout**. Separate root layouts force full reloads and lose the in-memory dropped file.

| Group | Route | Purpose | Requires |
|---|---|---|---|
| `(marketing)` | `/` | Landing; static Server Component with 2 client islands | public |
| | `/login` | Email sign-in plus demo cards | public |
| `(workspace)` new | `/ask` | New chat | `chat:use` |
| | `/ask/c/[id]` | Saved chat. One `ask/[[...slug]]/page.tsx`, with the URL set via `history.replaceState`, so the page never unmounts mid-request | `chat:use` |
| | `/library` | "My documents" | `collection:read` and (`chat:use` or `document:upload`) |
| `(app)` console, URLs unchanged | `/overview` `/collections` `/documents[/id]` `/inspector` `/jobs` `/workers` `/models` `/evaluation` `/infrastructure` `/admin/users` `/admin/audit` `/admin/settings` | Admin console | Existing NAV permissions |
| redirect | `/chat` → `/ask` (permanent, `next.config.ts`) | | |

### 2.2 Post-login landing

Reuse `homePath(permissions)` from `Shell.tsx` after demo login, email login, persona switch, and for the logo link.

| Role | Lands on |
|---|---|
| org_admin, engineer, operator | `/ask` (they have `chat:use`) |
| auditor | `/overview` (the first console page it can use) |

Honour `?next=` only when it passes `safeNext()` and the role can open that route.

### 2.3 What each role sees

| Surface | org_admin | engineer | operator | auditor |
|---|---|---|---|---|
| `/ask` (chat, history, scope, sources) | ✓ | ✓ | ✓ | Explained full-page state (§5.9) |
| Attach, "Add files", drag-to-upload | ✓ | ✓ | **Hidden**; dragging shows an explanation overlay | – |
| `/library` | upload, delete, retry | upload, delete, retry | read-only plus "Try again" | Explained state |
| "Admin console" link | ✓ | **✗** | ✓ | already in the console |
| "Back to Ask" link in the console | ✓ | ✓ | ✓ | ✗ |

**Admin console link rule:** show it when permissions include any of `ops:read`, `audit:read`, `user:read` or `settings:manage`. Engineers ("no ops pages") don't see it. Direct URLs still obey the API; the UI is not the security boundary.

---

## 3. Landing page (`/`), chatpdf-style

**Shape:**
- One centred column, max 840px (the demo section is 1040px). Normal page scroll, no sidebar.
- Sections 112px apart on desktop, 72px on mobile. 16px gutters below 640px.
- Total height about 4 viewports at 1280×720.

**Static rule:** no `cookies()`, `headers()`, `searchParams` or `useSearchParams()`. Only `HeroUploadCard` and `DemoPersonaCards` are client islands. Persona data is fetched client-side after hydration. CI asserts that `next build` marks `/` as Static.

### 3.0 Top bar

- **Frame:** 56px, sticky, gains a bottom border after 8px of scroll. Container 1120px.
- **Left:** 32px black RAG logo and "RackFlow AI" (16/600). In dark mode the logo gets a 1px `--border-strong` ring.
- **Centre** (hidden below 768px): "How it works", "Features", "Questions".
- **Right:**
  - Signed out: ghost "Sign in", then a teal pill "Try a demo" (40px, scrolls to #demo; hidden when demo mode is off).
  - Signed in (the island calls `GET /auth/me` with `noAuthRedirect`): a teal pill "Open workspace" → `homePath`.

### 3.1 Hero

- **H1** (display scale, centred, two lines max, `text-wrap: balance`): "Ask your documents. **See the exact page.**" The second sentence is in `--accent`.
- **Lede** (18/28, muted, max-w 600px, 12px below the H1): "Upload a PDF, Word or text file and ask in plain words. Every answer quotes the passage and page it came from."
- **Upload card**, 32px below the lede:
  - Frame: max-w 840px, `--panel`, 1px `--border`, radius 16px, padding 16/20/20, **no shadow**.
  - Glow behind the card (gives depth): an 896×420px layer offset 50px up, `blur(48px)`, made of a teal radial `rgb(15 107 102/.14)` and a warm radial `rgb(217 160 60/.10)`. Half opacity in dark mode.
  - **Subline** (18/28 600, centred), with a 16px file-type tile before each word: "PDF · Word · Text · Markdown · Scanned PDFs".
  - **Two panels**, 16px below the subline: grid `7fr 5fr`, gap 16px, min-h 200px. Stacked below 768px, with the dropzone at min-h 180px.
    - **Dropzone (left):**
      - Frame: `accent-soft/50`, radius 12px. A dashed SVG border (1.5px, dash `4 4`, `--dropzone-border`).
      - Contents: a 40px icon well, then "Drag a file here" (16/600), "or", and an outline button **"Choose a file"** (44px, radius 8). Below that, 13px muted: "Up to 25 MB each · 20 at a time".
      - Markup: the zone is a `<label>` wrapping a hidden `<input type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown">`.
      - Hover: the fill turns `accent-soft`, the dash goes solid teal and the button fills teal (150ms colour only).
      - Touch (`pointer: coarse`, CSS swap): "Tap to choose a file", with a full-width 48px button.
    - **Ask box (right):**
      - Frame: 1px `--border-strong`, radius 12, padding 16.
      - Textarea: label "Ask a question" (sr-only), 16/24, placeholder "Or ask a question, e.g. What does the backup policy say about retention?" (verify against the seeded corpus).
      - Footer, 13px muted: "Uses the demo documents · press Enter" with a 32px teal send button. Demo off: "Sign in first · press Enter".
- **Privacy line** (13px muted, lock icon, 12px under the card):
  - Demo on: "Demo files go to a shared workspace on this server. Please don't upload anything private."
  - Demo off: "Files are stored on the server running RackFlow."
- **Fact strip**, 40px below: three items, each a 20px teal icon, a 15/600 title and a 13px muted line.
  - "Runs on your server": "Your files stay where RackFlow is installed."
  - "Every answer cites its page": "Click a number to read the quote."
  - "Reads scanned PDFs": "Text recognition is built in."
- **Fold tests:**
  - 1280×720: the whole card is visible.
  - 1366×768: the demo divider is visible too.
  - 390×664: the dropzone and ask box are visible.

### 3.2 Hero flow (`useHeroUpload` reducer)

The dropped `File[]` stays in state through every step, so every error can retry without re-picking the file.

**Order of operations:**
1. Validate type, size, emptiness and folder in the browser. **No network call before this.**
2. Call `GET /auth/me` with `noAuthRedirect`. If the session can upload, skip to step 4.
3. If demo mode is on, `POST /auth/demo {persona:"engineer"}`. Always the least-privileged uploader; never Admin.
4. **Ensure "My documents".**
   - Look in `GET /collections` for "My documents" with `access_level` write or manage.
   - If there is none, `POST /collections {name:"My documents"}`.
   - Names are unique per tenant, so on `409 COLLECTION_NAME_TAKEN` create "My documents · {display_name}" instead.
   - **BE (SHOULD):** `POST /me/inbox` returns or creates it in one call.
5. Upload with the existing XHR `uploadFiles()` (field `files`) to `/collections/{id}/documents`.
6. Collect the non-rejected item ids (duplicates included) and `router.push('/ask?doc=<id>[,<id>]')`. Use client navigation only.

| State | Card shows | Copy | Actions |
|---|---|---|---|
| dragging | Full-viewport overlay (§5.5 style) plus the zone in its hover state | "Drop your file to start" / "PDF, Word, text or Markdown · up to 25 MB" | – |
| rejected_type | Zone border `--bad`, alert icon, `role="alert"` | "That file type isn't supported. Use a PDF, Word (.docx), text or Markdown file. Scanned PDFs work too." For .doc: "Older Word files (.doc) aren't supported. Save the file as .docx in Word." For images: "Images aren't supported yet. Put them in a PDF first." | Choose another file |
| rejected_size | same | "report.pdf is 41.2 MB. The limit is 25 MB. Try compressing or splitting it." | Choose another file |
| rejected_empty / folder | same | "This file is empty." / "Folders aren't supported. Drop the files inside instead." | Choose another file |
| mixed batch | The valid files upload; a note on `/ask` lists the rest | "2 files skipped: photo.png (not supported), big.pdf (over 25 MB)" | dismiss |
| signing_in | File row (type tile, name, size) above a checklist | "Opening the Engineer demo account" | Cancel |
| uploading | Step 1 checked; 4px teal `progressbar`; each step stays on screen ≥ 500ms | "Uploading report.pdf · 62%" | Cancel (aborts the XHR, keeps the file) |
| opening | Check icon | "Opening your chat…" | – |
| demo_off | Inline file row with Remove | "Sign in to ask about report.pdf" / "Your file stays in this tab until you sign in." | Sign in (client nav to `/login?next=/ask&resume=1`; the file stays in the pending store) |
| role_cannot_upload | Inline prompt (e.g. an operator session left open on the machine) | "You're signed in as Operator, and Operators can't upload documents." | Demo on: "Switch to Engineer and upload" (logout, demo login, continue) and Cancel. Demo off: "Sign in with another account" |
| rate_limited (429) | Amber note; countdown from `Retry-After` (fallback 20s), then an automatic retry | "Lots of people are using the demo right now. Trying again in 20s…" | Cancel |
| api_down | Red note | "Can't reach RackFlow. Check that the server is running." | Try again |
| persona_missing (404) | Falls back to demo_off | "The Engineer demo account isn't set up on this server." | Sign in |
| upload_failed | Red note; the file is kept | "Upload interrupted." | Try again |
| server_rejected | Red note with reason copy from §5.4 | e.g. "This doesn't look like a real PDF or Word file." | Choose another file |

- **During signing_in and uploading,** show 12px muted text under the card: "You're using a shared demo account. Others using this demo can see what you upload."
- **Live region:** announce "Signing in", "Uploading", "Upload complete, opening chat" and errors only. Never percentages.
- **Ask box:**
  - Demo on: Enter stores the question in the pending store, runs the Engineer demo login, and pushes `/ask`, which **sends it** (the user already pressed Enter).
  - Signed in: send directly.
  - Demo off: go to `/login?next=/ask`; after sign-in the question is restored into the composer **unsent**.
  - No Ready documents: `/ask` keeps the question in the composer and shows state A (§5.9).

### 3.3 Demo accounts (#demo)

- **Divider:** a 1px line with "or try a demo account" centred (14px muted), 48px below the fact strip.
- **H2:** "Try it with a demo account".
- **Sub:** "No sign-up and no password. Each account sees a different part of RackFlow."
- **Grid:** max-w 1040px; 4 columns at ≥ 1024px, 2 at 640px, 1 below; gap 16. Cards follow §4.1 in API order.
- **Footer:** 13px muted "Have your own account? **Sign in**".
- The section is hidden when `enabled:false`.

### 3.4 How it works (#how)

Three columns (stacked on mobile). Each has a 32px teal number circle, a 20/28 600 title, a 15/24 body, and a 120px static fragment built from real components with fixture data.

1. **"Add a file"**: "Drag it in or choose it. Most files are ready in under a minute." Fragment: a StatusPill stepping Waiting → Reading → Ready.
2. **"Ask a question"**: "Type it the way you'd ask a colleague." Fragment: the composer.
3. **"Check the source"**: "Every answer shows the passage and page it came from." Fragment: an answer line with chip `1` and a "handbook.pdf · p. 12" card.

### 3.5 Features (#features)

- **H2:** "Made for answers you can trust" (36px).
- **Grid:** 2×3 at 410px, gap 20. One column below 768px.
- **Card:** padding 32, radius 12, 1px border, `0 1px 4px rgb(0 0 0/.05)`. A 24px teal icon, title 20/28 600, body 14/24 muted, and a 180px picture panel (`--panel-2`, radius 8) built from real components with fixtures.

| Title | Body | Picture |
|---|---|---|
| Answers you can check | Every answer links to the exact passage and page. Click a number to read the quote. | Answer line plus a highlighted SourceCard |
| Reads scanned pages | Scanned PDFs are read with text recognition, so scans of paper work too. | Page thumbnail plus "Reading scanned pages" |
| Ask the way you talk | No keywords or filters. Type a question like you'd ask a person. | Composer |
| Says so when it can't find it | If your documents don't answer it, RackFlow tells you instead of guessing. | NotFoundCard |
| Four roles, one workspace | Admins, Engineers, Operators and Auditors each see only what their job needs. | Role chips |
| Every action is recorded | Sign-ins, uploads and setting changes are logged with who and when. | 3 audit rows |

### 3.6 Closing band

- **H2:** "Try it with your own file".
- A compact HeroUploadCard (dropzone only, min-h 120px), with the same flow.
- A link below: "or pick a demo account" → #demo.

### 3.7 Questions (#faq)

Native `<details>`: 820px, radius 12, `--panel-2`, 8px gap, summary min-h 56 (16/600), answer 15/24. **Items 1 and 2 are open by default.**

1. **What files can I use?** PDF, Word (.docx), plain text and Markdown, up to 25 MB and 500 pages each. Scanned PDFs work too: RackFlow reads them with text recognition (OCR).
2. **How long until I can ask?** Usually 5 to 60 seconds. You'll see Waiting, then Reading, then Ready. Scanned files take the longest.
3. **Does it make things up?** By default no AI model writes the answer: RackFlow quotes the passages that match your question. If an admin turns on Claude, Claude writes the answer from those passages, and every claim still links to its source. If nothing matches, it says so.
4. **Who can see my files?** People in your workspace whose role allows it. The demo accounts are shared, so anyone using the demo can see what you upload.
5. **Why can't Operators or Auditors upload?** Their jobs don't involve adding documents. Operators keep processing running and can ask questions. Auditors review the activity log and never see document content.
6. **Where does my data go?** Files are stored and searched on the server running RackFlow. In the default mode nothing is sent to an outside AI service. If Claude is turned on, only your question and the few matching passages go to Anthropic to write the answer.

Before shipping, verify items 3 and 6 against config: local fastembed, the extractive default, and Anthropic used only when enabled.

### 3.8 Footer

- **Columns:** four on desktop, two on mobile.
  - Brand: logo and "Ask your documents. See the source."
  - Product: How it works · Features · Questions
  - Try it: Demo accounts · Sign in
  - Help: Questions · Roles and permissions
- **Bottom row** (13px muted): "© 2026 RackFlow AI · v{APP_VERSION}". With demo mode on, add "· Demo mode is on. Demo accounts are shared."
- Link deployment docs, privacy or terms only once those pages exist.
- **Never on this page:** logos, user counts, testimonials, pricing, "Sign up", "Get started free", rotating words, video, app banners, purple gradients.

---

## 4. Demo access

### 4.1 Persona card

- **Element:** one `<button>`, radius 16, padding 20, min-h 236, 1px border, `--panel`.
- **Hover:** teal border, `shadow-md`, lift 2px (150ms). **Press:** `scale(.98)`.
- **Content, top to bottom:**
  1. A 40px initial avatar on `accent-soft`. Engineer also gets a "Start here" pill on the right.
  2. Title (18/26 600).
  3. `display_name · email` (12px muted, email in mono, truncated with a `title`).
  4. Summary (14/20).
  5. ≤ 3 "can" lines with a teal check (13/20).
  6. ≤ 2 "can't" lines with a muted minus and sr-only "Can't:". Admin shows "No limits".
  7. "Continue as {Title} →" (14/600 teal) over a 12px destination line: "Opens Ask" or "Opens the admin console".
- **Never** show a password.

**Final copy. BE (MUST, S): replace the `DEMO_PERSONAS` strings in `auth/demo.py`.**

| key | summary | can | cannot |
|---|---|---|---|
| engineer | Upload files and ask questions about them. | Upload files · Ask questions with cited answers · Make collections | Open the admin console |
| operator | Keeps file processing running smoothly. | Ask questions · Watch the processing queue · Retry failed files | Upload files |
| admin | Does everything, including people and settings. | Upload and ask · Manage users and roles · Change settings | – |
| auditor | Checks who did what, without seeing content. | Read the audit log · See file names and statuses | Open documents or ask questions |

**States:**
- **Loading:** 4 skeletons at 236px.
- **Signing in:** `aria-busy` on the clicked card. After 300ms a spinner appears with "Signing in as Engineer…". The other cards get `aria-disabled` and opacity .5.
- **Success:** announce "Signed in as Engineer", then `router.replace(homePath(perms))`.
- **429:** under the grid, "Too many demo sign-ins from this network. Try again in a minute." Re-enable after 60s.
- **Network or 5xx:** "Can't reach RackFlow. Check that the server is running." with "Try again".
- **Unseeded persona:** omitted; the grid reflows.
- **Current user's card:** a "You're here" pill, and the button reads "Back to workspace".

### 4.2 Login page

- **Frame:** centred card, max-w 440, radius 16, padding 32.
- **Header:** 40px logo, "RackFlow AI" (20/600), "Ask questions about your documents".
- **Demo block** (when enabled): "Use a demo account", then 4 compact 56px rows (avatar, title, summary, chevron) from the same component.
- **Divider:** "or sign in with email".
- **Form:**
  - Work email.
  - Password with a show toggle (`aria-pressed`).
  - A "Signing in to a specific workspace?" link that reveals the Workspace field.
  - A 44px "Sign in" button.
- **After sign-in:** `safeNext(next) ?? homePath`. With `resume=1`, take the pending file or question.

### 4.3 Demo indicator

- **Placement:** a 32px sticky strip above the header on **every signed-in page** (workspace and console). It **cannot be dismissed**. Markup: `role="region" aria-label="Demo account"`.
- **Colours:** light `#fff4d6` / `#5c4200` (8.58:1); dark `#3a2e0a` / `#f5d77a` (9.45:1).
- **Copy at ≥ 768px:** "**Demo account** · You're Priya Shah (Engineer) · Others using this demo see the same files and chats", plus "Switch persona ▾" and "Exit demo".
- **Copy below 768px:** "Demo · Engineer", plus "Switch" and "Exit".
- **Detection:**
  - FE now: `/auth/demo` is enabled and `me.email` matches a persona email.
  - **BE (SHOULD, S):** add `is_demo` and `persona_key` to `/auth/me`.

### 4.4 Switching persona

- **Menu** (320px, APG Menu Button): avatar, title, summary, and a check on the current persona.
- **On select:**
  1. `POST /auth/demo {persona}`.
  2. Reset the cached `me` and the API caches.
  3. `router.replace(homePath)` and `router.refresh()`.
  4. Polite toast: "You're now Operator. You can ask questions, but not upload."
- Target under 1s with no full reload. Show a spinner on the chosen row.
- **"Exit demo":** `POST /auth/logout`, then client nav to `/`.
- **BE (SHOULD, S):** revoke the previous session on demo login.
- **Deep link:** `/?role=auditor` only highlights that card. Never log in on a GET.

---

## 5. `/ask` workspace

### 5.1 Layout

| Zone | Spec |
|---|---|
| Demo strip | 32px, demo sessions only |
| Sidebar | 260px, `--bg`, 1px right border. Persistent at ≥ 1024px; below that a `<dialog>` drawer `w-[min(85vw,320px)]` |
| Header | 56px, sticky. Transparent at rest; once scrolled, `bg-panel/85 backdrop-blur` with a border |
| Message column | `max-w-[768px] mx-auto px-6` (`px-4` below 768px). The composer shares the column |
| Sources | 360px. Docked (pushes content) at ≥ 1280px; right `<dialog>` drawer from 1024 to 1279px; bottom sheet below 1024px |

**Shell:** `flex h-[var(--app-h,100dvh)] overflow-hidden`. The list is `flex-1 min-h-0 overflow-y-auto`. The composer is a normal flex child, **never `position:fixed`**. A `useVisualViewport()` hook sets `--app-h` for iOS Safari.

### 5.2 Sidebar (in order) and header

**Sidebar:**
1. **Top row, 56px:** 28px logo, "RackFlow AI" (15/600), and a collapse button (36px, Ctrl+Shift+S).
2. **"New chat":** full width, 40px, teal primary, pencil icon, tooltip "New chat (Ctrl+Shift+O)". It goes to `/ask`; no session is created yet.
3. **"Add files"** (upload roles only): a 36px row that opens the picker.
4. **"My documents":** a 36px row with a muted badge counting Ready documents.
5. **"Recent"** (12/600 muted, 16px gap above). Rows are 36px, 14/20, one truncated line with a `title`. The active row gets `accent-soft` and `aria-current="page"`.
6. **Footer** (border-top):
   - Demo note (12px): "Shared demo account: anyone using it sees these chats."
   - "Admin console" (gear icon, §2.3 rule, same tab).
   - A 52px user chip: 32px avatar, name (14/500), role (12px muted). Its menu: Switch persona (demo only) and Sign out.

**Header:**
- **Left:** below 1024px or when collapsed, a menu button (40px; 44px on mobile) and a New chat icon. After the first message, the chat title (15/500, max-w 420, truncated).
- **Right:** "Sources (3)" (`aria-expanded`, `aria-controls`), shown only when the selected answer has citations.
- No model picker.

### 5.3 Composer

- **Container:** the 768px column, radius 24, 1px `--border-strong`, `--panel`, `--elev-1`. On focus-within: `--elev-3` and a 40% teal border. Padding 12/12/8.
- **Rows:**
  - Optional chips row.
  - `<textarea rows=1>`: 16/26, `field-sizing-content`, max 200px then scroll, `enterkeyhint="send"`.
  - A 40px toolbar: [Attach] [Scope chip] … [Send].
- **Placeholder:** "Ask a question about your documents". With nothing Ready: "Add a document first, then ask anything about it".
- **Attach:** a labelled pill "Add files" (36px) until the first message, then a 36px paperclip icon (`aria-label="Attach files"`). Hidden for operators. Files pasted into the textarea are accepted.
- **Send:** a 36px teal circle. It uses `aria-disabled`, never `disabled`, while empty or pending. A spinner shows while a request is in flight.
- **Keys:**
  - Enter sends when `!shiftKey && !isComposing && keyCode !== 229` and `pointer: fine`.
  - Shift+Enter inserts a newline. Ctrl/Cmd+Enter always sends.
  - On touch, Enter inserts a newline.
  - Esc clears staged chips.
- **Hint** (12px muted, `aria-describedby`): "Enter to send · Shift+Enter for a new line".
- **Position:**
  - Empty chat on desktop: vertically centred, with an H1 "What would you like to know?" (28/36 600) 32px above and chips 12px below.
  - After the first send: the same component re-renders sticky at the bottom (`pb-4`, gradient from `--panel`), with no animation.
  - Mobile: always at the bottom.
- **Focus** stays in the textarea. The draft is cleared on success and restored on error.

### 5.4 Status vocabulary (`lib/status.ts`, the only source)

| Backend | Label | Sub-label | Tone, glyph | Action |
|---|---|---|---|---|
| uploading (XHR) | Uploading 42% | – | info, 2px bar | Cancel |
| `queued` | Waiting | "In line to be read". After 30s: "Other files are being read first" | neutral, clock | – |
| `processing` | Reading | "Usually under a minute". OCR stage: "Reading scanned pages". After 90s: "Taking longer than usual" | info, spinner | – |
| job `retry_wait` | Reading | "Hit a snag, trying again" | warn, spinner | – |
| `indexed` | Ready | "{n} pages" | ok, check | Ask about this |
| `failed` | Couldn't read | the plain reason | bad, triangle | Try again (`POST /documents/{id}/retry`) · Remove |
| `deleting` | Removing | – | neutral | – |
| `duplicate` (upload) | Already added | "Using the copy you already have" | neutral, copy icon | treated as success |
| `rejected` (upload) | Not accepted | the reason | bad, slash | Choose another file |

**Reason copy:**

| Code | Copy |
|---|---|
| FILE_TOO_LARGE | "Too big. The limit is 25 MB." |
| UNSUPPORTED_TYPE | "This file type isn't supported." |
| CONTENT_MISMATCH | "This doesn't look like a real PDF or Word file." |
| MACROS_NOT_ALLOWED | "Word files with macros aren't allowed. Save it as a normal .docx." |
| EMPTY_FILE / EMPTY_DOCUMENT | "This file is empty." |
| CORRUPT_FILE | "This file seems damaged. Try saving it again." |
| UNREADABLE_TEXT | "We couldn't find readable text, even with text recognition." |
| ARCHIVE_BOMB / ARCHIVE_TOO_COMPLEX | "This file is too complex to open safely." |
| QUOTA_EXCEEDED | "Your workspace is full. Remove a file to make room." |
| anything else | "Something went wrong while reading this file." |

Raw codes appear only inside an org_admin/operator disclosure, "Details for admins".

### 5.5 Upload interaction and drag-anywhere overlay

- **Entry points:** composer attach, the sidebar "Add files" row, paste, drag-anywhere, and `?doc=` from the landing page.
- **Destination:** "My documents" (§3.2 step 4). Its collection is added to the chat's scope.
- **Chips** (above the textarea):
  - Size and frame: 52px tall, max-w 260px, radius 12.
  - Contents: a 32px type tile (PDF red, DOCX blue, TXT/MD slate), the filename middle-truncated so the extension shows (13/500), and the status line (12px).
  - Remove ×: 24px hit area (44px on touch).
  - With ≥ 5 files: 3 chips plus "+N more", and an aggregate line "3 of 8 ready · 4 reading · 1 not accepted".
- **Transport:** one multipart POST of ≤ 20 files with a shared bar until the per-item statuses return.
- **Polling:**
  - One batched `GET /documents?collection_id=<myDocs>&limit=200` per tick, filtered to the watched ids.
  - Backoff 1, 1.5, 2.3, 3.4, 5.1, 7.6s, then 8s.
  - Pause while hidden; reset on focus or a new upload; stop when everything is terminal.
  - After 3 minutes: "Still reading. You'll find it in My documents."
- **Hold and auto-send:**
  - Typing always works.
  - If an attached file isn't terminal, Send posts the user bubble immediately, with "Waiting for report.pdf (usually under a minute)…", "Ask now without it" and "Cancel" under it.
  - The question auto-sends when the file is Ready.
  - If the file ends failed or rejected, it sends anyway, with the note "Answered without report.pdf (couldn't read it)."
- **Ready signal:**
  - A centred system row: "✓ **report.pdf** is ready · 42 pages" (several files: "3 files are ready: a.pdf, b.docx, +1 more"), followed by suggestion chips (§5.11).
  - The same text goes to the announcer.
  - Prefix `document.title` with "(Ready) " while the tab is hidden.
- **`?doc=` arrival:** the system row "Reading report.pdf… usually 5–60 seconds. You can type your question now." Then `router.replace` strips the query.

**Overlay (`useFileDrop`, mounted once in the workspace layout):**
- **Listeners:** on `window` with `capture` and a depth counter, guarded by `types.includes('Files')`. Always `preventDefault` dragover and drop, or Edge opens the PDF in the tab.
- **Visual:** `pointer-events-none fixed inset-4 z-50 rounded-3xl`, `rgb(15 107 102/.08)`, `backdrop-blur-[2px]`, a 2px dashed teal SVG border, and a 48px icon. Fades in over 120ms; `aria-hidden`.
- **Copy:** "Drop files to add them" (24/600) / "They go to My documents and this chat · PDF, Word, text or Markdown · up to 25 MB each, 20 at a time" (14px).
- **Operator:** "Operators can't add documents" / "You can ask about documents already here. An Engineer or Admin can add files." In demo mode, add a "Switch to Engineer" link. `dropEffect` is `none`.
- **Touch:** no overlay.

### 5.6 Answer states

- **User turn:** right-aligned bubble, `max-w-[75%]` (85% on mobile), radius 20, `--panel-2`, 16/26, `pre-wrap`.
- **Assistant turn:** no bubble, no avatar, full width 16/26, 24px between turns.

| State | Rendering and copy |
|---|---|
| **Waiting** | After 500ms, a placeholder appears where the answer will land: three 6px teal dots and a 14px muted stage label (`role="status"`). Stages: 0.5s "Searching your documents" → 2.5s "Reading the best matches" → 5s "Picking the exact quotes" (extractive) or "Writing the answer" (Claude) → 12s "Still working. Big collections take a little longer." → 25s "This is taking longer than usual." plus **Stop**. From 5s, append " · 7s" |
| **Provenance row** (each answer) | Two 22px badges, icon plus text. Evidence (ok, check): "Found in your documents". Mode (neutral): "Exact quotes · no AI writing" or "Written by Claude". `provider · name · ms` goes only in `title` |
| **Found, extractive** (`model.provider === "extractive"`) | Quote blocks grouped by marker: 3px teal left border, padding 12/16, 16/26, not italic, **no markdown**, `pre-line`. Under each block, a 13px link "{filename} · page {n}" that opens the source |
| **Found, Claude** | Plain text with inline chips (markdown is SHOULD) |
| **Sources row** | Up to 3 stacked 20px file icons, then "2 passages from 1 document ›". Opens the panel |
| **Action row** | Copy and Sources (n), 32px. Always visible on the latest answer; hover or focus on older ones. Copy appends "Sources: [1] file, p. 4" and shows "Copied" for 2s |
| **Not found** (`insufficient`) | Neutral card: `--panel-2`, 1px border, radius 12, padding 16, search-x icon. No chips, never red. `retrieved_count === 0`: **"Not found in your documents"** / "I searched {N} documents and found nothing about this." `> 0`: **"Your documents don't answer this"** / "I found related passages, but none answer the question directly." If anything in scope is reading: "{k} files are still being read. Try again in a minute." Buttons: Rephrase (puts the question back, selected) · Search all documents (only if narrowed) · Upload a document (upload roles). **BE (SHOULD):** `insufficient_reason` plus `nearest[]` |
| **Error** | A card under the kept question, never a toast. warn-soft for temporary problems, bad-soft for hard ones, `role="alert"`. "Try again" resends the same text and scope. Footer: 11px mono "Ref {correlation_id}" and a copy button. `NETWORK_ERROR`: "Can't reach RackFlow." / "Check that the server is running, then try again." 503 search: "Search is busy or offline. Try again in a few seconds." `MODEL_TIMEOUT`: "The answer took too long." `MODEL_OVERLOADED`/`MODEL_UNAVAILABLE`: "The AI model isn't available right now." 401: "Your session ended." with Sign in again (the draft is saved to sessionStorage). Other: "Something went wrong on our side." |
| **Rate limited** (429; 30/min, shared by everyone on a demo account) | Warn card: "You're asking faster than RackFlow can answer." / "Shared demo accounts share this limit." A disabled "Try again in 12s" counts down, then enables. It uses `Retry-After` (**BE, SHOULD**); fallback 15s |

- **Caveat** under the composer (12px muted):
  - Extractive: "Answers are exact quotes from your documents. Open the source to check the context."
  - Claude: "Claude writes answers from your documents and can make mistakes. Check the cited passages."
- **Scroll:** auto-scroll only if the user was within 120px of the bottom, and then bring the **top** of the answer into view. Otherwise show a "New answer ↓" pill 12px above the composer.
- **No Regenerate:** both modes are deterministic.

### 5.7 Citation chip, sources panel and bottom sheet

**Chip:**
- Markup: a `<button>` built only from `citations[]`. Strip unmatched `[n]` markers.
- Size: 18px tall, min-w 18, padding 0 5px, radius full, 11/18 600 `tabular-nums`, `--cite-chip-bg/fg`, `vertical-align: 2px`.
- Hit area: a `::before` extends it to 24×24 (44×44 on coarse pointers).
- `aria-label`: "Source 1: handbook.pdf, page 12".
- Selected: active colours plus `aria-current`. Deleted document: grey, "Source no longer available".

**Activation:**
1. Open the panel or sheet.
2. Scroll the card to the centre.
3. Flash it once (1.2s; a static 2s tint under reduced motion).
4. On keyboard activation, focus the card heading. "Back to answer" returns focus to the chip.

Hovering a card highlights its chips, and the reverse.

**Panel** (non-modal `<aside id="sources-panel">`):
- Header (56px): "Sources (3)" and a 40px close button.
- Body: cards in marker order, 12px gap.
- **Card:** radius 12, 1px border, padding 12.
  - Row 1: the chip, the filename (13/500, middle-truncated), and "Page 12" muted (TXT/MD: "Section").
  - Row 2: the quote in `<mark>` with `--cite-hl`, 14/22, `box-decoration-break: clone`, clamped to 6 lines with "Show more", and sr-only "Quoted passage:".
  - Row 3: a "Best match" tag on the top-scoring citation only (never a raw score), then "Copy quote" and "Download file" (`document:read_content`).
- Shows the **selected** answer's sources, defaulting to the latest.
- Auto-opens on the first cited answer only at ≥ 1440px.
- **In-app viewer:** "Open page 12" needs **BE (SHOULD, S)**, `download?inline=1` with the real MIME type, so FE can use `<iframe …#page=12>`. Today's download is attachment-only.

**Below 1024px:**
- A native `<dialog>` opened with `showModal()` from an effect.
- Classes: `fixed inset-x-0 bottom-0 m-0 w-full max-w-none max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] backdrop:bg-black/40`. Slides up over 260ms.
- Contents: a 36×4 handle (decorative), a header with a 44px Close, and a pager "‹ 2 of 3 ›" with 44px buttons.
- Closes on Esc, backdrop tap, Close, or browser Back (a history state is pushed on open). Swipe is optional, never required.
- `html:has(dialog[open]) { overflow: hidden }`.

### 5.8 Scope control

- **Chip** in the composer toolbar (on mobile, its own row above the textarea):
  - Copy: "Searching: All documents · 16", "Searching: HR Policies · 9" or "Searching: 2 collections · 9". While files are reading, append " · 2 getting ready" with a spinner.
  - Size: 32px, radius full, 1px `--border-strong`, 14/500.
  - Narrowed: `accent-soft` background, teal border and text.
  - `aria-haspopup="dialog"`.
- **Counts** include only `indexed` documents, computed client-side from `GET /documents?limit=200`. **BE (SHOULD):** `indexed_count` and `pending_count` on CollectionOut, which today counts every status.
- **Picker** (360px popover; bottom sheet on mobile):
  - Header: "Choose what to search".
  - A tri-state "All documents (16)" row.
  - 44px collection rows (48px on touch): checkbox, name, "12 documents · 1 getting ready", and an "Only" button.
  - A search box when there are more than 8 collections.
  - The last box can't be unchecked: "Pick at least one collection".
  - Footer: "Searching 9 documents in 2 collections" and Done.
- **Rules:**
  - Every new chat starts on All documents: collections with non-null `access_level`, the 50 most recent.
  - The session is created **on first send** (`POST /chat/sessions {collection_ids}`, then the message, then `replaceState` to `/ask/c/{id}`).
  - Narrowing affects only that chat. It goes as the per-message `collection_ids` override and is cached in sessionStorage under `rf.scope.{sessionId}`.
  - Never carried into new chats, because the accounts are shared.
  - **BE (SHOULD, M):** `PATCH /chat/sessions/{id}` and scope stored per message.
- **`?doc=` arrivals** scope to the upload collection ("Searching: My documents · 5"). **BE (COULD):** a `document_ids` filter.
- **Meta line** under each answer (12px muted): "Searched 9 documents in HR Policies, Safety".

### 5.9 Empty and blocked states (`useAskState()`, evaluated in this order)

| Case | When | Rendering |
|---|---|---|
| Loading | data pending | Skeleton after 300ms. **Never** flash state A |
| E Auditor | no `chat:use` | Full page, lock icon: "Auditors can't ask questions" / "Your role can see activity, file names and statuses, but not what's inside documents. This keeps reviews independent." Buttons: Open admin console · Switch persona (demo only) |
| D Operator, nothing Ready | no upload, 0 indexed | "Nothing to ask about yet" / "Documents added by Engineers or Admins appear here once they're ready." Button: Open job queue (`/jobs`) |
| A Can upload, 0 documents | 0 indexed, 0 pending | Centre-column dropzone (max-w 640, 220px, landing style): "Add a document to get started" (28/600) / "Drop in a PDF, Word, text or Markdown file. Scanned PDFs work too." A 13px strip: "1 Add · 2 We read it (under a minute) · 3 Ask and see the source" |
| C Reading, none Ready | pending > 0 | "Reading your documents…" / "This usually takes 5 to 60 seconds. You can type your question now." Then 48px rows with a StatusPill. Hold-and-send is active |
| B Ready, new chat | indexed > 0 | "What would you like to know?" / "I'll answer from your {n} documents and show the exact passage." Centred composer plus chips |
| F Chat not found | 404 | "This chat isn't available. It may have been deleted, or it belongs to another account." Button: Start a new chat |

`/ask` **never** auto-opens the latest chat; on a shared account that would show the previous visitor's conversation.

### 5.10 Conversation history

- **Data:** `GET /chat/sessions?limit=200`, fetched once in the layout.
- **Groups** (local midnight): Today, Yesterday, Previous 7 days, Previous 30 days, then the month.
- **Title:** the first question (the existing backend rule). If titles repeat, append the time ("· 8:39 PM").
- **Send:** an optimistic row at the top with a 12px spinner, reconciled when the response arrives.
- **States:** 6 skeleton rows. Empty: "No chats yet" / "Your questions will appear here." Error: "Couldn't load chats" with Retry; the rest of the sidebar stays usable.
- **Rename and delete:** need **BE (SHOULD, M)** `PATCH`/`DELETE /chat/sessions/{id}` (owner-only, audited; rename keeps `updated_at`). Then add the "⋯" menu, visible on hover, on focus-within, on the active row and on `(hover:none)` devices.
  - Rename: inline.
  - Delete dialog: "Delete chat?" / "This deletes "{title}" and its answers. Your documents aren't affected." with Cancel (focused) and Delete.

### 5.11 Suggested questions

- **Sources, in order:**
  1. **BE (COULD):** curated `ui.starter_questions`, at most 4.
  2. Templates from the 3 newest Ready filenames.
  3. A static fallback.
- **Cleaning filenames:** strip the extension, turn `_ - .` into spaces, drop `v2`, `final`, `copy`, `(1)` and dates. Skip names like `scan3`, `untitled` or mostly digits.
- **Templates by keyword:**

| Keyword | Template |
|---|---|
| policy, handbook, guide, procedure | "What are the main rules in the {Title}?" |
| contract, agreement, terms | "What are the termination terms in the {Title}?" |
| report, review, incident | "What are the key findings in the {Title}?" |
| runbook, manual, spec | "What steps are listed in the {Title}?" |
| invoice, budget | "What amounts and due dates are in the {Title}?" |
| anything else | "What is the {Title} about?" |

- **Fallback:** "What are the key dates and deadlines?" · "Who is responsible for what?" · "What are the most important numbers?"
- **Chip:** min-h 44, radius 12, 1px border, 14px question, 12px muted filename. 2×2 on desktop, one column on mobile.
- **Behaviour:**
  - **A click sends immediately.**
  - No "Summarize" suggestions in extractive mode.
  - Never suggest a document that isn't Ready.
  - Chips hide after the first message.

---

## 6. My documents (`/library`)

- **Header:** "My documents" (20/28 600), with the sub "Everything you can ask about". A primary "Add files" button for upload roles only; below 640px it becomes a 56px "Upload" FAB (bottom-right, safe-area aware).
- **Toolbar:**
  - Search: "Search by file name" (36px, 16px text).
  - Filter chips with counts: All · Ready · Getting ready · Needs attention (hidden when 0).
  - Collection menu, default "All collections".
- **Data:** `GET /documents` with `q`, `status`, `collection_id`, `limit=200`. Poll at the §5.5 cadence while any visible row isn't terminal.
- **Table at ≥ 768px** (with an sr-only caption and `th scope=col`):

| Column | Content |
|---|---|
| Name | type tile, name (14/500, middle-truncated), muted collection name |
| Status | StatusPill; failed rows add the reason (12px `--bad`) |
| Pages | `page_count` or "–" |
| Added | relative time, absolute in `title` |
| Actions | "Ask about this" (Ready only → `/ask?doc=id`) and a "⋯" menu: Download · Try again (`document:retry`) · Delete (`document:delete`) |

- **Below 768px:** 72px card rows with the icon, a 2-line name, a meta line "PDF · 24 pages · 3 min ago", the pill and a 44px "⋯".
- **Becoming Ready:** flash the row once (1.2s).
- **Delete dialog:** "Delete report.pdf?" / "You won't be able to ask about it any more." Cancel is focused.
- **Empty states:**
  - Upload roles: the §5.9-A dropzone.
  - Operator: "No documents yet. Engineers and Admins can add them."
  - Search with no results: "No documents match "{q}"" with Clear search.
  - Needs attention with none: "Nothing needs attention. Every file was read successfully."
- **Auditor:** the §5.9-E pattern, "Auditors see file details in the admin console", with the button Open Documents (`/documents`).

---

## 7. Admin console: entry point and minimal changes

**Entry:** the "Admin console" row in the workspace sidebar footer, repeated in the user menu. It opens in the same tab and goes to `/overview`, or the role's first console page.

| # | MUST change (FE, S) |
|---|---|
| 1 | Remove "Chat" from the console NAV; `/chat` → `/ask` redirect |
| 2 | Rename "AI Playground" to "AI quality" and move Evaluation into it beside Retrieval inspector |
| 3 | Add a "Back to Ask" row (arrow-left, 36px) at the top of the console sidebar for `chat:use` roles |
| 4 | Replace `NoAccess`/`RequirePermission` copy: "{Page} needs a different role" / "You're signed in as {name} ({Role}). {Page} is for {roles}." Buttons: "Back to Ask" (or "Go to Overview"), and "Switch persona" in demo mode. Use a normal region with an h1, not `role="alert"` |
| 5 | Mount the demo strip above the console |
| 6 | Logout goes to `/`, not `/login` |

**Deferred re-organisation (SHOULD/COULD):**
- An `/admin/*` prefix with its own layout.
- Six-group nav: Overview, Knowledge, Pipeline, AI quality, Infrastructure, Organization.
- Mobile console drawer (none exists today).
- Overview: status sentence, clickable KPIs, fix the "1/5 workers" mismatch, empty-chart copy.
- Shared FilterBar with URL-synced tabs and human job labels.
- Role change via a confirm dialog, plus a **BE** 409 that protects the persona accounts.
- Health dot on the console link.
- Ctrl+K page switcher.

---

## 8. Visual system

### 8.1 Colour tokens

**Keep** every existing token: all text pairs are AA, measured at ≥ 5.09:1. **Add** the tokens below, map each through `@theme inline` as `--color-*`, and verify contrast with the scratchpad script.

| Token | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `--border-strong` | `#7a8494` | `#6b7584` | control boundaries: composer, inputs, ask box, scope chip | 3.78 / 3.88 |
| `--dropzone-border` | `#4e9c93` | `#3a8a82` | dashed dropzone | 3.23 / 4.43 |
| `--landing-bg` | `#ffffff` | `#0c0e12` | landing canvas | – |
| `--cite-chip-bg` / `-fg` | `#e3f1ef` / `#0b5753` | `#11302d` / `#7fdccf` | citation chip | 7.23 / 8.78 |
| `--cite-chip-active-bg` / `-fg` | `#0f6b66` / `#fff` | `#3cc4b4` / `#06201d` | selected chip | 6.33 / 7.91 |
| `--cite-hl` | `#fdefb2` | `#4a3d0f` | quote highlight (use `--text` on it, never `--muted`) | 15.35 / 8.78 |
| `--cite-hl-active` | `#fbdc6a` | `#6b5711` | active quote | 13.13 / 5.76 |
| `--demo-bg` / `-fg` / `-border` | `#fff4d6` / `#5c4200` / `#f0d58c` | `#3a2e0a` / `#f5d77a` / `#5a4712` | demo strip | 8.58 / 9.45 |

**Also add:**
- `:root { color-scheme: light dark }` and `::selection { background: var(--accent-soft) }`.
- A forced-colors block: badges get a `1px solid CanvasText` border; focus uses `Highlight`.
- Dark selectors: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and `:root[data-theme="dark"]`, so a theme toggle can drop in later.

**Colour roles:** teal for actions, selection and citation chips. Yellow for quoted evidence. Red only for problems the user must act on.

### 8.2 Typography

**Font:** Inter Variable through `next/font/google` (`axes:['opsz']`, `display:'swap'`, `variable:'--font-inter'`), for both marketing and the app. It is self-hosted at build time, so it works offline. Body gets `font-feature-settings:'cv05','cv08'`.

| App token | Value | Marketing token | Value |
|---|---|---|---|
| caption | 12/16, 500 | display | `clamp(2rem, 1.25rem + 2.5vw, 2.75rem)` (32→44px), line-height 1.1, 700, −0.02em |
| sm | 13/20 (sidebar, tables) | h2 | `clamp(1.75rem, 1.4rem + 1.2vw, 2.25rem)` (28→36px), 1.15, 700, −0.018em |
| base | 14/22 (console body, unchanged) | h3 | 20/28, 600 |
| chat | 16/26 (messages, composer) | lede | 18/28, muted |
| title | 16/24, 600 | body | 16/26; card body 14/24 |
| page | 20/28, 600 | | |
| empty | 28/36, 600 | | |

- **Weights:** 400 body, 500 labels, 600 headings (marketing headings 700).
- **Floor:** 12px. The only exception is the 11px chip digits, which pass at 7.23:1.
- `tabular-nums` for numbers, timers and chips.

### 8.3 Radii, shadows, spacing

- **Radii:** 4 (kbd, mark) · 8 (controls) · 12 (cards, popovers, dropzone panels, FAQ) · 16 (upload card, persona cards, dialogs, sheets) · 20 (user bubble) · 24 (composer, overlay) · full (badges, chips, avatars, Send, pills, logo).
- **Shadows (light):**
  - `--elev-1`: `0 1px 3px rgb(16 24 40/.10), 0 1px 2px rgb(16 24 40/.06)`
  - `--elev-3`: `0 12px 16px -4px rgb(16 24 40/.08), 0 4px 6px -2px rgb(16 24 40/.03)`
  - Feature cards: `0 1px 4px rgb(0 0 0/.05)`.
- **Shadows (dark):** a ring `0 0 0 1px rgb(255 255 255/.06)` plus `0 8px 24px rgb(0 0 0/.5)`.
- **Usage:** static cards and tables use a border only. Menus and toasts use elev-3. The landing card uses the glow only.
- **Spacing:** the Tailwind 4px scale, limited to steps 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 28. Controls 36px (32 for dense console), icon buttons 40px (44 on mobile), 24px between chat turns.

### 8.4 Motion (CSS only)

**Tokens:**
- `--ease-snappy: cubic-bezier(.23,1,.32,1)`
- `--ease-drawer: cubic-bezier(.32,.72,0,1)`
- `--animate-flash` (1.2s, 18% teal to transparent)
- `--animate-shimmer` (2s)
- `--animate-dash` (.8s)

| Interaction | Timing |
|---|---|
| press | 100ms, scale .98 |
| hover/focus colour | 150ms `transition-colors` |
| entrances (chips, toasts, menus, answer reveal) | 200ms snappy, `starting:opacity-0 motion-safe:starting:translate-y-1` |
| drawers and sheets | 260ms in / 200ms out, `ease-drawer`, translate only (`<dialog>` plus `transition-discrete`) |
| drag overlay | 120ms in / 100ms out |

**Rules:**
- Cap every UI response at 300ms. Only the flash and the dash loop run longer, and neither blocks input.
- Animate only opacity, translate, scale, colour, shadow and stroke-dashoffset. Expanders use `grid-rows-[0fr]` → `[1fr]`. Never `transition-all`.

**Never animated:** answer text (no typewriter), Enter-sent messages, chat switching, route changes, KPI numbers, table rows, the hero H1 and dropzone (LCP).

**Reduced motion:** a global guard, `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms!important; animation-iteration-count:1!important; transition-duration:.01ms!important; scroll-behavior:auto!important } }`. Loops get static text. `scrollIntoView` uses `behavior:'auto'`.

---

## 9. Accessibility checklist (WCAG 2.2 AA)

| # | Check (pass criterion) | Test |
|---|---|---|
| 1 | Zero axe violations (`wcag2a/aa`, `21a/aa`, `22aa`) on `/`, `/login`, `/ask` (empty, answered, sheet open), `/library` (uploading, failed row) and every dialog | `@axe-core/playwright` in CI |
| 2 | One persistent `#sr-announcer` (`role=status`, polite, atomic); the transcript has **no** `aria-live` | DOM |
| 3 | Exactly one "Answer ready…" announcement per answer and no echo of the question; the announcer never contains "%" | Playwright plus NVDA |
| 4 | IME Enter doesn't send; Shift+Enter adds a newline; focus stays in the textarea | keyboard |
| 5 | No `disabled` attribute on a focused control (Send, Choose files); use `aria-disabled` plus a guard | test |
| 6 | First Tab stop is "Skip to question box", then "Skip to main content" | keyboard |
| 7 | Chip → Enter focuses "Source 1 · file · page"; "Back to answer" returns focus | keyboard |
| 8 | Chip names contain the visible number (2.5.3) | unit |
| 9 | Non-inline targets ≥ 24×24 (2.5.8); icon buttons 40px, 44px on mobile | bounding box |
| 10 | Native `<dialog>.showModal()`. Initial focus: first field (forms), Cancel (destructive), heading (long content). Esc closes and returns focus | keyboard |
| 11 | Sheets have a visible Close; swipe is never required (2.5.7) | manual |
| 12 | Every dropzone has a native file-input button; drag is never the only path | `setInputFiles` |
| 13 | Status is never colour-only: every pill has a glyph and a word | review |
| 14 | Control boundaries use `--border-strong` (≥ 3:1); text ≥ 4.5:1 | contrast script |
| 15 | At a 320px viewport, `scrollWidth ≤ 320` on `/`, `/ask` and `/library` | Playwright |
| 16 | Under reduced motion, `transitionDuration` ≤ 0.01ms | Playwright |
| 17 | Unique titles: "RackFlow AI · Ask your documents, see the source", "Ask · RackFlow AI", "{chat} · RackFlow AI", "My documents · RackFlow AI" | test |
| 18 | Landmarks: header, `nav[aria-label="Recent chats"]`, `main#main` with an h1, `aside[aria-label="Sources"]`; turns are `<article>` with an sr-only h3 "You asked" / "Answer" | DOM |
| 19 | One-click demo login satisfies 3.3.8; the password field allows paste and has `autocomplete` | manual |
| 20 | `scroll-padding-bottom` equals the composer height plus 16px (2.4.11) | keyboard |
| 21 | Windows High Contrast keeps badges, chips and focus visible | manual |
| 22 | Per-persona E2E: landing URL, and presence/absence of Attach, "Add files", "Admin console" and "Back to Ask" | Playwright |

---

## 10. Mobile and breakpoints

| Width | Behaviour |
|---|---|
| < 640 | One column, 16px gutters. Landing panels and persona cards stacked. `/ask`: drawer sidebar, composer at the bottom, sources as a sheet, scope chip on its own row. Library cards and an Upload FAB |
| ≥ 640 sm | Persona cards 2-up |
| ≥ 768 md | Landing panels side by side; library table; nav links |
| ≥ 1024 lg | Persistent sidebar; sources as a right drawer |
| ≥ 1280 xl | Sources docked at 360px |
| `max-height: 500px` | Header 44px |

**Viewport export:** `{ width:'device-width', initialScale:1, viewportFit:'cover', interactiveWidget:'resizes-content', themeColor:'#0f6b66' }`. Never `maximumScale` or `userScalable:false`.

**Rules:**
- 16px inputs (prevents iOS zoom).
- Composer `pb-[max(8px,env(safe-area-inset-bottom))]`.
- No autofocus on mobile.
- Blur the textarea after sending on coarse pointers.
- "Tap to choose a file" copy; no drag overlay on touch.
- `(hover:none)` reveals hover-only actions.
- Toasts sit above the composer.

**QA widths:** 360, 375, 390, 412, 430, plus 1280×720 and 1366×768.

---

## 11. Component inventory

| Component | Responsibility / props | Reuses |
|---|---|---|
| `HeroUploadCard` | `variant:'hero'\|'compact'`; dropzone, ask box, `useHeroUpload` (§3.2) | `uploadFiles`, `api`, `FilePicker`, `useFileDrop`, `pendingStore` |
| `DemoPersonaCards` | `variant:'landing'\|'compact'`; fetches `/auth/demo`, login, states | `api`, `homePath` |
| `DemoStrip` | Indicator plus switch menu, in both shells | `useMe` |
| `pendingStore` | Module store `{files, question}`: `set`/`take`/`subscribe`, read via `useSyncExternalStore` with a stable server snapshot | – |
| `useFileDrop` / `DropOverlay` | Window drag events, depth counter, `preventDefault`; `{canUpload, roleLabel}` | – |
| `FilePicker` | Hidden input plus a real button; validation; resets `value`; paste | `precheck()` from `documents/page.tsx` |
| `lib/status.ts` / `StatusPill` | Vocabulary, reason map; `variant:'pill'\|'inline'\|'dot'` | `StatusBadge` tones |
| `useDocStatus` / `useMyDocumentsCollection` | Batched polling with backoff; find or create plus the 409 fallback | `api` |
| `WorkspaceShell` / `ChatSidebar` | Layout, drawer, cached `loadMe()`, announcer, history groups | `Logo`, `Icon`, `MeContext`, `useApi` |
| `Composer` / `AttachmentChip` | `{onSend, canUpload, scope, chips, pending}` | `FilePicker`, `StatusPill` |
| `ScopeChip` / `ScopePicker` | `{collections, counts, value, onChange}` | `Sheet` |
| `useAskState` | Selects states A–F | `useMe` |
| `Thread` / `AnswerBlock` | Bubbles, waiting stages, provenance, quote blocks, sources row, actions | replaces `AnswerText` |
| `CitationChip` / `SourcesPanel` / `SourceCard` | One list in an `<aside>` (lg and up) or a `Sheet` | replaces `SourcePanel` |
| `NotFoundCard` / `AnswerErrorCard` | `{retrievedCount, scope}` / `{error, onRetry, retryAfter}` | `ApiError` |
| `SuggestionChips` | `{docs, mode}` templates | – |
| `Sheet` / `Dialog` | Native `<dialog>` with `showModal` from an effect | replaces the div `Dialog` |
| `Can` / `PERMISSION_COPY` | `fallback:'hide'\|'explain'`, role-aware copy | `useCan` |
| `Empty` (upgraded) | `{icon, title, description, primary, secondary, variant}` | `ui.tsx` |
| `LibraryTable` / `LibraryCards` | Filters, rows, menu | `Th`, `Td`, `TableWrap` |
| Landing statics | `LandingNav`, `FactStrip`, `HowItWorks`, `FeatureCard`, `Faq`, `LandingFooter`; pictures use fixture props on the real components | – |

---

## 12. Prioritized backlog

### MUST (build now)

| # | Item | Tag | Effort |
|---|---|---|---|
| M1 | Route groups `(marketing)`/`(workspace)`, one root layout, `/ask`, `/ask/c/[id]`, `/library`, `/chat` redirect, logout → `/` | FE | S |
| M2 | Token additions, Inter, viewport export, motion tokens, reduced-motion guard | FE | S |
| M3 | Landing sections with final copy (feature pictures 1 and 4) | FE | M |
| M4 | `HeroUploadCard`: full §3.2 state machine, drop guard, ask-box flow | FE | M |
| M5 | `DemoPersonaCards` on landing and login, plus the new login layout | FE | S |
| M6 | Rewrite `DEMO_PERSONAS` copy | BE | S |
| M7 | `WorkspaceShell`: sidebar, header, drawer, console-link rule, user menu | FE | M |
| M8 | `DemoStrip` with switch persona and exit, in both shells | FE | S |
| M9 | Composer: auto-grow, IME-safe Enter, attach, paste, Send states | FE | M |
| M10 | In-chat upload: overlay, chips, `lib/status.ts`, polling, My documents, hold and auto-send, ready row, `?doc=` | FE | M |
| M11 | Answer states: waiting, provenance, quote blocks, not-found, error and 429 cards, kept question with Try again | FE | M |
| M12 | Citation chips and sources panel / drawer / sheet | FE | M |
| M13 | Scope chip and picker, lazy session, Ready counts, per-message override | FE | M |
| M14 | History groups, deep links, optimistic rows, no auto-open | FE | S |
| M15 | `/ask` states A–F and suggestion chips | FE | S |
| M16 | `/library` | FE | M |
| M17 | Role gating: `homePath`, `Can`, `PERMISSION_COPY` | FE | S |
| M18 | Console minimal changes (§7, 1–6) | FE | S |
| M19 | A11y: announcer, native dialogs, axe and keyboard gates, persona E2E | FE | M |

### SHOULD

| Item | Tag | Effort |
|---|---|---|
| `is_demo`/`persona_key` on `/auth/me`; revoke the previous session on demo login | BE | S |
| `Retry-After` on 429s | BE | S |
| `insufficient_reason` and `nearest[]`, plus a "Closest passages" disclosure | BE + FE | S + S |
| `PATCH`/`DELETE /chat/sessions/{id}`, plus the row menu | BE + FE | M + S |
| `PATCH` session scope, scope stored per message, "Now searching" divider | BE + FE | M + S |
| `indexed_count`/`pending_count` on CollectionOut | BE | S |
| `download?inline=1` plus an in-app page viewer | BE + FE | S + S |
| `POST /me/inbox`; upload limits in `GET /auth/demo` | BE | S |
| Clean demo seed (no E2E/livecheck data), plus a pre-indexed sample document and "No file handy? Try a sample document" | BE + FE | S + S |
| Citation hover preview; Stop button; feature pictures 2, 3, 5, 6 | FE | S |
| Safe markdown for Claude answers (no raw HTML) | FE | M |
| Chat search (Ctrl+K), "Hide history" toggle, IndexedDB pending stash, `proxy.ts` cookie redirect | FE | S |
| Console mobile drawer, role-change confirm, persona accounts protected (409), console health dot | FE + BE | S |

### COULD

| Item | Tag | Effort |
|---|---|---|
| Console `/admin/*` re-org, Overview status banner, FilterBar, Ctrl+K page switcher | FE | L |
| Answer feedback endpoint feeding Evaluation | BE + FE | M |
| pdf.js passage highlight | FE | L |
| Curated starter questions setting; `document_ids` filter on ask | BE + FE | S / M |
| Theme toggle, pinned chats, "Edit question" | FE | S |
| Prompt-injection flag chip | BE + FE | M |
| "Start here" arrow at ≥ 1120px; one-shot hero mini-demo; footer health pill; demo reset card | FE + BE | M |

---

## 13. Decisions where the research disagreed

| Topic | Decision | Why |
|---|---|---|
| Logged-out drop: auto-login vs persona picker | Auto Engineer | Fixed decision; saves a click; shared-account note shown |
| Operator landing: `/ask` vs Overview | `/ask` | Fixed decision: everyone who can chat |
| Auditor landing: audit log vs first usable page | `/overview` via `homePath` | Fixed decision; card says "Opens the admin console" |
| Console under `/admin/*` | Keep current URLs | Fixed decision; re-org is COULD |
| Console link for engineers | Hide | Engineers have "no ops pages" |
| Email on persona cards | Show | Fixed decision; passwords never shown |
| Card order | API order plus "Start here" on Engineer | One source of truth |
| Hero: split layout vs chatpdf card | chatpdf two-panel card, cards below | User asked for the chatpdf look; divider visible at 1366×768 |
| Landing length: 4 vs 6 sections | 6, with FAQ | Matches chatpdf; answers presenter questions |
| Pending file: IndexedDB vs memory | In-memory store, single root layout | Covers the real flows with no dependency |
| Font: Inter vs a display face | Inter only | One file, opsz, offline |
| Palette: warm rewrite vs keep | Keep, add 9 tokens | Already AA; less console churn |
| "Reading" colour: teal vs blue | Info blue | Teal stays for actions and citations |
| Duplicate tone | Neutral "Already added" | Good news, not a warning |
| Not-found tone: amber vs grey | Neutral grey | Nothing failed |
| Chat column: 720 vs 768 | 768px | Measured on ChatGPT; fits beside 360px at 1440 |
| Sources width: 360/380/400 | 360px fixed | Keeps ≥ 612px of text at 1280 |
| Chat text: 15 vs 16px | 16/26 | Projectors; matches mobile input |
| Scope chip: header vs composer | Composer toolbar | Next to where you type |
| Send while indexing | Hold and auto-send | No dead button, no premature "not found" |
| Suggestion click: fill vs send | Send | An explicit click is the demo moment |
| Extractive rendering | Quote blocks | Honest: no model wrote it |
| Regenerate | Omit | Both modes are deterministic |
| Operator attach | Hidden, explained on drag | No hover on touch |
| Demo indicator: pill vs strip | 32px strip, not dismissible | Screenshots never pass for production |
| Reduced motion: selective vs global | Global rule | Single, testable rule |
| Chat URL | `/ask/c/[id]` via `[[...slug]]` | Room to grow; no unmount mid-request |
| Library scope | Everything readable, plus a collection filter | Shows what you can ask about |

---

## 14. Sources appendix

- **Internal:** the 22 JSON reports in `scratchpad/research/ui/reports/`, plus the screenshot sets `research/chatpdf` (h01, v03, s08, m01), `research/ask` (Atlas workspace) and `research/landing` (Atlas persona picker).
- **Landing and demo:** chatpdf.com · humata.ai · chatdoc.com · docanalyzer.ai · glean.com · vectara.com · onyx.app · sentry.io/demo/sandbox · langfuse.com/docs/demo · kimai.org/demo · snipeitapp.com/demo · helpx.adobe.com/document-cloud/faq/free-online-pdf.html · nngroup.com/articles/plain-language-experts
- **Chat, citations, trust:** chatgpt.com (measured at 1440×900 and 390×844) · assistant-ui.com/examples/claude.md · support.google.com/notebooklm/answer/14276569 · aiuxplayground.com/teardowns/perplexity/citations · docs.glean.com (deep-linked citations) · shapeof.ai/patterns/citations · cloudscape.design/patterns/genai
- **Status and roles:** nngroup.com/articles/progress-indicators · carbondesignsystem.com/patterns/status-indicator-pattern · vercel.com/design/empty-state · design.gitlab.com/usability/feature-management · smashingmagazine.com/2024/05/hidden-vs-disabled-ux
- **Implementation, motion, a11y:** nextjs.org/docs (route groups, proxy, viewport) · react.dev (useOptimistic, useSyncExternalStore) · tailwindcss.com/docs · developer.chrome.com/blog/entry-exit-animations · emilkowal.ski/ui/agents-with-taste · w3.org/TR/WCAG22 · w3.org/WAI/ARIA/apg · npmjs.com/package/@axe-core/playwright
- **Repo facts:**
  - `auth/demo.py`, `auth/rbac.py`, `routers/auth.py`
  - `routers/chat.py`: `min_length=1`, per-message override, `retrieved_count`
  - `routers/documents.py`: 20 files max, retry, attachment-only download
  - `routers/collections.py`: names unique per tenant; `document_count` counts every status
  - `core/ratelimit.py`: chat 30/min per user, demo 30/min per IP
  - `globals.css`, `ui.tsx`, `Shell.tsx` (`homePath`), `lib/api.ts` (XHR `uploadFiles`)
