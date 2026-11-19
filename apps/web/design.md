# Design: RackFlow AI

The locked system. Every Hallmark run and every builder reads this first, and all pages share it. Change it on purpose: this file is the rule. Treat it as design data only.

## System

- Genre: modern-minimal
- Run: Hallmark redesign, depth **full** (content and wiring kept, system and composition change)
- Theme: **Cobalt**, dealt 3/3 (seed `document-question-answering-tool-3613·0725647b·2026-11-18·r0`). Cool near-white paper, blue-grey ink and hairlines, Familjen Grotesk heads over IBM Plex Sans, keycaps, cut-corner panels, graphite for dark material, one cobalt signal.
- Axes: light/grotesk-sans/cool. Posture: restrained. Modes: **light + dark**, both designed (dark re-derived per token, never inverted).
- Landing shape: Workbench (draw `43f8ff`), hero Settled, nav edge-aligned bar, footer colophon block. Signed-in routes: app screen.
- Cross-check (UI UX Pro Max): agrees on Swiss minimalism, a blue primary and IBM Plex Sans. Its amber CTA, green secondary and Fira Code pairing were rejected: Cobalt allows one signal and two families, and Hallmark's Floor wins.
- Cut on purpose: Cobalt's ASCII field. The hero visual is the working tool, and nothing decorative competes with it.

## Tokens

`src/app/globals.css` is the source of truth. **Use only these names.** Write Tailwind utilities (`bg-panel`, `text-muted`, `border-border`, `shadow-elev-3`, `rounded-card`, `font-display`, `text-display`). Write `var(--name)` only in an arbitrary value. Never write a hex, `rgb()`, `oklch()` or `font-family` in a component.

### Colour roles (utility = `bg-`/`text-`/`border-` + the name)

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `bg` | page ground, app canvas | #f8fbfe | #0a0f13 |
| `landing-bg` | landing ground (= bg) | #f8fbfe | #0a0f13 |
| `panel` | cards, inputs, dialogs, popovers, key faces | #fdfeff | #10151b |
| `panel-2` | sidebar, toolbars, table head row, hover fill | #eff3f8 | #161c23 |
| `panel-3` | trays, pressed keys, selected neutral row | #e3e8ef | #1e252d |
| `border` | every hairline: card edges, row rules | #dadee4 | #272f37 |
| `border-2` | key edges, stronger dividers, popover ring | #c2c8cf | #38414a |
| `border-strong` | input borders, checkbox and radio edges (3:1) | #7a818a | #707883 |
| `text` | ink: body, heads | #111825 | #eaedf2 |
| `text-2` | secondary ink: descriptions in dense UI | #363e49 | #c5cbd4 |
| `muted` | captions, meta, placeholders, labels | #5d646e | #a1a8b3 |
| `accent` | the one signal: primary key, links, current selection | #0462d3 | #609efa |
| `accent-hover` | primary hover and active | #004cc4 | #84b2fd |
| `accent-edge` | primary key bottom edge | #003d98 | #3065be |
| `accent-soft` | selected row or nav item fill, dropzone fill | #e3f0ff | #15273e |
| `accent-contrast` | text on `accent` | #f8fbfe | #080f17 |
| `accent-2` | syntax and highlights on graphite only | #75b4ff | #91c1fd |
| `focus` | focus ring | #0462d3 | #6ba5fb |
| `ok` / `ok-soft` | success text / fill | #21763c / #e3f6e6 | #73cb87 / #132717 |
| `warn` / `warn-soft` | warning text / fill | #925512 / #fdeed7 | #f8af6c / #2f210c |
| `bad` / `bad-soft` | error text / fill | #be2323 / #ffebe9 | #f87f73 / #391917 |
| `info` / `info-soft` | info text / fill | #006a98 / #e2f3fd | #7dc5eb / #0e2530 |
| `dropzone-border` | dashed dropzone edge (3:1) | #4a81cc | #4e7bbb |
| `cite-chip-bg` / `cite-chip-fg` | citation chip rest | #e3f0ff / #0040bb | #15273e / #aecbff |
| `cite-chip-active-bg` / `-fg` | citation chip open | #0462d3 / #f8fbfe | #609efa / #080f17 |
| `cite-hl` / `cite-hl-active` | the quoted passage marker / the one in focus | #cce8ff / #add7ff | #183755 / #1e4976 |
| `demo-bg` / `demo-fg` / `demo-border` | the graphite demo strip | #121823 / #e3e8ee / #272e3b | #222b3d / #e9edf2 / #364053 |
| `graphite` / `graphite-2` / `graphite-ink` / `graphite-muted` | code and log panels (one per screen at most) | #121823 / #1e2532 / #e3e8ee / #939ca9 | #05070b / #10141b / #e3e8ee / #969fab |
| `key-face` / `key-edge` | keycap face / bottom edge | #fdfeff / #b7bec8 | #1b222a / #030507 |

