# 🚀 nextDash

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard. Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

---

## Screenshots

| ![1](screenshots/nextdash-1.png) | ![2](screenshots/nextdash-2.png) |
|:---:|:---:|
| ![3](screenshots/nextdash-3.png) | ![4](screenshots/nextdash-4.png) |
|:---:|:---:|
| ![5](screenshots/nextdash-5.png) | ![6](screenshots/nextdash-6.png) |
|:---:|:---:|
| ![7](screenshots/nextdash-7.png) | |

---

## Quick Start

### Docker Compose (recommended)

```yaml
services:
  nextDash:
    image: ghcr.io/jordibrouwer/nextDash:latest
    container_name: nextDash
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8080
    restart: unless-stopped
```

```sh
docker-compose up -d
```

### Build from source

```sh
go build -o nextDash && ./nextDash
```

---

## Security

nextDash is built for **personal or small-team use on a trusted network**. There are no built-in user accounts or access control — anyone who can reach the URL can read and modify your data.

**Do not expose nextDash directly to the public internet.** Recommended setups:

- **Private overlay network** — [Tailscale](https://tailscale.com/) or another mesh VPN so nextDash never gets a public listener.
- **Reverse proxy with auth** — Traefik, Caddy, or nginx inside your home/lab/VPC, with HTTP basic auth, OAuth2 Proxy, or SSO in front.
- **Local-only** — bind to `127.0.0.1` and use SSH port forwarding or a same-machine browser.

---

## Features

### Keyboard-first workflow

**Navigation**
- `1–9` — jump directly to a page tab
- `Shift + ←/→` — cycle between page tabs
- `,` — page overview: all pages with bookmark counts
- `↑/↓/←/→` — move focus through the bookmark grid
- `Tab` / `Shift+Tab` — step linearly through all bookmarks
- `G + 1–9` — jump to the nth category and select its first bookmark
- `Enter` / `Space` — open the focused bookmark
- `Esc` — clear selection or close overlay

**Bookmarks**
- `+` — quick-add omnibox: type `name | url | shortcut` in one line
- `&` — open the full new-bookmark modal (dashboard only, when no input is focused)
- `Ctrl + Shift + A` — same full new-bookmark modal from anywhere
- `Ctrl + V` — paste a URL anywhere on the dashboard to open the new-bookmark modal pre-filled
- `;` — inline-edit the focused bookmark
- `Shift + M` — *Move to…* quick-move popover: choose a category or page with arrow keys
- `Ctrl + C` — copy the URL of the focused bookmark (row flashes green)
- `[` — toggle the hover preview card on the focused bookmark
- `Delete` — delete the focused bookmark

**Search & commands**
- `>` — open search; empty state shows recent queries and saved searches as separate groups
- `/` — fuzzy search; ranked by prefix → word-boundary → substring; also matches URL domain, tags, and note text
- `:` — command palette
- `?` — finders (e.g. `?g query` to search Google)
- `*` — recent bookmarks panel
- `! or F1 or Ctrl+/` — keyboard cheat sheet (filterable with a type-to-search input)
- `category:` / `tag:` / `page:` / `status:` — filter directly in the search bar
- `:goto <url-or-domain>` — navigate to a URL or bare domain (e.g. `:goto github.com`)
- `:new` — open new-bookmark modal (same as `&` / `Ctrl+Shift+A`)
- `:note` — edit the note of the focused bookmark
- `:pin` / `:unpin` — toggle pin on the keyboard-selected bookmark
- `:tag <tagname>` — add or remove a tag on the selected bookmark
- `:open all` — open all bookmarks on the current page in new tabs
- `:open last [n]` — open the N most recently opened bookmarks on the current page (default 5, max 50; same 15-tab safe cap as `:open all`)
- `:remove` — delete the focused bookmark
- `:sort <method>` — `order` / `az` / `recent` / `custom`
- `:stale [days]` — list stale bookmarks; optional day window (e.g. `:stale 7`)
- `:layout <preset>` — `default` / `compact` / `cards` / `masonry` / `list` / `launcher` …
- `:theme <name>` — switch colour theme
- `:density <mode>` — `comfortable` / `compact` / `dense`
- `:columns <n>` — set column count (1–6)
- `@` — global search across all pages at once; each result shows the page name as context
- `:find <text>` — hide tiles whose name or URL don't match; clear with `:find`
- `:buttonbar <position>` — move the button bar: `bottom` / `bottom-left` / `bottom-right`
- `:save` / `:saved` — save current query / show saved searches

**Config page**
- `1–8` — jump between config tabs
- `S` — save changes
- `Alt + ↑/↓` — reorder the selected bookmark
- `Ctrl/Cmd + K` — open the config command palette

#### Config → General (for self-hosters)

**Essentials vs Advanced** — On `config#general`, everyday options (language, appearance, layout, bookmarks) live under **Essentials**. Power features (smart collections, status monitor, branding, search behaviour, backups) are under **Advanced**. Use the section links at the top of Advanced to jump, or click **Show all sections on one page** to view everything at once.

**ℹ info buttons** — Click the small ℹ next to any setting label for a short explanation in your current language (EN / NL / DE / FR). No need to leave the page or search the README for what a toggle does.

**Branding & PWA** — Custom title and favicon under Advanced → Branding apply to the browser tab, the web app manifest (`/manifest.webmanifest`), and “Add to Home Screen” / installed PWA name and icon.

In-app help: Config → Help tab → *General settings* (same content, translated).

### Search filters

Type these directly in the search bar:

- `category:` — filter by category name
- `status:online` / `status:offline` / `status:broken` / `status:ok`
- `status:pinned` / `status:unpinned` / `status:checked` / `status:unchecked`
- `page:current` / `page:all` / `page:2`
- `tag:name` — filter by tag

### Organisation

- Unlimited pages and categories
- Drag-and-drop reorder within and between categories (drag strip on the left)
- Long-press a bookmark row (~500 ms) to open inline edit
- Double-click a page tab to rename it — also set an emoji icon and a colour dot per page
- Double-click a category header to rename it
- Collapsible categories with optional always-collapsed default
- Tags on bookmarks with autocomplete; filter by tag in search and collections

### Smart collections

Dynamic bookmark groups that appear automatically:

- **Today** — bookmarks matching your work/evening/weekend keyword sets
- **Recently opened** — bookmarks you've opened lately
- **Most used** — your highest open-count bookmarks
- **Stale** — bookmarks you haven't visited in a while
- **Tag collections** — one group per tag, shown when a tag has enough entries

### Appearance

- 37+ built-in theme families, dark and light variants (including Terminal Amber, Dusk Horizon, Moss & Stone, Candy Pop, Midnight Ink)
- Custom theme editor
- Auto dark mode
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List, **Launcher** (large favicon tiles)
- Launcher view: toggle via FAB button (⊞) or `:layout launcher`; icon size configurable (small / normal / large)
- Button bar position: center-bottom (default) or corner dock (bottom-left / bottom-right) via Config or `:buttonbar`
- ★ What's New star button in the corner opposite the button bar — always visible, opens release notes
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Hover preview cards with configurable delay
- Background image or gradient support
- Clickable date/time header showing a week-overview popover; optional calendar URL link

### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- Health view with dead-link detection; suggests archive/redirect/title fixes with one-click apply
- Health badge on the dashboard header: text pill (e.g. `3 broken`) with red/yellow styling; bulk open broken links asks for confirmation with a per-batch limit
- Filter, sort, and search state in the health view persists across page refreshes (sessionStorage)
- Favicon auto-refresh from the health view
- Usage stats in the config: top patterns, open counts, last-used dates
- Conflicts & duplicates block in stats: shows duplicate URL count and shortcut conflicts with a direct link to health

### Bookmarks

- Metadata auto-fetch (title, description, preview image) when adding a URL
- Hover preview card shows full URL, open count, and last-opened date
- Flash animation on bookmark open — subtle ripple confirms the action was registered
- Plain-text notes per bookmark — visible on the dashboard, in hover previews, and editable via command bar (`:note`), inline edit, or the config detail panel
- Open-count badge tracking usage per bookmark
- Pin bookmarks to keep them at the top
- Import from browser HTML export (Chrome, Firefox, Edge) — folders become categories, duplicate URLs skipped
- Export all bookmarks to CSV (Name, URL, Category, Page, Shortcut)
- Full ZIP backup and restore (pages, bookmarks, categories, settings, themes)

### Notifications

- Toast notifications with undo support
- Configurable toast duration

### Localisation

Full UI translations available for English, Dutch, German, and French.

---

## Mouse gestures

| Gesture | Action |
|---|---|
| Drag the left strip of a bookmark | Reorder within category or move to another category |
| Long press a bookmark row (~500 ms) | Open inline edit |
| Hover over a bookmark | Show preview card (if enabled) |
| Double-click a page tab | Rename the page |
| Double-click a category header | Rename the category |

---

## Browser Extension

The **nextDash Bookmark Saver** extension (`extension/`) lets you save the current browser tab directly to a nextDash page.

### Install (Chrome / Chromium)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repository

### First-time setup

1. Click the extension icon
2. Open the **Settings** tab
3. Enter your nextDash server URL (e.g. `http://localhost:8080`)
4. Choose a default page and save

See `extension/README.md` for full usage and development notes.

---

## Changelog

### v2026.05.7 — May 2026

**Search & commands**
- **:open last [n]** — open the N most recently opened bookmarks on the current page from the command palette (`lastOpened`). Default `:open last` opens 5; `:open recent` is an alias. Max request 50; same 15-tab safe batch as `:open all` when N is large.

**Config → General**
- **Visible nested settings** — parent/child checkboxes (smart collections, page tabs, status options) use tree guide lines and ├── / └── symbols so hierarchy is obvious.
- **Status-dependent rows** — child options under Status dim and disable when the status feature is off.

**Browser extension**
- **Save anyway on duplicate URL** — inline warning when the URL already exists on the page, plus a *Save anyway* button; optional setting to allow duplicate URLs without the extra step.

**Help**
- **What's new only where it belongs** — the What's New section was removed from Config → Help. Release notes remain on the dashboard ★ FAB and Config → Advanced → What's new.

---

### v2026.05.6 — May 2026

**Pages & persistence**
- **Page 1 / “main” after restart** — empty page names and missing page-1 metadata are normalised on load and save, so Config → Pages always shows your first page correctly after a server restart.
- **Auto-repair on open** — the config pages tab detects stale page data and persists repairs when needed.

**Bookmarks UX**
- **Mobile + Bookmark** — the footer *+ Bookmark* button is easier to spot on phones; config bookmarks empty state points to the same actions on mobile.
- **Smarter empty states** — touch devices no longer show keyboard shortcuts in empty libraries; desktop empty states mention `+` quick-add and `&` / `Ctrl+Shift+A` for the full form.
- **Conflict hints when it matters** — duplicate URL and shortcut warnings in the add modal, inline edit, and config detail panel appear only after you type a value.
- **Detail panel i18n** — move, fetch favicon, tags, pinned/status toggles, and related hints are translated (EN / NL / DE / FR).
- **Unified add-bookmark form** — dashboard quick-add, `&` / `Ctrl+Shift+A` modal, and `:new` share the same full form with dashboard + link preview strips.

**Shortcuts & docs**
- **One shortcut story everywhere** — cheat sheet, tooltips, help, and empty states agree: `+` = quick-add line; `&` / `Ctrl+Shift+A` = full new-bookmark modal; `:new` = same modal from command mode.
- **Config → Keyboard tab** — a read-only *Bookmarks* section at the top lists those default add-bookmark shortcuts (matches the cheat sheet).

**Browser extension**
- **Same page list as config** — the popup normalises pages like the dashboard config tab; page 1 is never missing from the picker.
- **Duplicate URL hint** — typing a URL that already exists on the selected page shows an inline warning (same pattern as the add modal) instead of a “save anyway?” confirm dialog.
- **Link preview in popup** — optional dashboard and link preview strips while saving from the browser toolbar.

---

### v2026.05.5 — May 2026

**Config → General**
- **ℹ info buttons** — click ℹ next to any setting label in General for a short explanation in your current language (EN / NL / DE / FR). Essentials and Advanced each cover dozens of options.
- **Essentials / Advanced layers** — everyday options (language, appearance, layout, bookmarks) under **Essentials**; power features (smart collections, status, branding, backups) under **Advanced**. Sticky section links at the top of Advanced; *Show all sections on one page* reveals everything at once.
- **Layer intro hints** — short guidance at the top of Essentials and Advanced explains what lives in each layer and points you to ℹ for detail.
- **Layout & smart collections i18n** — layout preset descriptions and smart-collection UI strings are fully translated (no more hardcoded Dutch in the template).
- **Tuning wizard** — after first-run onboarding, an optional one-time 3-step guide on the dashboard: **language** → **theme** → **browser extension**. Choices save immediately; skip anytime.

**Branding & PWA**
- **Dynamic web app manifest** — `/manifest.webmanifest` reads your custom title and favicon from settings, so “Add to Home Screen” / installed PWAs match your branding — not only the browser tab.
- **Apple web-app meta** — matching `apple-mobile-web-app-title`, touch icon, and theme colour on dashboard, config, health, and colors.

**Accessibility**
- **Bookmark grid semantics** — the dashboard bookmark area uses `role="grid"` with `row` / `gridcell` on each tile; categories are `rowgroup` with labelled headers.
- **Focus on bookmark tiles** — roving `tabIndex` on the open link pairs with clearer `:focus-visible` rings; keyboard-selected rows show an accent outline on the link (launcher layout included).
- **Selection & labels** — arrow-key selection sets `aria-selected`; open links include the shortcut in `aria-label` when one is set.

**Polish & docs**
- **Unified toasts** — dashboard, config, and colors share the same toast component for success, errors, and undo — consistent placement and styling.
- **Help & README for self-hosters** — Config → Help → *General settings* and the README document Essentials vs Advanced, ℹ buttons, and branding/PWA in plain language.

---

### v2026.05.4 — May 2026

**UX & discoverability**
- **Rich keyboard tooltips** — on desktop, hovering footer buttons shows the action name plus shortcuts in `<kbd>` chips (e.g. `>` search, `&` for the new-bookmark modal). Hidden on touch devices.
- **Search-flow hint with labels** — the first-run hint above the button bar uses `<kbd>` chips plus text labels (search · commands · finders · bookmark); includes a swipe-between-pages hint on mobile.
- **Mobile bottom bar** — short text labels under footer icon buttons; a mini status line on small screens shows date · current page · health summary.
- **Post-setup wizard** — after onboarding, empty libraries get a 3-step guide: open **config → pages**, add your first bookmark (quick-add or **config → bookmarks**), then finish.
- **Tips auto-expire** — rotating footer tips turn off automatically 7 days after onboarding (still configurable in General).
- **Skeleton loading** — dashboard, config, health, and colors show shimmer placeholders while data loads instead of a blank flash.

**Health (beta)**
- **Bulk open confirmation** — *Open broken links* asks for confirmation with the total broken count and a per-batch limit (default 10, max 25).
- **Health badge on dashboard** — the health link shows a text pill like *3 broken* (or a warning count), not only a number; refreshes when you return to the tab.

**Browser extension**
- **Save success panel** — the popup stays open after save with an *Open in nextDash* deep link to the right page (`#tab`).
- **Dashboard toast** — if the dashboard tab is open on the same server, a success notification appears and bookmarks refresh.
- **Extension UI translated** — popup strings in EN / NL / DE / FR; language follows nextDash server settings when configured.

**Accessibility**
- **Modal semantics** — global confirm/delete modals use `role="dialog"`, `aria-modal`, and labelled titles (aligned with quick-add).
- **Config tab list** — `role="tablist"` / `aria-selected` on config tabs.
- **Skip links** — “Skip to main content” on dashboard and config.
- **Custom selects** — combobox/listbox ARIA on styled `<select>` widgets.
- **prefers-reduced-motion** — inline-edit reveal animation respects reduced motion.

**Config polish**
- **Sticky save bar** — save / unsaved / undo / discard stay visible while scrolling config.
- **Autosave for low-risk fields** — language, theme, and similar toggles save without a full Save click.
- **General tab intro** — short explanation at the top of General; *backups* tab routing fixed; page `lang` matches your language.
- **Ko-fi overlay removed** — floating support button removed from the config page (intro link in General remains).

**Translations**
- **DE / FR coverage** — new dashboard strings (skip link, health confirm, swipe hint, tooltips, post-setup wizard, and more) added for German and French.

---

### v2026.05.3 — May 2026

**Button bar position**
- **Corner dock mode** — move the button bar to the bottom-left or bottom-right corner via Config → General → Header & Buttons. In dock mode the buttons become a compact 2-column widget: primary actions (`>` `:` `?`) in one column, secondary actions (`!` `*` `⊞`) in the other. The standalone launcher FAB is replaced by the `⊞` button inside the dock.
- **:buttonbar command** — change button bar position from the command palette: `:buttonbar bottom` / `:buttonbar bottom-right` / `:buttonbar bottom-left`. Current position is shown with ✓.

**Search**
- **@ global search** — type `@` to fuzzy-search across all pages at once. Each result shows the page name as context so you know where the bookmark lives without switching pages.
- **:find \<text\>** — filter bookmark tiles on the current page from the command palette. Tiles whose name or URL don't match are hidden in place. Run `:find` with no argument to clear the filter.

**Page customisation**
- **Page emoji icon** — double-click any page tab on the dashboard to open a popover where you can give the page an emoji icon, displayed inside the tab alongside the page name.
- **Page colour dot** — choose one of 8 accent colours (or none) for each page in the same popover. A small colour dot appears in the tab for quick visual identification.

**What's new improvements**
- **★ FAB button** — a star button is always visible in the corner opposite the button bar. Click it at any time to open the release notes modal.
- **What's new group in search** — when release notes are unread, a *What's New* group appears in the `>` search empty state. Clicking the item opens the modal and the group disappears (also hides automatically after 7 days).

**Cheat sheet & themes**
- **Cheat sheet restructured** — 6 sections: navigation, bookmarks, search modes (including `@`), commands — bookmarks, commands — appearance (`:buttonbar` `:fontsize` `:favicons` `:preview` `:packed`), and other.
- **5 new themes** — Terminal Amber, Dusk Horizon, Moss & Stone, Candy Pop, and Midnight Ink, each in dark and light variants. Brings the total to 37+ built-in theme families.

---

### v2026.05.2 — May 2026

**Search & commands**
- **Fuzzy search on URL, note & tags** — the `/` fuzzy mode now also matches against a bookmark's URL domain, tags, and note. Secondary-field results rank below name matches and show a small context snippet (URL, `#tag`, or note excerpt).
- **Saved searches as separate group** — opening the `>` search bar now shows *Recent* (last 5 queries) and *Saved searches* as two distinct groups. Saved searches are collapsed by default.
- **:open all** — opens all bookmarks on the current page in new tabs. Shows a "first 15" safe option plus "open all" when the page has more bookmarks.
- **:pin / :unpin** — toggle the pin flag on the keyboard-selected bookmark from the command palette without opening Config.
- **:tag \<tagname\>** — add or remove a tag on the selected bookmark. Typing `:tag` alone shows the bookmark's current tags.
- **:stale \[days\]** — accepts a custom day window: `:stale 7`, `:stale 90` etc. Default remains 30 days.

**Keyboard cheat sheet**
- **Searchable cheat sheet** — a filter input at the top of the `!` / `F1` cheat sheet lets you type to instantly narrow the shortcut list. Matching sections expand automatically; empty sections are hidden.

---

### v2026.05.1 — May 2026

**Launcher view**
- **Launcher layout preset** — a new *Launcher* layout shows large favicon tiles (48 px icons) grouped in horizontal category rows. Toggle instantly with the FAB button (⊞) in the bottom-right corner; the previous layout is restored when you toggle back.
- **Launcher icon size** — choose Small / Normal / Large in Config → Appearance.
- **Launcher tile animations** — tiles dim while search is active; clicking a tile plays a scale-pulse animation.

**Date header & calendar**
- **Clickable date/time** — click the date/time header to open a mini week-overview popover with ISO week number, all 7 days, and today highlighted.
- **Calendar URL setting** — set your calendar URL in Config → Appearance. The link only shows in the popover when a URL is configured; hidden by default.

**Keyboard shortcuts**
- **Shift+M — quick move** — press Shift+M on a keyboard-selected bookmark to open a *Move to…* popover. Choose any category on the current page or move the bookmark to another page entirely. Arrow keys navigate, Enter confirms, Escape cancels.
- **Ctrl+C row flash** — copying a bookmark URL now flashes the bookmark row with a green tint so the action is visible in any layout, including the launcher.

**Search & commands**
- **:goto command** — type `:goto <url-or-domain>` to navigate directly. Full `https://` URLs open as-is; bare domains like `github.com` get the scheme prepended.
- **Recent searches in empty state** — opening `>` search without typing shows your last 5 searches as clickable chips. Collapsed by default.
- **Fuzzy search ranking** — results are now scored: exact name match → name-prefix → word-boundary prefix → substring. Searching `yt` now ranks `YT` and `YouTube` above bookmarks where `yt` appears mid-word.

**Dashboard polish**
- **Category collapse animation** — replaced the `max-height` hack with `grid-template-rows: 1fr ↔ 0fr`. Collapse and expand are now smooth and proportional regardless of how many bookmarks a category contains.

---

### v2026.05 — May 2026

**Glass-effect config & health**
- **Transparent card backgrounds** — all panels, cards, toolbars and list containers on the Config and Health pages now use a 75 % transparent background so the dot pattern shows through, consistent with the dashboard aesthetic.
- **Save/Discard bar transparent** — the sticky action bar above the tab strip (Save, Undo, Discard) is now fully transparent; the tab strip itself keeps its solid background.
- **What's new link removed from Help tab** — the "Show what's new" button in Config → Help has been removed; the modal still auto-opens on first visit and is reachable from the dashboard prompt.

**Button animations**
- **Pulsing glow on Search & Commands icons** — the search (`>`) and commands (`:`) footer buttons have a subtle repeating glow animation to help new users discover them.

**Onboarding & feature tour**
- **Interactive feature tour** — an 8-step guided tour walks new users through search, commands, finders, columns, smart collections and bookmark management. Launch it from the tour spotlight or from Config → Advanced at any time.
- **Tour spotlight notification** — appears once, 2 seconds after onboarding completes, inviting new users to start the tour. Dismissible; restart any time from Config → Advanced → Reset notification.
- **Animated search flow hint** — on first load the `>` `:` `?` `!` hint above the footer buttons wipes in segment by segment with a spring pop on the accent characters, then auto-dismisses. Shown only once per browser.

**Buttons & discoverability**
- **Finders & Commands buttons on by default** — new installations now show both buttons immediately, without needing to enable them in config.
- **Tips above buttons restored** — the rotating tip element was missing from the HTML; tips now render correctly when enabled in config.

**Translations (i18n)**
- **Feature tour fully translated** — all 8 step titles, body text, field labels, options and navigation buttons are translated into EN / NL / DE / FR with English as the fallback.
- **Hardcoded Dutch strings removed** — undo button label, backup tip, tour spotlight and config tour section are now resolved from translation keys for all supported languages.

**Stats insights dashboard**
- **Two-column layout with index navigation** — the Stats tab is now a full insights dashboard. A sticky index on the left lets you jump to any of the 10 sections; a scrollspy keeps the active link highlighted as you scroll.
- **Per-section time period buttons** — activity, top bookmarks, pages, categories, and rot & cleanup each have their own week / month / 3 months / 6 months / all-time selector that re-renders only that section.
- **Activity sparkline** — an SVG bar chart shows when bookmarks were last opened, bucketed to fit the chosen period.
- **Cleanup score** — a 0–100 health score with a colour bar. Penalties are explained line-by-line: never-opened, stale 90+ days, duplicate URLs, and shortcut conflicts.
- **Rot & cleanup section** — summary cards for never-opened, stale, and recently-added counts, plus full tables for deeper review.
- **Info buttons on every section** — click the ℹ next to any section title for a plain-English explanation of what the data shows and how it is calculated.
- **Intro text block** — a brief description at the top of the tab explains the read-only nature of the data and how to refresh it.
- **Fully translated** — all text on the Stats tab (section titles, table headers, labels, period buttons, score messages, info modals) is now resolved from i18n keys in EN / NL / DE / FR.

---

### v2026.04 — April 2026

**Dashboard buttons**
- **Labels removed** — the footer buttons now show only their key symbol (`: ? > * !`). Hover a button to see its name and shortcut as a tooltip.
- **Button order** — the button bar is now ordered: `: commands` · `? finders` · `> search` · `* recent` · `! cheatsheet` (cheatsheet rightmost, recent second-to-last).
- **Config label toggle removed** — the per-button "Label" column in config → Header & Buttons has been removed.

**Config**
- **Tab bar spacing** — the config tab buttons reduce their horizontal padding as the window narrows so all tabs stay fully visible without overlapping.
- **Scrollable modals** — the What's new and Keyboard cheatsheet modals now scroll correctly when their content exceeds the viewport height.

**UI & discoverability**
- **Search mode chips** — the search overlay now shows `> search` · `: commands` · `? finders` chips at the bottom. Click any chip to switch mode; the active chip is highlighted in the mode's accent colour.
- **Button tooltips** — hovering over the search/commands/finders/recent/cheatsheet buttons shows a small tooltip with the corresponding keyboard shortcut. Tooltips are suppressed on touch devices.
- **Search-flow hint redesigned** — the banner above the button bar is now positioned absolutely so dismissing it no longer shifts the buttons. Visual style updated to match the app's border/background tokens (no more blur or pill shape).
- **Mobile header** — on small screens the header stays as a single horizontal row; the date/time widget is hidden to free vertical space.
- **Content area width** — switched from a fixed 80 % to `min(88 %, 1600 px)`, giving ~115 px of extra grid width on a 1440 px screen and capping cleanly at 1600 px on ultra-wide monitors.
- **Config nav links** — "back to dashboard", "health", and "customize theme" links in the config header now use the same text colour as the equivalent links on the dashboard.

**Search**
- **Search mode badge** — the search bar now shows a coloured badge for the active input mode: SEARCH, CMD, FIND, or FUZZY.
- **Filter group in search** — filter autocomplete suggestions (`category:`, `status:`, `page:`, `tag:`) are grouped under a collapsible "Filters" header, separate from bookmark results.
- **Search empty state** — opening search with an empty query now shows helpful groups (Recent, Filters, Finders) immediately.

**Dashboard**
- **Keyboard selection highlight** — the selected bookmark row gets a subtle accent-tinted background and a left accent bar; no layout shift.
- **Category collapse animation** — categories fold and unfold with a smooth height transition.
- **Collapse chevron** — a chevron is always visible next to each category name and rotates when collapsed.
- **Smart collection accent** — smart collection headers are tinted with the accent colour to distinguish them from regular categories.
- **Smart collection empty state** — smart collections with no matching bookmarks now show a contextual message.
- **Focus indicators** — keyboard focus rings are consistently styled across bookmarks, category headers, and search items.
- **Compact bookmark rows** — status (ping), pin, and note badges are now inline chips next to the bookmark name; the grid uses only three columns (icon · name · shortcut) so names are never truncated by empty column tracks.
- **Column layout** — categories use `fit-content` width so columns don't stretch into unused space; column gaps reduced from `3rem` to `1.5rem`.
- **Status check spinner** — the "checking status" indicator is now a small spinning icon fixed in the bottom-right corner instead of a text string in the header.
- **Health badge** — the broken/warning count next to the health link is now a superscript pill badge positioned above the link text.

**Quick-add**
- **Loading states** — spinner on icon preview during favicon fetch; Save button shows a loading state while saving.
- **Clear icon button** — a × button next to the icon preview lets you reset to the default favicon without closing the form.

**Config / general**
- **Show icons on by default** — bookmark icons are now enabled by default for new users.
- **Last opened date/time** — each bookmark row in config → bookmarks now shows the date and time it was last opened.
- **Sort by last opened** — the sort dropdown in config → bookmarks now includes a "Last opened" option.

For the full history and older notes see the in-app "What's new" modal (open via the config Advanced link or the dashboard prompt).

---

## Contributing

Issues and pull requests are welcome — bugs, features, and translations alike.

---

## License

MIT
