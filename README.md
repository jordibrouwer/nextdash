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
- `Enter` / `Space` — open the focused bookmark
- `[` — toggle the preview card on the focused bookmark
- `Ctrl + C` — copy the URL of the focused bookmark to the clipboard
- `;` — inline-edit the highlighted bookmark
- `Ctrl + Shift + A` — open the new bookmark modal
- `! or Ctrl + /` — open keyboard cheat sheet
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
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Hover preview cards with configurable delay
- Background image or gradient support

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

### Newest

**Dashboard — UX**
- Page overview (`','`): overlay shows all pages with bookmark counts; navigate with `↑/↓` or `1–9`, jump with `Enter`, close with `Esc` or `,`
- Bookmark flash: subtle ripple animation when opening a bookmark — visual confirmation the action was registered
- Preview card extended: hover card now shows the full URL, open count, and last-opened date
- Tab title: browser tab now shows the active page name, e.g. *Work — nextDash*

**Dashboard — cheatsheet**
- Permanent `?` button in the bottom-right corner opens the keyboard shortcut cheat sheet (toggle in config → general → Buttons)
- Cheatsheet redesigned: terminal-table style, accent-colored keys, `// section` headings, two-column layout — more scannable, fits one screen

**Config — bookmarks**
- Delete from side panel: trash button in the detail panel deletes the selected bookmark directly; new (unsaved) bookmarks skip the confirmation dialog
- Empty state: side panel shows an empty state when no bookmark is selected; click outside a row to deselect

**Config — stats**
- Conflicts & duplicates block: shows duplicate URL count and shortcut conflicts with a direct link to the health page
- Category breakdown: which categories have the most opens, sorted by usage

**Health**
- Filter, sort, and search state persist across page refreshes (sessionStorage)
- Health badge on the dashboard header: red number for broken bookmarks, yellow for warnings

**Colors**
- Live theme preview card: mini card next to the color pickers updates in real time as you change colors

### Recent

**Search**
- Match highlighting: matched characters shown in bold with an underline in both the shortcut and bookmark name
- Filter autocomplete: typing `status:` shows all known values with descriptions; narrows as you type
- Search history capped at 15 entries; oldest entries dropped automatically

**Command bar**
- Keyboard-navigate to a bookmark with `↑↓`, then press `:` — the command bar opens with that bookmark as context
- `:REMOVE` and `:NOTE` completions are pre-filled with the bookmark name
- Deleting a bookmark via `:remove` shows an undo toast with an 8-second window

**Drag & drop**
- Drop placeholder fades and scales in smoothly each time it moves to a new position
- Empty categories show a dashed outline while dragging so you can still drop into them

**Config — general tab**
- Bookmarks card split into Display and Behavior
- Language moved into a new Localization card together with date, time, and weather settings
- Smart Collections: each collection is its own collapsible block
- Header & Buttons redesigned as a compact table: one row per button, Show and Label columns side by side
- Card collapse state saved per session

**Config — UX**
- Unsaved changes: sticky toolbar gets an amber bottom border
- Config tab bar horizontally scrollable with fade-out gradient on narrow screens

**Dashboard**
- Category collapse state stored per page (`pageId:categoryId`) — same-named categories on different pages no longer share state

---

## Contributing

Issues and pull requests are welcome — bugs, features, and translations alike.

---

## License

MIT