Hues never move between modes. Dark accent sits at L 70%, above dark-mode.md's +5 to 10%, so the primary key can carry dark ink at 7:1 and links read at 7:1 on the ground.

### Contrast (WCAG 2.2, computed from the oklch values; light / dark)

text on bg 17.0 / 16.4 · text on panel-3 14.4 / 13.2 · muted on bg 5.8 / 8.1 · muted on panel-3 4.9 / 6.5 · accent on bg 5.4 / 7.2 · accent on panel-2 5.1 / 6.4 · accent-contrast on accent 5.4 / 7.2 · on accent-hover 7.1 / 8.9 · accent on accent-soft 4.9 / 5.6 · focus on bg 5.4 / 7.7 (3:1 needed) · border-strong on panel 3.9 / 4.1 · dropzone-border on accent-soft 3.4 / 3.5 · ok on ok-soft 5.0 / 8.0 · warn on warn-soft 5.2 / 8.4 · bad on bad-soft 5.3 / 6.2 · info on info-soft 5.3 / 8.4 · cite-chip-fg on cite-chip-bg 7.4 / 9.2 · cite-chip-active 5.4 / 7.2 · text on cite-hl 14.0 / 10.4 · text on cite-hl-active 11.7 / 7.8 · demo-fg on demo-bg 14.4 / 12.0 · graphite-muted on graphite 6.4 / 7.6 · accent-2 on graphite 8.2 / 10.9.
`border` and `border-2` are decorative hairlines, under 3:1 on purpose. Never use them alone as the boundary of a control: inputs, checkboxes and the dropzone take `border-strong` or `dropzone-border`.

### Type

- Families, two: `font-display` = Familjen Grotesk (heads, figures, key labels, the wordmark) and `font-sans` = IBM Plex Sans (everything read). `font-mono` is the system mono stack, used for machine values only: page refs (`p. 12`), file sizes, ids, hashes, emails, code and the copy-reference string. It never sets a label, a head or a chip label.
- Timestamps and dates (table columns, "Updated …", heartbeat times) are the body face with `tabular-nums`, never `font-mono`, so the same kind of value looks the same on every screen.
- Weights, three: 400, 500 and 600. `font-bold` renders 600, so never reach for 700. Heads use 600, item titles and keys 500, body 400. In dark mode the body drops to 370 automatically through `--body-weight`, and `font-normal` follows it (it maps to `--body-weight`), so dark mode still draws three weights.
- App scale (ratio 1.2): `text-xs` 13px · `text-sm` 14px · body 15px · `text-base` 16px · `text-lg` 19.2px · `text-xl` 23px · `text-2xl` 27.6px · `text-3xl` 33px. Use `text-xs` for meta only. Body copy is never under 14px.
- Landing roles (fluid, capped): `text-display` 40 to 68px (h1) · `text-display-s` 32 to 52px · `text-display-hero` 36 to 56px (the landing h1 in its 5-column hero slot; about 56px at 1280 and up) · `text-section` 28 to 44px (h2, about 41.6px at 1440) · `text-title` 18 to 22px (h3) · `text-lead` 17 to 20px (the hero sentence). Set a page's body to `text-base` (16px).
- Heads: h1 to h4 already get `font-display`, 600, `tracking-head` (-0.014em) and break-word from base; h2 to h4 also get `text-wrap: balance`. Display h1s don't: they set their own line breaks. Display sizes add `tracking-display` (-0.028em) and `leading-[1.02]`. A head is one colour and one weight. No accent-coloured second half, no italic word, no highlight inside a head.
- Labels, table heads, sidebar group titles, nav links, chips and tags use the body face a step smaller, sentence case, untracked, in `text-muted` or `text-text-2`. **Never `uppercase`, never `tracking-wide*`.**
- Figures that compare get `tabular-nums` (or the `.num` class).

### Space, size, radius, elevation, motion, layers

