# UX and Interface Design: RackFlow AI

This file describes the interface as it is built on branch `ui-redesign-2026-10`, as of 2026-11-06.
It replaces the original console-only design. The detailed build spec, with exact copy, measurements
and research reasons, is [`UI_DESIGN_SPEC.md`](UI_DESIGN_SPEC.md) (approved 2026-10-29). Section
references like §5.6 point to that spec. Where the code and the spec disagree, section 12 says so
and this file describes the code.

Evidence for the behaviour below is in [`TESTING.md`](TESTING.md). Describing a design here does not
mean every state was tested; [`PROGRESS.md`](PROGRESS.md) lists what remains unverified.

## 1. Direction

The product has two faces on one root layout:

- **Landing page and `/ask` workspace:** a simple tool for anyone with a document and a question. It
  uses plain words such as Ready, Reading and "Not found in your documents".
- **Admin console:** a dense, calm operations surface for queues, workers, models, infrastructure,
  users and audit. Pipeline vocabulary stays here.

Principles (§1):

1. The tool is the hero. Where to drop a file and where to type a question are obvious on every screen.
2. File first, sign-in second. A dropped file or typed question is not lost to a login step.
3. Every answer shows its proof. "Not found" is a calm, honest result, never styled as an error.
4. Hide what a role can never use, and explain what people try anyway.
5. Built for projectors and shared accounts: demo state is always visible, and `/ask` never reopens
   the previous visitor's chat.
6. Motion only signals state. No fake percentages and no typewriter effect.

Navigation is not a security boundary. The API enforces every permission.

## 2. Routes

Everything shares `app/layout.tsx`, so moving between areas never drops an in-memory dropped file.

| Route | Purpose | Code | Requires |
|---|---|---|---|
| `/` | Landing page, statically rendered with client islands | `app/page.tsx` | public |
| `/login` | Email sign-in plus demo rows | `app/login/` | public |
| `/ask`, `/ask/c/{id}` | New chat and saved chat, one page that does not unmount mid-request | `app/(workspace)/ask/[[...slug]]/` | `chat:use` |
| `/library` | "My documents" | `app/(workspace)/library/` | `collection:read` and (`chat:use` or `document:upload`) |
| `/overview` `/collections` `/documents[/id]` `/inspector` `/evaluation` `/jobs` `/workers` `/models` `/infrastructure[/id]` `/admin/users` `/admin/audit` `/admin/settings` | Admin console | `app/(app)/` | per-page permission in `Shell.tsx` NAV |
| `/chat` | Permanent redirect to `/ask` | `next.config.ts`, with `(app)/chat/page.tsx` as a fallback | |

**After sign-in:** `homePath(permissions)` in `Shell.tsx` sends anyone with `chat:use` to `/ask`, and
others to their first console page (the auditor lands on `/overview`). `?next=` is honoured only
through `Visitor.signedInPath`, then `destination`, then `safeNext` and `canOpen` in `lib/demo.ts`:

- `safeNext` rejects anything that normalises to a path starting with `//`, or to another origin, or
  to `/login`.
- `canOpen` ignores `?query` and `#hash` when matching a route to a permission.

## 3. What each role sees

| Surface | org_admin | engineer | operator | auditor |
|---|---|---|---|---|
| `/ask` chat, history, scope, sources | yes | yes | yes | Explained full-page state |
| Attach, "Add files", drag to upload | yes | yes | Hidden; dragging shows an explanation overlay | no |
| `/library` | upload, delete, retry | upload, delete, retry | read-only plus "Try again" | Explained state pointing to Documents |
| "Admin console" link | yes | no | yes | Already in the console |
| "Back to Ask" link in the console | yes | yes | yes | no |

The console link rule is `canSeeConsole`: any of `ops:read`, `audit:read`, `user:read` or
`settings:manage`.

Row actions follow the API, not just the role:

- **Try again** needs write access to the collection, unless the caller has `job:manage`.
- **Delete** needs write access first, then uploader, collection manager or org_admin.

## 4. Landing page

Section order: top bar, hero, demo accounts, How it works, Features, "Try it with your own file",
Questions, footer. Components are in `components/landing/`.

