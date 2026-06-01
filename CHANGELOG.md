# nextDash — Changelog

Complete release history for [nextDash](README.md), in the same style as the in-app **What's new** modal: version tags, themed sections, and **new** / **fix** labels on each item.

For install and security, see the [README](README.md). For how to use features, see the [user manual](MANUAL.md). The dashboard **★** button and **Config → Advanced → What's new** show the latest highlights only.

---

## Table of contents

- [Unreleased](#unreleased)
- [v2026.06.1 — June 2026](#v2026061--june-2026)
- [v2026.05.7 — May 2026](#v2026057--may-2026)
- [v2026.05.6 — May 2026](#v2026056--may-2026)
- [v2026.05.5 — May 2026](#v2026055--may-2026)
- [v2026.05.4 — May 2026](#v2026054--may-2026)
- [v2026.05.3 — May 2026](#v2026053--may-2026)
- [v2026.05.2 — May 2026](#v2026052--may-2026)
- [v2026.05.1 — May 2026](#v2026051--may-2026)
- [v2026.05 — May 2026](#v202605--may-2026)
- [v2026.04 — April 2026](#v202604--april-2026)
- [v2026.03 — March 2026](#v202603--march-2026)
- [v2026.02 — February 2026](#v202602--february-2026)
- [v2026.01 and earlier — Foundation](#v202601-and-earlier--foundation)

---

## Unreleased

_No shipped release yet — items land here before the next version section._

---

## v2026.06.1 — June 2026

First June 2026 release: shortcut remap, import/health fix workflows, richer **\*** recent panel, and repo documentation.

### Bookmark shortcuts

- **new** **`+`** — opens the **full** new-bookmark modal on the dashboard; toolbar **+** tooltip shows only this key (same as `Ctrl+Shift+A` and `:new`).
- **new** **`&`** — opens the **quick-add** omnibox (`name | url | shortcut` in one line).
- **fix** **Shortcut tooltips** — lone `+` in tooltips and the cheat sheet renders correctly (`shortcut-format.js` no longer splits it as a chord separator).
- **fix** **Cheat sheet, help, empty states, and locales** — EN / NL / DE / FR aligned with the `+` / `&` mapping.

### Import & health workflows

- **new** **Browser import preview** — before confirming HTML import, see **X new, Y conflicts (skipped)**; counts update when you change target page; only new URLs are posted.
- **new** **Health → dashboard deep links** — **dashboard** link on each issue and duplicate-group row (`?page=&bookmark=&category=`); dashboard switches page, expands category, scrolls, and highlights the row.
- **new** **Duplicate group category** — `BookmarkRef` includes category so deep links from duplicate groups land in the right section.

### Recent bookmarks (`*`)

- **new** **Bulk open in `*` modal** — open shown recents or the last N opened from the panel (same 15-tab safe batch as `:open all` when the list is large).
- **new** **`:open last` hint** — panel footer points to `:open last` in command mode (command itself shipped in v2026.05.7).
- **new** **Discoverability** — one-time spotlight on the `*` button (discoverability queue); priority rotating tip for `*` and `:open last`.
- **fix** **Recent list scope documented** — `*` and `:open last` use **page-local** `lastOpened` (not global `allBookmarks`).

### Documentation

- **new** **[MANUAL.md](MANUAL.md)** — full English user manual with table of contents (install, concepts, keyboard, config, import, health, extension, workflows).
- **new** **[CHANGELOG.md](CHANGELOG.md)** — complete release history; README inline changelog removed.
- **fix** **README** — links to MANUAL and CHANGELOG at the top.

---

## v2026.05.7 — May 2026

### Search & commands

- **new** **`:open last [n]`** — open the most recently used bookmarks on the current page from command mode. Default `:open last` opens 5; `:open recent` is an alias. Same safe 15-tab batch cap as `:open all` when N is large.

### Config → General

- **new** **Visible nested settings** — parent/child checkboxes (smart collections, page tabs, status options) show a clear tree with guide lines and `├──` / `└──` symbols.
- **fix** **Status-dependent rows** — child options under Status dim and disable when the status feature is off.

### Browser extension

- **new** **Save anyway on duplicate URL** — inline warning plus *Save anyway* when the URL already exists on the page; optional setting to allow duplicates without the extra step.

### Help

- **fix** **What's new only where it belongs** — duplicate What's New block removed from Config → Help. Release notes stay on the dashboard ★ button and Config → Advanced → What's new.

---

## v2026.05.6 — May 2026

### Pages & persistence

- **fix** **Page 1 / “main” after restart** — empty page names and missing page-1 metadata are normalised on load and save.
- **new** **Auto-repair on open** — config pages tab detects stale page data and persists repairs when needed.

### Bookmarks UX

- **new** **Mobile + Bookmark** — footer *+ Bookmark* button easier to spot on phones; config empty state points to the same actions on mobile.
- **new** **Smarter empty states** — touch devices hide keyboard hints in empty libraries; desktop mentions add-bookmark shortcuts.
- **new** **Conflict hints when it matters** — duplicate URL and shortcut warnings appear only after you type a value.
- **new** **Detail panel i18n** — move, fetch favicon, tags, pinned/status toggles translated (EN / NL / DE / FR).
- **new** **Unified add-bookmark form** — quick-add, modal, and `:new` share the same form with dashboard + link preview strips.

### Shortcuts & docs

- **new** **One shortcut story everywhere** — cheat sheet, tooltips, help, and empty states aligned for add-bookmark keys (see **Unreleased** for the latest `+` / `&` mapping).
- **new** **Config → Keyboard tab** — read-only *Bookmarks* section at the top lists default add-bookmark shortcuts.

### Browser extension

- **fix** **Same page list as config** — popup normalises pages like config; page 1 is never missing from the picker.
- **new** **Duplicate URL hint** — inline warning instead of a blocking confirm dialog.
- **new** **Link preview in popup** — optional dashboard and link preview strips while saving.

---

## v2026.05.5 — May 2026

### Config → General

- **new** **ℹ info buttons** — short explanations next to setting labels (EN / NL / DE / FR).
- **new** **Essentials / Advanced layers** — everyday options under *Essentials*; power features under *Advanced* with sticky section links and *Show all sections on one page*.
- **new** **Layer intro hints** — guidance at the top of each layer.
- **new** **Layout & smart collections i18n** — preset descriptions and smart-collection UI fully translated.
- **new** **Tuning wizard** — optional one-time dashboard guide: language → theme → browser extension.

### Branding & PWA

- **new** **Dynamic web app manifest** — `/manifest.webmanifest` reads custom title and favicon from settings.
- **new** **Apple web-app meta** — touch icon and theme colour on dashboard, config, health, and colors.

### Accessibility

- **new** **Bookmark grid semantics** — `role="grid"`, categories as `rowgroup`, labelled headers.
- **new** **Focus on bookmark tiles** — roving `tabIndex`, clearer `:focus-visible`, accent outline on keyboard-selected rows (launcher included).
- **new** **Selection & labels** — `aria-selected`; shortcuts in `aria-label` when set.

### Polish & docs

- **new** **Unified toasts** — shared toast component across dashboard, config, and colors.
- **new** **Help & README for self-hosters** — Essentials vs Advanced, ℹ buttons, and branding/PWA documented.

---

## v2026.05.4 — May 2026

### UX & discoverability

- **new** **Rich keyboard tooltips** — footer buttons show action name plus `<kbd>` shortcuts on desktop (hidden on touch).
- **new** **Search-flow hint with labels** — chips plus text labels (search · commands · finders · bookmark); swipe-pages hint on mobile.
- **new** **Mobile bottom bar** — short labels under footer icons; mini status line (date · page · health).
- **new** **Post-setup wizard** — 3-step guide after onboarding: pages → first bookmark → finish.
- **new** **Tips auto-expire** — rotating footer tips turn off 7 days after onboarding (configurable).
- **new** **Skeleton loading** — shimmer placeholders on dashboard, config, health, and colors.

### Health (beta)

- **new** **Bulk open confirmation** — *Open broken links* asks for confirmation with count and per-batch limit (default 10, max 25).
- **new** **Health badge on dashboard** — text pill like *3 broken*; refreshes when you return to the tab.

### Browser extension

- **new** **Save success panel** — popup stays open with *Open in nextDash* deep link to the right page.
- **new** **Dashboard toast** — success notification and bookmark refresh when dashboard tab is open on the same server.
- **new** **Extension UI translated** — EN / NL / DE / FR; language follows server settings when configured.

### Accessibility

- **new** **Modal semantics** — `role="dialog"`, `aria-modal`, labelled titles.
- **new** **Config tab list** — `role="tablist"` / `aria-selected`.
- **new** **Skip links** — “Skip to main content” on dashboard and config.
- **new** **Custom selects** — combobox/listbox ARIA on styled selects.
- **new** **prefers-reduced-motion** — inline-edit reveal respects reduced motion.

### Config polish

- **new** **Sticky save bar** — save / unsaved / undo / discard stay visible while scrolling.
- **new** **Autosave for low-risk fields** — language, theme, and similar toggles save without Save.
- **new** **General tab intro** — short explanation; backups tab routing fixed; page `lang` matches language.
- **fix** **Ko-fi overlay removed** — floating widget removed from config (intro link in General remains).

### Translations

- **new** **DE / FR coverage** — skip link, health confirm, swipe hint, tooltips, post-setup wizard, and more.

---

## v2026.05.3 — May 2026

### Button bar position

- **new** **Corner dock mode** — button bar in bottom-left or bottom-right; compact 2-column widget (`>` `:` `?` | `!` `*` `⊞`).
- **new** **`:buttonbar` command** — `bottom` / `bottom-right` / `bottom-left` from command palette.
- **new** **Launcher in dock** — integrated `⊞` when docked; optional via *Show layout selector in dock*.

### Search

- **new** **`@` global search** — fuzzy-search all pages; each result shows page name as context.
- **new** **`:find <text>`** — hide non-matching tiles on the current page; `:find` alone clears.

### Page customisation

- **new** **Page emoji icon** — double-click tab → popover to set emoji in the tab.
- **new** **Page colour dot** — 8 accent colours (or none) per page in the same popover.

### What's new improvements

- **new** **★ FAB button** — star opposite the button bar opens release notes anytime.
- **new** **What's new group in search** — unread release notes appear in `>` empty state for 7 days.

### Cheat sheet & themes

- **new** **Cheat sheet restructured** — 6 sections including `@`, appearance commands, and `:buttonbar`.
- **new** **5 new theme families** — Terminal Amber, Dusk Horizon, Moss & Stone, Candy Pop, Midnight Ink (dark + light each).

---

## v2026.05.2 — May 2026

### Search & commands

- **new** **Fuzzy search on URL, note & tags** — `/` mode matches domain, tags, and note; secondary matches rank below name with context snippets.
- **new** **Saved searches as separate group** — *Recent* and *Saved searches* as distinct collapsed groups in `>`.
- **new** **`:open all`** — open every bookmark on the current page (safe cap + open all option).
- **new** **`:pin` / `:unpin`** — toggle pin from command palette.
- **new** **`:tag <tagname>`** — add/remove tag on selection; `:tag` alone shows current tags.
- **new** **`:stale [days]`** — custom day window (`:stale 7`, `:stale 90`, …).

### Keyboard cheat sheet

- **new** **Searchable cheat sheet** — filter input on `!` / `F1` narrows ~30 shortcut rows; empty sections hidden.

---

## v2026.05.1 — May 2026

### Launcher view

- **new** **Launcher layout preset** — large favicon tiles in horizontal category rows; toggle via ⊞ FAB.
- **new** **Launcher icon size** — Small / Normal / Large in Config → Appearance.
- **new** **Launcher tile animations** — dim while search active; scale-pulse on click.

### Date header & calendar

- **new** **Clickable date/time** — week-overview popover with ISO week and today highlighted.
- **new** **Calendar URL setting** — optional link in popover when configured.

### Keyboard shortcuts

- **new** **Shift+M — quick move** — popover to move bookmark to category or another page.
- **new** **Ctrl+C row flash** — green tint on row when copying URL.

### Search & commands

- **new** **`:goto <url-or-domain>`** — navigate directly; bare domains get `https://`.
- **new** **Recent searches in empty state** — last 5 queries as clickable chips.
- **fix** **Fuzzy search ranking** — exact → prefix → word-boundary → substring scoring.

### Dashboard polish

- **fix** **Category collapse animation** — `grid-template-rows: 1fr ↔ 0fr` instead of `max-height` hack.

### Keyboard cheat sheet expanded

- **new** **Full commands reference** — `:goto`, `:layout`, `:theme`, `:density`, `:columns`, `:sort`, `:save`, `:saved`, …
- **new** **Fuzzy mode documented** — `/` prefix and ranking described.
- **new** **Config shortcuts listed** — `Alt+↑/↓`, `Ctrl/Cmd+K`.

---

## v2026.05 — May 2026

### Glass-effect config & health

- **new** **Transparent card backgrounds** — 75% transparent panels on config and health.
- **new** **Save/Discard bar transparent** — sticky action bar transparent; tab strip stays solid.
- **fix** **What's new link removed from Help tab** — modal still on first visit and dashboard prompt.

### Button animations

- **new** **Pulsing glow on Search & Commands** — subtle animation on `>` and `:` footer buttons.

### Onboarding & feature tour

- **new** **Interactive feature tour** — 8 steps: search, commands, finders, columns, smart collections, bookmarks.
- **new** **Tour spotlight notification** — once after onboarding; restart from Config → Advanced.
- **new** **Animated search flow hint** — segment wipe-in above footer buttons; once per browser.

### Buttons & discoverability

- **new** **Finders & Commands on by default** — new installs show both without enabling in config.
- **fix** **Tips above buttons restored** — rotating tip element was missing from HTML.

### Translations (i18n)

- **new** **Feature tour fully translated** — EN / NL / DE / FR.
- **fix** **Hardcoded Dutch strings removed** — undo, backup tip, tour spotlight, config tour section.

### Stats insights dashboard

- **new** **Two-column layout with index** — sticky index + scrollspy across 10 sections.
- **new** **Per-section time periods** — week / month / 3mo / 6mo / all-time per section.
- **new** **Activity sparkline** — SVG bar chart of last-opened activity.
- **new** **Cleanup score** — 0–100 with explained penalties.
- **new** **Rot & cleanup section** — never-opened, stale, recently-added tables.
- **new** **ℹ on every stats section** — plain-English explanations.
- **new** **Fully translated stats tab** — EN / NL / DE / FR.

---

## v2026.04 — April 2026

### Dashboard buttons

- **new** **Labels removed** — footer shows key symbols only (`:` `?` `>` `*` `!`); tooltips on hover.
- **new** **Button order** — `: commands` · `? finders` · `> search` · `* recent` · `! cheatsheet`.
- **fix** **Config label toggle removed** — per-button Label column dropped from Header & Buttons.

### Search

- **new** **Mode badge** — SEARCH, CMD, FIND, or FUZZY badge in the search bar.
- **new** **Filter group** — `category:`, `status:`, `page:`, `tag:` under collapsible *Filters*.
- **new** **Empty state** — Recent, Filters, Finders groups when query is empty.
- **new** **Search mode chips** — click chips at bottom of overlay to switch mode.

### Dashboard

- **new** **Keyboard selection highlight** — accent background and left bar on selected row.
- **new** **Category collapse animation** — smooth height transition and rotating chevron.
- **new** **Smart collection accent** — tinted headers for smart groups.
- **new** **Smart collection empty state** — contextual message when no matches.
- **new** **Focus indicators** — consistent rings on bookmarks, categories, search.
- **new** **Compact bookmark rows** — inline status/pin/note chips; three-column grid.
- **new** **Column layout** — `fit-content` categories; reduced column gap.
- **new** **Status check spinner** — bottom-right corner instead of header text.
- **new** **Health badge** — superscript pill above health link.

### Layout & appearance

- **new** **Content area width** — `min(88%, 1600px)`.
- **fix** **Mobile header** — single row; date/time hidden on small screens.
- **fix** **Scrollable modals** — What's new and cheat sheet scroll on small viewports.
- **fix** **Tab bar spacing** — config tabs shrink padding when narrow.

### Quick-add & bookmarks

- **new** **Loading states** — favicon spinner; Save button loading state.
- **new** **Clear icon button** — reset favicon in quick-add without closing.
- **new** **Last opened in config** — date/time on bookmark rows.
- **new** **Show icons on by default** — new installations.

### Config

- **fix** **Tab bar spacing** — all tabs visible without overlap when window narrows.

### UI & discoverability

- **new** **Button tooltips** — shortcuts on footer hover (desktop only).
- **new** **Search-flow hint redesigned** — absolute positioning; token-aligned styling.
- **new** **Config nav link colours** — match dashboard header links.

---

## v2026.03 — March 2026

### Config — pages & general

- **new** **Archive pages** — dim row, *archived* badge; hidden from dashboard until restored.
- **new** **Delete empty pages** — remove pages with zero bookmarks (previously failed silently).
- **new** **Page dropdown refresh** — categories, bookmarks, and smart-page selectors update after save without reload.
- **new** **Per-setting reset (↺)** — restore default when value differs; dirty state marked.
- **new** **Checkbox 3-column layout** — `[checkbox] [↺] [label]` alignment in General.
- **new** **Bookmarks card split** — Display vs Behavior in General.
- **new** **Localization card** — language + date/time/weather tree fixed (weather under *Show weather*).
- **new** **Smart collections as `<details>` blocks** — one collapsible block per collection.
- **new** **Header & Buttons table** — Show column per footer button.
- **new** **Backup & Restore + Reset** — full-width sections outside card grid.
- **new** **Session card collapse** — Appearance and Layout open by default; state restored per visit.
- **new** **Unsaved amber border** — sticky toolbar border when dirty.
- **new** **Reset tooltip** — shows “Reset to 14 (was 20)”.
- **new** **Scrollable config tabs** — fade mask on narrow screens.
- **new** **Pages drag-reorder hint** — helper text on pages tab.

### Dashboard — navigation & UX

- **new** **`Tab` / `Shift+Tab`** — linear bookmark stepping when one is selected.
- **new** **`G + 1–9` / `GG`** — jump to nth category or first bookmark.
- **new** **Quick-add omnibox** — one-line `name | url | shortcut` (key mapping evolved in later releases; see **Unreleased**).
- **new** **Paste URL quick-add** — `Ctrl+V` on dashboard opens modal pre-filled (toggle in General).
- **new** **Page transition animation** — fade + slide between tabs.
- **new** **Empty / fresh install states** — terminal-style empty page; separate first-run message.
- **new** **Shortcut hover tooltip** — “Press X to open” when shortcut assigned.
- **new** **Preview card** — open count and last opened; viewport edge detection; `[` toggles on keyboard focus.
- **new** **`Ctrl+C` copy URL** — with toast.
- **new** **Category collapse per page** — `pageId:categoryId` keys (no cross-page bleed).
- **new** **Bottom padding** — last rows not hidden behind floating buttons.
- **new** **Corner `+` and `!`** — fixed corner placement (later superseded by footer bar layout).

### Search & commands

- **new** **Grouped command palette** — Bookmarks, View, Dashboard collapsible groups.
- **new** **Grouped search empty state** — Recent, Filters, Finders groups.
- **new** **`:history` / `:history clear`** — browse or wipe search history.
- **new** **Per-entry history delete** — × on hover in Recent group.
- **new** **Match highlighting** — bold + underline on matched characters.
- **new** **Status filter autocomplete** — descriptive values for `status:`.
- **new** **History cap** — 15 entries max.
- **new** **Command context** — select bookmark with arrows, then `:` opens with that bookmark as context.
- **new** **`:remove` undo toast** — 8-second undo window.
- **new** **No-match hints** — `:new <query>`, `?FINDER <query>` suggestions.

### Health & stats

- **new** **Health page (beta)** — scores, filters, bulk actions, ping, auto-heal suggestions.
- **new** **Duplicate groups — keep first** — one-click merge in health view.
- **new** **Health badge** — broken (red) / warnings (yellow) on dashboard header.
- **new** **Health state persistence** — filter, sort, query in sessionStorage.
- **new** **Health link in config header** — themed pulse + badge; reordered nav on health page.
- **new** **Stats: conflicts & duplicates** — link to health.
- **new** **Stats: category breakdown** — opens by category.
- **new** **Stats: opens filter** — time-filtered open counts.
- **new** **Favicon refresh from health** — per-bookmark action.

### Drag & drop & config bookmarks

- **new** **Smooth drop placeholder** — fade/scale when reordering.
- **new** **Empty category drop target** — dashed outline while dragging.
- **new** **Bookmarks split view** — list + detail panel; page move with → Move; delete from panel.
- **new** **Backup spinners** — Creating… / Importing… / Exporting… on buttons.

### Reset & data

- **fix** **Reset all data** — correctly wipes pages, bookmarks, categories, finders, settings, tags, and collections.
- **new** **Reset UX** — Enter in confirm field; redirect to dashboard after success.
- **new** **Reset context tips** — moved to Advanced section.

### Onboarding

- **new** **Smart collections onboarding step** — toggle Today and Most Used in wizard.
- **new** **Search flow banner default on** — for new installs.

---

## v2026.02 — February 2026

### Tags, collections & search

- **new** **Tags on bookmarks** — comma-separated; normalised on save; autocomplete in modal and config.
- **new** **`tag:` search filter** — filter bookmarks by tag in search bar.
- **new** **Tag collections** — optional dashboard group per tag with minimum count threshold.
- **new** **Custom collections** — dynamic rules (AND/OR) on tag, category, shortcut in config → collections.
- **new** **Config → tags tab** — tag cloud, rename, merge, delete.
- **new** **Shared TagAutocomplete** — dashboard and config use one component.

### Smart collections & bookmarks

- **new** **Smart collections** — Today, Recently opened, Most used, Stale with per-page scope.
- **new** **Today keyword sets** — work / evening / weekend configurable.
- **new** **Open-count badge** — usage visible on dashboard rows.
- **new** **`:note` command** — edit bookmark notes from command bar.
- **new** **Notes on dashboard** — visible in rows, previews, and config.

### Pages, categories & UI

- **new** **Double-click rename** — page tabs and category headers.
- **new** **Page overview overlay** — `,` shows all pages with counts.
- **new** **Improved config tabs** — pages, categories, finders layout refresh.
- **new** **Toast undo** — undo on destructive actions where applicable.
- **new** **Configurable toast duration** — in settings.

### Finders & stats

- **new** **Finder use count** — shown in search results and finder list.
- **new** **Stats tab foundations** — usage patterns, opens, health-style cleanup metrics (expanded in v2026.05).

### Health (early)

- **new** **Dead-link suggestions** — archive, redirect detect, title refresh, one-click fix paths.
- **new** **Health sorting** — sort issues by score, status, name, dates.
- **new** **Bulk action loading states** — spinners on retest / open broken.

### Keyboard & accessibility (early pass)

- **new** **Keyboard cheat sheet modal** — accordion layout; expanded over March–May releases.
- **new** **Delete bookmark confirmation** — confirm dialog from keyboard/config.
- **new** **Feature spotlight** — paste-URL tip and other one-time highlights.
- **new** **Fade mask on config tabs** — scroll indication.

---

## v2026.01 and earlier — Foundation

Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard); nextDash adds self-hosting, i18n, health, extension, and continuous keyboard-first polish.

### Core product

- **new** **Multi-page bookmark dashboard** — Go backend, file-based storage under `data/`.
- **new** **Categories per page** — collapsible sections on the dashboard.
- **new** **Keyboard navigation** — arrow keys, page number keys, search overlay.
- **new** **Search (`>`)** — filter bookmarks by name and URL.
- **new** **Command mode (`:`)** — layout, theme, and dashboard commands.
- **new** **Finders (`?`)** — external search templates with `%s`.
- **new** **Config UI** — manage pages, categories, bookmarks, finders, settings.
- **new** **Custom themes** — built-in palettes + `/colors` editor.
- **new** **Docker image** — `ghcr.io/jordibrouwer/nextDash` with volume-mounted data.

### Bookmarks & organisation

- **new** **Drag-and-drop reorder** — bookmarks within and across categories (left strip).
- **new** **Inline edit** — long-press row to edit on dashboard.
- **new** **Shortcuts per bookmark** — global uniqueness across pages.
- **new** **Pinned bookmarks** — stay on top within category.
- **new** **Status monitor** — optional ping per bookmark; online/offline indicators.
- **new** **Favicon & preview metadata** — fetch title, description, image on add.
- **new** **Hover preview card** — configurable delay.

### Backup & import (initial)

- **new** **ZIP backup and restore** — full instance export/import via config.
- **new** **Browser HTML import** — Netscape format; folders → categories; skip duplicates.
- **new** **CSV export** — all bookmarks for spreadsheets.

### Internationalisation

- **new** **EN / NL / DE / FR** — UI strings via locale JSON; language in settings.
- **new** **Embedded locales** — shipped inside binary for reliable deploys.
- **new** **Config → Help** — long-form translated help index.

### Browser extension (initial)

- **new** **Chrome extension** — save current tab to selected page via REST API.
- **new** **`GET /api/pages`**, **`POST /api/bookmarks/add`** — extension integration.

### Infrastructure

- **new** **`.dockerignore` and Dockerfile`** — container builds.
- **new** **CORS and static assets** — dashboard, config, health front ends.
- **new** **MIT license** — open source distribution.

---

## How releases are numbered

- **Calendar versions** — `v2026.MM.P` = year, month, patch (e.g. `v2026.05.7`).
- **In-app token** — `2026.06-dashboard-release-v35` in `whats-new-modal.js` tracks the dashboard “seen” state separately from git tags.
- **Unreleased** — work on `main` not yet tied to a numbered release; may appear in README *Unreleased* until shipped.

When you ship a release, add a dated section here, bump the What's new modal, and clear **Unreleased** items that are included.

---

*For the latest highlights only, open the dashboard **★** button or Config → Advanced → What's new.*