- Space: `--space-3xs` 2 · `2xs` 4 · `xs` 8 · `sm` 12 · `md` 16 · `lg` 24 · `xl` 40 · `2xl` 64 · `3xl` 96 · `4xl` 144. In Tailwind: `p-2`=xs, `p-3`=sm, `p-4`=md, `p-6`=lg, `p-10`=xl, `p-16`=2xl, `p-24`=3xl. Don't use off-scale values (`p-5`, `gap-7`, `mt-18`, `[13px]`) in new markup.
- Layout: `--container` 1200px content, `--gutter` 64/24/16px (desktop, under 60rem, under 40rem), `--gap-columns` 32/16px, `--section-gap` 128/96/72px.
- Radius: `rounded-sm` 4 (chips, tags) · `rounded-md` 6 (inputs, keys) · `rounded-lg` and `rounded-xl` 8 (cards, panels, dialogs) · `rounded-2xl` 12 (sheets, large drawers only). Named: `rounded-card` 8, `rounded-input` 6, `rounded-chip` 4. `rounded-full` is for avatars, spinners and round icon-only keys only. **Never a pill button or a pill chip.** Cut corners: add `.cut` to a featured panel (hero tool, graphite panel, dialog) and `.cut-sm` to a small one. It bevels two opposite corners where `corner-shape` is supported and stays a plain radius elsewhere. Use it at most twice per screen.
- Elevation: a 1px `border` plus a paper step is the default (light: `panel` on `bg`; dark: lighter is higher). `shadow-elev-1` for a resting card that floats over content. `shadow-elev-3` for popovers, menus, dialogs and toasts. Keys use `shadow-key`, `shadow-key-accent` and `shadow-key-press`. In dark mode shadows become rings automatically. Never stack a shadow on a card that sits inside a panel.
- Motion: `--dur-micro` 120ms (keys, hovers, chips), `--dur-short` 220ms (menus, popovers, drawer content), `--dur-long` 420ms (sheet slide only). Easing `ease-out` for entering, `ease-in` for leaving, `--ease-drawer` for sheets, `--ease-snappy` for flash. Animate `transform`, `opacity`, colours and `box-shadow` only, listed by property (`transition-[transform,box-shadow]`, `transition-colors`). Never `transition-all`. Use one reveal at most on the landing (the hero sentence), none in the app. The global reduced-motion block already ends everything at once: don't add motion that depends on JS timing without checking `prefers-reduced-motion`.
- Layers: `--z-raised` 10 · `dropdown` 100 · `sticky` 200 · `sticky-nav` 300 · `modal` 400 · `toast` 500 · `tooltip` 600, as `z-[var(--z-modal)]`.

## Controls (every control draws all states in both modes)

States: default, hover, `focus-visible`, active, disabled (`disabled` attribute plus `opacity-55 cursor-not-allowed`, or `aria-disabled`), busy (`aria-busy="true"` plus a spinner or skeleton, label kept), error (`aria-invalid` plus `border-bad` plus a message in `text-bad` with an icon), and selected where it applies (`aria-pressed`, `aria-current`, `aria-selected`). The focus ring is global (2px `focus`, offset 2): never remove it, never transition it. Components that draw their own ring use `focus-visible:outline-none!` plus an equal ring. Hit targets are 44px on touch (`min-h-11` under `sm`), and controls are 32 to 40px tall on desktop.