- **Hero:** "Ask your documents. See the exact page." above a two-panel upload card (dropzone and ask
  box), a privacy line and the fact strip.
- **Static rule:** `app/page.tsx` uses no `cookies()`, `headers()` or `searchParams`. Who the visitor
  is gets resolved after hydration in `VisitorProvider`.
- **Hero flow (`useHeroUpload`):** validate in the browser, check `GET /auth/me`, demo sign-in as
  Engineer if needed and allowed, ensure "My documents", upload, then go to `/ask?doc=<ids>`.
- **Expired sessions:** a visitor who held a real session that has expired is never moved to the demo
  account. The job is held and the card offers Sign in.
- **Cancel tells the truth about what was stored:**
  - The hero sends one request at a time and records what each finished request stored.
  - If Cancel or a failure stops a run after something was stored, the card says so and offers
    "Remove saved file(s)", "Upload the rest" (only when files are unsent) and "Keep and close".
  - Once about 98% of a request body has gone, Cancel no longer aborts. The button shows "Stopping…"
    and the card reports what the server stored.
- **Two cards, one run:** the hero and closing cards share a busy flag. While one runs, the other
  shows "Another upload is running on this page" and accepts nothing.
- **Ask box:** read-only only while a question is on its way. Try again, Switch to Engineer and Sign
  in use the box's current text.
- **FAQ:** answers hold for any model provider. They say that with a connected model the question and
  matching passages go to that model, a follow-up can include the earlier question, and whole files
  never leave the server.

## 5. Demo access

Active only when `DEMO_MODE=true`, which startup refuses in production. See ADR-022.

- **Personas (`auth/demo.py`):** Engineer ("Start here"), Operator, Admin, Auditor. The cards come
  from `GET /auth/demo` in API order. A persona whose seeded account is missing is not offered.
  Passwords are never shown.
- **Surfaces:** `DemoPersonaCards` as large cards on the landing page and compact rows on `/login`.
  `/?role=auditor` only highlights a card; it never signs anyone in.
- **`DemoStrip`:** a sticky, undismissable 32px strip on every signed-in page, with the current
  persona, "Switch persona" and "Exit demo". Text: "Others using this demo see the same files and
  chats".
- **Detection:** the client compares `me.email` with the persona emails. `/auth/me` has no `is_demo`
  field.

## 6. `/ask` workspace

### 6.1 Layout

- A 260px sidebar persists at 1024px and wider, and is a drawer below that.
- The message column and composer share a 768px column.
- Sources are a 360px docked panel at 1280px and wider, a right drawer from 1024 to 1279px, and a
  bottom sheet below 1024px. The panel opens automatically on the first cited answer only at 1440px
  and wider.
- The shell's height follows `--app-h`, set from `visualViewport`, so the mobile keyboard does not
  hide the composer.

### 6.2 Sidebar and history

From top to bottom: logo and collapse (Ctrl+Shift+S), New chat (Ctrl+Shift+O), Add files (upload
roles), My documents with a Ready count, Recent, and the footer (demo note, Admin console, user chip).

Recent is grouped into Today, Yesterday, Previous 7 days, Previous 30 days, then month. A row's menu
offers rename and delete through `PATCH` and `DELETE /chat/sessions/{id}`. `/ask` never opens the
latest chat by itself.

### 6.3 Composer

- Auto-growing textarea, 16/26 text, up to 200px.
- Enter sends. Shift+Enter adds a line. IME composition never sends. On touch, Enter adds a line.
- "Add files" pill before the first message, then a paperclip. Files can also be pasted.
- Send uses `aria-disabled`, never `disabled`.
- Centred with a heading in an empty chat on desktop, at the bottom after the first send.

Caveat line under the composer, from `caveatFor` in the page:

| Provider | Text |
|---|---|
| `extractive` | "Answers are exact quotes from your documents. Open the source to check the context." |
| `anthropic` | "Claude writes answers from your documents and can make mistakes. Check the cited passages." |
| other LLM | "The AI model writes answers from your documents and can make mistakes. Check the cited passages." |

