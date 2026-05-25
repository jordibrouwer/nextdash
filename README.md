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

- `>` — open search with fuzzy matching across all bookmarks
- `?` — open finder mode; type `?g query` to search an external engine
- `:` — open command mode (`:theme`, `:layout`, `:density`, `:note`, …)
- `1–9` — jump directly to a page tab
- `,` — page overview: all pages with bookmark counts; navigate with `↑/↓` or `1–9`
- `Shift + Left/Right` — cycle between page tabs
- `Arrow Up/Down/Left/Right` — move through the bookmark grid
- `Tab` / `Shift+Tab` — step linearly through all bookmarks (when one is selected)
- `G + 1–9` — jump to the nth category and select its first bookmark
- `Enter` / `Space` — open the focused bookmark
- `[` — toggle the preview card on the focused bookmark
- `Ctrl + C` — copy the URL of the focused bookmark to the clipboard (flashes the row green)
- `Shift + M` — open the *Move to…* quick-move popover for the focused bookmark
- `;` — inline-edit the highlighted bookmark
- `+` — open the quick-add omnibox — type `name | url | shortcut` in one line, favicon is fetched automatically
- `Ctrl + V` / `Cmd + V` — paste a URL to open the quick-add modal pre-filled (when no input is focused)
- `Ctrl + Shift + A` — open the full new-bookmark modal
- `! or Ctrl + /` — open keyboard cheat sheet
- `:goto <url-or-domain>` — navigate directly to a URL or domain (e.g. `:goto github.com`)
- `Esc` — clear selection or close overlay

Config page shortcuts:

- `1–8` — jump between config tabs
- `S` — save changes
- `Alt + Up/Down` — reorder the selected bookmark
- `Ctrl/Cmd + K` — open the config command palette

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
- Double-click a page tab to rename it
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

- 32+ built-in theme families, dark and light variants
- Custom theme editor
- Auto dark mode
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List, **Launcher** (large favicon tiles)
- Launcher view: toggle via FAB button (⊞); icon size configurable (small / normal / large)
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Hover preview cards with configurable delay
- Background image or gradient support
- Clickable date/time header showing a week-overview popover; optional calendar URL link

### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- Health view with dead-link detection; suggests archive/redirect/title fixes with one-click apply
- Health badge on the dashboard header: red for broken bookmarks, yellow for warnings
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