- **Buttons are keycaps.** Primary: `.key .key-primary`, one per view (dialogs count as their own view). Secondary: `.key`. Large (landing hero and close): add `.key-lg` (48px). Tertiary: a text button in `text-accent` that underlines on hover, `min-h-11 sm:min-h-8`. Destructive: `.key .key-danger` (red text on a key face); a confirm dialog's destructive action may be `.key` with `bg-bad text-panel`. Icon-only: `.key` square (`size-10`, `p-0`) with an `aria-label`. Hover lifts 1px, active sinks 2px into `panel-3`, and disabled stays flat at 55%. The keys already have their transitions and reduced-motion handling: don't add `transition-*` to them.
- **Inputs, textareas, selects:** `bg-panel border border-border-strong rounded-input`, 40px tall (composer excepted), `px-3`, `text-sm` (16px on phones is automatic). Hover: `border-text-2`. Focus: the global ring (inset with `focus-visible:outline-offset-[-1px]` on inputs inside a tight row). Error: `border-bad`, `aria-invalid`, a message below with `min-h-[1lh]`. Disabled: `bg-panel-2 opacity-55`. Placeholders are `muted`. Labels sit above in `text-sm font-medium text-text`, sentence case.
- **Options (segmented, scope, view switches):** a `.tray` of `.key` buttons with `aria-pressed`, where the pressed key is sunken and marked as selected: `accent` edge and text on an `accent-soft` face (4.9:1 light, 5.6:1 dark), plus a `Highlight` outline in forced colours. globals.css draws this for every `.key[aria-pressed="true"]`. Use these instead of pills.
- **Chips and tags:** `rounded-chip border border-border bg-panel-2 px-2 h-6 text-xs text-text-2`. A removable chip takes an icon key (`aria-label="Remove …"`) at 24px with a 44px hit area. Never a pill.
- **Status pills (StatusPill, StatusBadge, Badge):** text plus one glyph in the status colour on its soft fill, `rounded-chip`, `text-xs font-medium`, no border, no dot. Waiting = `muted` on `panel-2`, Reading/Processing = `info`, Ready = `ok`, Needs attention = `warn`, Failed = `bad`. Status never depends on colour alone.
- **Citation chips (the signature):** a small key, `rounded-chip`, `font-display font-medium text-xs tabular-nums`, `bg-cite-chip-bg text-cite-chip-fg`, min 24x24 (44 hit area). Hover: `border-accent`. Open or active: `bg-cite-chip-active-bg text-cite-chip-active-fg` plus `aria-pressed` or `aria-expanded`. The quoted passage it opens is set in `bg-cite-hl` (the one in focus `bg-cite-hl-active`) with `box-decoration-clone` and a 2px inline padding. The page and section ref beside it is `font-mono text-xs text-muted` (`p. 12`, `§ 4.2`). Missing source: `text-muted line-through` plus the SOURCE_GONE text.
- **Cards:** `bg-panel border border-border rounded-card p-4` (dense) or `p-6`. No shadow at rest unless it floats. **Never a card inside a card.** Inside a card, group with a hairline (`border-t border-border pt-4`) or a `bg-panel-2` well without its own border.
- **Tables:** full width, no outer border and no card around them (the TableWrap scroller may keep a `border-y`). The head row is `bg-panel-2 text-xs font-medium text-muted` in sentence case. Rows are split by `border-b border-border`, hover `bg-panel-2`, selected `bg-accent-soft`. Numbers are right-aligned and `tabular-nums`, ids, hashes and emails in `font-mono`, dates and times in the body face with `tabular-nums`. On a phone, the naming column and the action column stay visible.
- **Nav links (landing):** `text-sm font-medium text-text-2`, hover `text-text`, current `text-text` with a 2px `accent` underline, `min-h-11`.
- **Sidebar (app and /ask):** `bg-panel-2 border-r border-border`. Group titles are `text-xs font-medium text-muted`, sentence case (Knowledge base, AI quality, Operations, Infrastructure). Items are 36px, `rounded-md`, `text-sm text-text-2`. Hover: `bg-panel-3 text-text`. Current (`aria-current="page"`): `bg-accent-soft text-accent font-medium`, with no left bar and no dot. Counts are `tabular-nums text-xs text-muted`, unboxed. New chat is the sidebar's one `.key .key-primary`.
- **Dialogs and sheets:** `bg-panel border border-border rounded-card shadow-elev-3`, `.cut` on dialogs, title `text-lg` in `font-display`, actions bottom-right (primary last), backdrop `bg-scrim` (the `--scrim` token, graphite at 55%, which stays dark in both modes; never a `--text` mix, which turns light in dark mode). Sheets slide over `--dur-long` with `--ease-drawer`.
- **Menus and popovers:** `bg-panel border border-border-2 rounded-lg shadow-elev-3 p-1`, items 36px `rounded-md`, hover `bg-panel-2`, destructive item `text-bad`.
- **Toasts:** `bg-panel border border-border shadow-elev-3 rounded-card`, a status glyph in its colour, text in `text`, one action as a text button, bottom-right (bottom-centre on phones), `z-[var(--z-toast)]`.
- **Empty states:** left-aligned in the region, not centred in a void. A 20px icon in `text-muted` (no tinted circle tile), a `font-display text-lg` line saying what belongs here, one sentence, one `.key` action that fills it.
- **Loading:** skeletons in the shape of what is coming (`bg-panel-3 rounded-sm animate-shimmer`), never a lone spinner for a region. Spinners appear only inside a busy key after 300ms.
- **Errors:** a `bg-bad-soft` block with a `text-bad` glyph and title, what broke, what to do, and one retry key. The copy-reference string is `font-mono text-xs`, but its label is not mono.
- **Demo strip:** `bg-demo-bg text-demo-fg border-b border-demo-border`, 32px. Its menu triggers are text buttons in `demo-fg` with an underline on hover. Split the meta with real punctuation (a sentence or a comma), never middle dots.
- **Graphite panels** (logs, code, the audit trail sample, inspector payloads): `bg-graphite text-graphite-ink`, header strip `bg-graphite-2`, comments `text-graphite-muted`, highlights `text-accent-2`, `font-mono text-sm`, `.cut`. At most one per screen.
- **Icons:** the project's `icons.tsx` set, 16px (inline) or 20px (standalone), `stroke-current`. No emoji. File-type glyphs use `text-muted` (PDF may use `text-bad`), never coloured tiles.