### 6.4 Status vocabulary

`lib/status.ts` is the only source of status words: Uploading n%, Waiting, Reading (including "Hit a
snag, trying again"), Ready, Couldn't read, Removing, Already added, Not accepted. Each has a glyph
and a tone, so status is never colour-only. Reason codes map to plain sentences. Raw codes appear only
under "Details for admins".

### 6.5 Uploading in chat

- **Entry points:** attach, sidebar, paste, drag anywhere (`useFileDrop` and `DropOverlay`), and
  `?doc=` from the landing page or Library.
- **Destination:** "My documents", found or created by `ensureMyDocuments`.
- **Batching:** `requestGroups` splits a batch so each request fits the 26 MiB proxy body limit.
- **Polling:** `useDocStatus` polls with backoff, pauses while the tab is hidden and resets on focus. A
  forced check that gets no fresh data keeps retrying. A 401 is treated as "no update" rather than a
  redirect.
- **Hold and auto-send:** a question sent while a file is still being read waits under a "Waiting
  for…" note, with "Ask now without it" and Cancel. It sends when the file reaches a terminal state.

### 6.6 Answers

| State | What the user sees |
|---|---|
| Waiting | Three dots and timed labels from 0.5s. Stop appears at 25s. |
| Provenance | "Found in your documents", plus "Exact quotes · no AI writing", "Written by Claude", or "Written by {model name}". |
| Found, extractive | Quote blocks grouped by source, no Markdown. |
| Found, written | Text with inline citation chips. `**bold**` renders and heading markers are dropped. No raw HTML. Tables and list syntax stay as plain text. |
| Not found | Neutral grey card. "Not found in your documents" or "Your documents don't answer this", with Rephrase and other recovery buttons. |
| Hidden (`content_withheld`) | Neutral card with the API's note and "Ask again", which fills the composer without sending. Shows no sources or badges. |
| Deleted chat | "This chat isn't available." with "Start a new chat", which restores the question. |
| Error | A card under the kept question with Try again and a reference id, never a toast. |
| Rate limited | Warning card with a countdown from `Retry-After`. |

**Stop does not cancel on the server.** It stops waiting and returns the question to the box, and says
on screen: "The answer may still be saved to this chat." The question and answer are still saved and
can feed follow-up search. See PROGRESS open risks.

### 6.7 Citations and sources

- Chips are built only from `citations[]`. A marker with no citation is stripped.
- A chip opens the panel or sheet, scrolls to its card and flashes it. Keyboard activation moves focus
  to the card, and "Back to answer" returns it.
- PDF citations read "Page n". DOCX, TXT and Markdown read "Section", because those formats are
  extracted as one page and the API returns `page: null` for them.
- A deleted document's citation is grey and reads "Source no longer available".
- A source card holds the highlighted quote, a "Best match" tag on the top result (never a raw score),
  Copy quote, and Download file for roles with `document:read_content`.

### 6.8 Scope

`ScopeChip` reads "Searching: All documents · 16". Counts include only indexed documents and are
computed client-side. A new chat starts on all accessible collections. Narrowing affects that chat
only and is sent as the per-message `collection_ids` override. The session is created on first send.

### 6.9 Empty and blocked states

`AskEmptyState` handles: loading (no flash of the empty state), auditor, operator with nothing Ready,
can upload with no documents, reading with none Ready, Ready for a new chat, and chat not found.
`SuggestionChips` builds starter questions from Ready filenames with a static fallback. A click sends
at once.

## 7. `/library`

`components/workspace/library/`: search by file name, filter chips (All, Ready, Getting ready, Needs
attention), collection menu. A table at 768px and wider, card rows below that, and an Upload button
fixed at the bottom on small screens.

- Upload rows with a document id appear ahead of the list only if this page saw them uploading.
  Documents arriving through "Ask about this" appear only through the document list, under their real
  collection name.
- A 404 on delete is rechecked. If the file is still there, the dialog stays open with a write-access
  message and nothing is announced as removed.

## 8. Admin console

`components/Shell.tsx` groups the NAV as: Overview; Knowledge Base (Collections, Documents); AI quality
(Retrieval inspector, Evaluation); Operations (Job queue, Workers, Model serving); Infrastructure
(Racks & workloads); Administration (Users & roles, Audit log, Settings). Items are filtered by
permission. Below `md` the NAV is a native `<dialog>` drawer.

Rules that hold across the console:

- A page a role cannot use shows "{Page} needs a different role" (`NoAccess` in `Can.tsx`), a normal
  region rather than an alert.
- **Documents:** real paging with `next_cursor` (First, Previous, Next page). Changing a filter starts
  from the newest. "Evaluation" collections are matched by exact seeded name.
- **Document detail:** stage timeline, extraction quality and chunks with Load more. After a failed
  delete, Retry is hidden and "Delete again" is offered with a confirmation.
- **Evaluation:** "Completed with errors" uses the amber warning badge, never a green check.
  Questions and answers are hidden by role. Prepare corpus reports refused files instead of saying
  ready.
- **Audit:** `auth.*` rows with no actor read "Not signed in"; other null actors read "system".
- **Settings:** with an override set, the page shows "Deployment default" and no number, because the
  API does not expose the default while overridden.
- **Users:** a role change needs a confirmation dialog.

**Infrastructure** is a software inventory (ADR-002, ADR-020):

- Badges: `Configured`, `Simulated`, `Integration-reported`, `Unknown`.
- Provenance is always visible. Allocation is labelled requested versus configured, never measured
  usage.
- There are no controls that imply power cycling or live hardware control.

## 9. Visual system

Defined in `app/globals.css`. Values match §8.1 for every added token.

- **Colour:** one teal accent for actions, selection and citation chips. Yellow for quoted evidence.
  Red only for problems the user must act on. Full light and dark token sets, under both
  `prefers-color-scheme` and `data-theme`. There is no theme toggle yet.
- **Type:** Inter Variable, self-hosted at build time. App body 14/22, chat 16/26, floor 12px except
  the 11px chip digits.
- **Shape:** radii 4, 8, 12, 16, 20, 24 and full. Static cards use a border. Menus and toasts use
  `--elev-3`.
- **Motion:** CSS only, capped at 300ms apart from the flash and dash loops. A global
  `prefers-reduced-motion` guard. `forced-colors` block for badges, chips and focus.

## 10. Accessibility and responsive rules

Target: WCAG 2.2 AA (§9). `e2e/a11y.spec.ts` and `e2e/a11y-gates.spec.ts` cover axe on the main pages
and dialogs, plus keyboard behaviour. These run locally, not in CI.

- One polite announcer, `#sr-announcer`, in the root layout. The transcript has no `aria-live`.
- Native `<dialog>` via `Sheet.tsx`, with visible Close. Swipe is never required.
- Skip links: "Skip to question box" on `/ask`, then "Skip to main content".
- Every dropzone has a real file-input button. Touch shows "Tap to choose a file" and no drag overlay.
- Inputs use 16px text on mobile. Hover-only actions are revealed on `(hover:none)` devices.
- Breakpoints: 640 (persona cards 2-up), 768 (library table, landing panels side by side), 1024
  (persistent sidebar), 1280 (docked sources).

## 11. Component map

| Area | Components |
|---|---|
| Shared | `Shell`, `Can`, `DemoStrip`, `Sheet`, `StatusPill`, `ui.tsx`, `icons`, `Logo` |
| Landing | `HeroUpload` + `useHeroUpload`, `DemoPersonaCards`, `Visitor`, `LandingNav`, `FactStrip`, `HowItWorks`, `Features`, `Faq`, `LandingFooter` |
| Workspace | `WorkspaceShell`, `ChatSidebar`, `Composer`, `AttachmentChip`, `DropOverlay`, `ScopeChip`, `Thread`, `AnswerBlock`, `WaitingIndicator`, `CitationChip`, `SourcesPanel`, `SourceCard`, `NotFoundCard`, `AnswerErrorCard`, `AskEmptyState`, `SuggestionChips`, `UploadsProvider` |
| Ask hooks | `ask/useChatSession`, `useArrival`, `useAskData`, `useAskRoute`, `useSourcesState`, `useUploadSignals`, `chatApi`, `helpers` |
| Library | `library/LibraryView`, `LibraryList`, `Toolbar`, `RowMenu`, `ConfirmDelete`, `UploadNotes`, `useLibraryDocs` |
| Libraries | `lib/status`, `demo`, `workspace`, `useDocStatus`, `useFileDrop`, `pendingStore`, `suggestions`, `permissionCopy`, `announce`, `api` |

## 12. Where the code differs from the spec

| Spec | Code | Note |
|---|---|---|
| §2.1 `(marketing)` route group | `/` and `/login` sit directly under `app/` | Same behaviour: one root layout, public pages |
| §3.2 Cancel aborts the XHR and keeps the file | Deferred cancel at 98% or more, plus stored-file reporting and removal | The spec's Cancel could claim "cancelled" for stored files |
| §3.2 not covered | Expired-session hold, shared busy flag across the two hero cards | Added after review |
| §3.7 FAQ items 3 and 6 describe only extractive mode and Claude | `Faq.tsx` holds for any provider | **Spec text at lines 199 and 202 is out of date** |
| §5.5 one multipart POST of up to 20 files | `requestGroups` splits by the 26 MiB proxy limit; the hero sends one request at a time | Larger bodies arrive cut short through the proxy |
| §5.6 "Written by Claude" for any model | "Written by {model name}" for non-Anthropic providers; the caveat says "The AI model" | Exception below |
| §5.6 markdown SHOULD | Bold and heading markers only; tables and lists stay plain | A plain-text prompt rule caused wrong abstentions on Groq and was removed |
| §5.6 no withheld state | `content_withheld` card with "Ask again" | Added with the access fix (ADR-009) |
| §5.6 Stop has no extra copy | Stop says the answer may still be saved | Server-side cancel does not exist |
| §5.7 "Section" for TXT and MD | Also DOCX | DOCX is extracted as one page |
| §5.4 reason table | Adds `NO_EXTRACTABLE_TEXT`, `DEPENDENCY_UNAVAILABLE`, `STORAGE_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `DELETE_FAILED` | |
| §7 deferred: console mobile drawer, role-change confirmation | Both built | Ahead of the spec's priority |
| §3 and §9 #1: CI asserts `/` is Static and runs axe | `ci.yml` does neither | Checked locally only; see PROGRESS |
| Original design: "clear warning that answers should be verified for critical operations" | Only the caveat line in 6.3 | **Owner decision open:** restore the stronger wording, or accept the removal |

**Known inconsistencies still in the code:**

- `AnswerBlock.modeBadge` falls back to "Written by Claude" when an answer has no model data and the
  deployment mode is `llm`, whatever the provider. Answers normally carry their model, so this should
  be rare, but on a Groq stack the label would be wrong.
- The hero says "See the exact page" and "quotes the passage and page". That is true of PDFs only.
  Other formats cite a section.
- `FactStrip` says "Your files stay where RackFlow is installed". This is true of whole files, but it
  sits above an FAQ saying matching passages may go to an outside model.
- The Evaluation page's note says questions and answers are hidden "for roles without document-content
  access". They are now also hidden when the reader lacks access to one of the run's collections.
- `lib/workspace.ts` `uploadToMyDocuments` has no callers.

## 13. Spec items not built

- `is_demo` and `persona_key` on `/auth/me`; revoking the previous session on demo login.
- `insufficient_reason` and `nearest[]`, and the "Closest passages" disclosure.
- `indexed_count` and `pending_count` on collections (counts stay client-side).
- `download?inline=1` and an in-app page viewer; `POST /me/inbox`; upload limits in `GET /auth/demo`.
- A clean demo seed and a pre-indexed sample document.
- Chat search (Ctrl+K), "Hide history", the IndexedDB pending stash, a `proxy.ts` cookie redirect.
- Console `/admin/*` re-organisation and page switcher; protecting persona accounts from role changes;
  a console health dot; a theme toggle.
- Answer feedback, pdf.js passage highlight, curated starter questions, pinned chats.
