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
- `Shift + Left/Right` — cycle between page tabs
- `Arrow Up/Down/Left/Right` — move through the bookmark grid
- `Enter` / `Space` — open the focused bookmark
- `[` — toggle the preview card on the focused bookmark
- `Ctrl + C` — copy the URL of the focused bookmark to the clipboard
- `;` — inline-edit the highlighted bookmark
- `Ctrl + Shift + A` — open the new bookmark modal
- `Esc` — clear selection or undo the latest drag reorder

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
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Hover preview cards with configurable delay
- Background image or gradient support

### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- Health view with dead-link detection; suggests archive/redirect/title fixes with one-click apply
- Favicon auto-refresh from the health view
- Usage stats in the config: top patterns, open counts, last-used dates

### Bookmarks

- Metadata auto-fetch (title, description, preview image) when adding a URL
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

### Newest

**Search**
- Match highlighting: matched characters shown in bold with an underline in both the shortcut and bookmark name
- Filter autocomplete: typing `status:` now shows all known values (`online`, `offline`, `broken`, `ok`, `pinned`, `unpinned`, `checked`, `unchecked`) with descriptions; narrows as you type
- Search history capped at 15 entries; oldest entries dropped automatically

**Command bar**
- Keyboard-navigate to a bookmark with ↑ ↓, then press `:` — the command bar opens with that bookmark as context
- `:REMOVE` and `:NOTE` completions are pre-filled with the bookmark name
- Deleting a bookmark via `:remove` now shows an undo toast with an 8-second window

**Drag & drop**
- Drop placeholder fades and scales in smoothly each time it moves to a new position
- Empty categories show a dashed outline while dragging so you can still drop into them

**Config — general tab**
- Bookmarks card split into Display (icons, shortcuts, badges, preview) and Behavior (sorting, tab, collapse, shortcuts)
- Language moved out of Appearance into a new Localization card together with date, time, and weather settings
- Date/time/weather tree structure corrected: weather options are children of "Show weather", date format is a child of "Show date"
- Smart Collections: each collection is now its own collapsible `<details>` block instead of a long flat list
- Header & Buttons redesigned as a compact table: one row per button, Show and Label columns side by side
- Backup & Restore and Reset moved outside the card grid as full-width sections
- Card collapse state saved per session: only Appearance and Layout open by default; your state is restored on next visit

**Config — UX**
- Unsaved changes: sticky toolbar gets an amber bottom border when there are unsaved changes
- Reset tooltip shows both values: "Reset to 14 (was 20)"
- Config tab bar horizontally scrollable with fade-out gradient on narrow screens
- Pages tab shows a hint explaining drag-reorder for pages

**Dashboard**
- Category collapse state stored per page (`pageId:categoryId`) — same-named categories on different pages no longer share state

### Recent

**Command palette & search — grouped UI**
- Command palette (`:`) now shows commands in three collapsible groups: Bookmarks, View, Dashboard — no more long flat list
- Search empty state shows Recent, Filters, and Finders as collapsible groups; Recent expands automatically when you have history
- Navigate group headers with ↑ ↓ arrow keys or Tab; Enter or click to toggle open/closed
- No-match state shows clickable hints: `:new <query>` to add as bookmark, `?FINDER <query>` to search externally

**Dashboard UX**
- Empty page state: terminal-style prompt with page name and keyboard shortcuts when a page has no bookmarks
- Fresh install state: separate "No bookmarks yet" message with direct links to add or import
- Page transition: smooth fade + slide animation when switching between page tabs
- Shortcut tooltip: "Press X to open" tooltip on bookmark hover when a shortcut is assigned; auto-hides when preview card is open
- Hover preview card: shows open count and last-opened date; repositions automatically to stay fully within the viewport
- Preview card via keyboard: press `[` on a keyboard-selected bookmark to toggle the preview card; navigating away closes it automatically
- Copy URL via keyboard: `Ctrl + C` copies the URL of the keyboard-selected bookmark

**Config**
- Per-setting reset button (↺) appears when a value differs from its default; click to restore the default and mark the form dirty
- Backup & Restore buttons show a spinner and loading label (Creating… / Importing… / Exporting…) during operations
- Config link always visible; health link visibility controlled by the `showHealthDashboard` setting

**Onboarding**
- New step for smart collections: toggle Today and Most Used directly from the onboarding flow
- Search flow banner enabled by default for new installs

---

## Contributing

Issues and pull requests are welcome — bugs, features, and translations alike.

---

## License

MIT