## Copy rules (Floor)

- No middle-dot meta strings (`A · B · C`). Use a sentence, a comma, or separate elements spaced by `gap`.
- No arrow glued to link text (`Continue as Engineer →`). An arrow, if any, is a separate `aria-hidden` icon with a gap, and only on a link that moves you somewhere.
- No eyebrows above heads, no tracked capitals, no decorative status dots.
- No invented numbers, logos, quotes or customer counts. The only figures are the product's facts: 25 MB per file, 20 files at a time, page numbers, document counts from the API.
- Landing: about 80 words per screen. The hero is the headline (seven words or fewer), one sentence and its actions.
- "Acme" in the demo tenant and persona names is API data, not copy. Leave it.
- List every changed line, old to new, for the e2e owners.

## Landing page plan (`/`)

**Shape:** Workbench: the product in use is the content, with short captions in place of marketing copy. **Job:** try (upload a file or ask a question right now, or open a demo account). **Hero posture:** Settled. **Nav:** edge-aligned bar. **Footer:** colophon block. **Signature:** the cited passage, a numbered key chip opening the quote in the cobalt marker with its page in mono, shown on the first screen inside the hero tool's answer preview, or in the How it works capture if the tool cannot show one before input.

Container: `max-w-[var(--container)] mx-auto px-[var(--gutter)]`. Sections are separated by `mt-[var(--section-gap)]`. One column gap below the hero (`gap-[var(--gap-columns)]`). Heads are left-aligned (at most one centred head group on the page).

1. **Nav** (LandingNav), 64px, `bg-bg/90 backdrop-blur border-b border-border` once scrolled (`sticky top-0 z-[var(--z-sticky-nav)]`). Left: the logo and the "RackFlow AI" wordmark in `font-display font-semibold`. Right: How it works, Features, Questions (`text-sm`, hidden under `md` behind the existing menu if any), Sign in (text link), Try a demo (`.key .key-primary`). Ids, hrefs and the DemoOnly wrapper stay.
2. **Hero** (`#hero-title`), fills the screen under the nav at 1280x800 with the tool fully visible. Grid `lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]` with `gap-16`. Left column, vertically centred: h1 `text-display-hero` in one colour (both phrases `text-text`, the line break between them is the stress), the sentence `text-lead text-text-2 max-w-[44ch] mt-6`, then the FactStrip as a three-row `<dl>` ruled by `border-t border-border`, each row a 16px icon in `text-accent` plus the fact in `text-sm`. Right column: HeroUpload in a `.cut bg-panel border border-border shadow-elev-1 p-6` panel, the dropzone `border-dropzone-border bg-accent-soft/40` dashed, the ask box an input per the input rules, its send button `.key .key-primary` square. The supported-types row is plain text in `text-sm text-muted` without middle dots (for example "PDF, Word, text, Markdown and scanned PDFs") with mono-free file icons. The shared-workspace notice stays under the panel in `text-xs text-muted`. Under `lg`, stack the text above the tool. At 320px nothing scrolls sideways.
3. **Demo accounts** (`#demo`, DemoOnly). Drop the "or try a demo account" divider line, since the section head does that job. H2 "Try it with a demo account" `text-section`, left-aligned, its sentence beside it on desktop (`grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`). The four personas are a ruled list or four equal columns separated by `border-l border-border` (not four floating cards). Each is a button with the persona name in `font-display text-title`, its role line in `muted`, its email in `font-mono text-xs`, its permissions as a plain list with check/minus icons, and the destination as a separate line. The whole column is the `.key`-like target: hover `bg-panel-2`, focus ring, busy state. "Start here" becomes a `rounded-chip` tag in `accent-soft`/`accent`. "Have your own account? Sign in" stays below.
4. **How it works** (`#how`). H2 left. Three steps as three columns, each a step number in `font-display text-3xl tabular-nums text-muted`, the step title in `text-title`, one line, and below it a real capture of that step from the running app (file list with a status, the composer with a question, an answer with a citation open), each in a `<figure>` with `rounded-card border border-border`, no browser chrome. Captures are taken in both modes and swapped with `dark:` classes, or a `<picture>` with a `prefers-color-scheme` source plus `[data-theme]` handling.
5. **Features** (`#features`). H2 "Made for answers you can trust". Not a six-card grid. Three split rows that alternate sides: each row has two named moments on 5 columns (`dl`: title `font-display text-title`, one line in `text-2`) beside one capture on 7 columns. Pairs: answers you can check + reads scanned pages; ask the way you talk + says so when it can't find it; four roles + every action is recorded (this capture may be a graphite panel of the audit log rows the page already shows). Keep every title and sentence.
6. **Try it with your own file** (`#try`). The close: HeroUpload compact on 7 columns beside the H2 and the "or pick a demo account" link on 5. No email form.
7. **Questions** (`#faq`). H2 left on 4 columns, the disclosures on 8: a ruled list (`border-t border-border` per item), the question in `font-display text-base font-medium` with a plus/minus icon key at the right, the answer in `text-text-2 max-w-[65ch]`. No grey filled boxes.
8. **Footer** (LandingFooter): colophon block. A `border-t border-border`, the wordmark, then one paragraph in `text-sm text-muted` carrying the product line and the links inline (How it works, Features, Questions, Demo accounts, Sign in, Roles and permissions), then the legal line "© 2026 RackFlow AI, v0.1.0. Demo mode is on: demo accounts are shared." without middle dots. 200 to 320px tall.

Leave out: bento grids, figure rows, icon tiles, gradient blobs or glows behind the hero, and centred section stacks.

## App screens (signed-in: /ask, /library, /chat, /overview, /documents, /collections, /jobs, /models, /workers, /infrastructure, /evaluation, /inspector, /admin/*)

- The shell stays the project's own: the /ask sidebar workspace and the console sidebar with its groups. Restyle only: `bg-panel-2` rail, sentence-case group titles, `accent-soft` current item, `bg` canvas. The sidebar collapses into the existing menu under 60rem.
- The accent marks only the primary action, the current selection and state. Everything else is ink, muted and hairlines. There is one `.key-primary` per view.
- Density: controls 32 to 40px with a 44px hit target, tables before cards, page header = h1 `text-xl` (`font-display`, 600) plus one `text-sm text-muted` line, actions right-aligned on the same row. Page padding `p-6` (desktop), `p-4` (phone). Max reading width for prose is 72ch; tables may go full width.
- Every region that loads data has four states: loading (a skeleton in its shape), empty (what belongs here plus the one action), error (what broke plus retry), and full. Draw the ones the code has logic for, and list missing ones for the owner rather than inventing logic.
- Kpi stat rows: the label in `text-xs text-muted` in sentence case (not uppercase), the value in `font-display text-2xl tabular-nums`, no icon tile and no trend arrow, inside one ruled row (`divide-x divide-border`) rather than four separate cards.
- **Ask workspace signature:** the answer reads as a document. Answer text is `text-base leading-7 max-w-[72ch]` with citation chips inline. The Sources panel lists sources as ruled rows (the file name in `text-sm font-medium`, the page in `font-mono text-xs`, the quote in `cite-hl`). The composer is a `bg-panel border border-border-strong rounded-card` box with a `.tray` for scope and `.key-primary` send. Suggestion prompts are ruled rows or `.key` tiles, not cards with shadows.
- Motion is state only: `--dur-micro` and `--dur-short`, nothing orchestrated, no reveal on load.
- Both modes everywhere. Test every screen at `colorScheme: dark` and with `data-theme="dark"` and `"light"` on `<html>`.

## Exports

The tokens live in `src/app/globals.css` (`:root` light, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]` with identical dark values; Tailwind 4 `@theme inline` maps colours, shadows and faces; `@theme` holds the type scale, radius, weight cap and easing). Fonts are loaded in `src/app/layout.tsx` through `next/font/google` as `--font-familjen` and `--font-plex`. Component classes: `.key`, `.key-primary`, `.key-lg`, `.key-danger`, `.tray`, `.cut`, `.cut-sm`, `.num`.
