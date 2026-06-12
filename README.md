# 🚀 nextDash

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard. Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

📖 **[Full user manual (MANUAL.md)](MANUAL.md)** — step-by-step guide for new users: concepts, keyboard workflow, config, import/backup, health, extension, and efficient daily use.

📋 **[Changelog (CHANGELOG.md)](CHANGELOG.md)** — complete release history (new / fix), from early foundation through **v2026.06.17**.

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
    image: ghcr.io/jordibrouwer/nextdash:latest
    container_name: nextDash
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8080
      # Optional on LAN/VPS — require X-NextDash-Token on destructive API calls (see Security):
      # - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
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

nextDash is built for **personal or small-team use on a trusted network**. There are no user accounts — anyone who can reach the URL can read and change data unless you add protection.

**Do not expose nextDash directly to the public internet.** Recommended setups:

- **Private overlay network** — [Tailscale](https://tailscale.com/) or another mesh VPN so nextDash never gets a public listener.
- **Reverse proxy with auth** — Traefik, Caddy, or nginx inside your home/lab/VPC, with HTTP basic auth, OAuth2 Proxy, or SSO in front.
- **Local-only** — bind to `127.0.0.1` and use SSH port forwarding or a same-machine browser.

### Optional write token (LAN / VPS)

Set environment variable `NEXTDASH_WRITE_TOKEN` to a long random string. Protected endpoints then require header `X-NextDash-Token` with that value. The dashboard, config, and health pages inject the token automatically when you open them in a browser.

Protected actions include: **reset all data** (also requires `{"confirm":true}`), **download or import backup**, **delete page**, **bookmark preview fetch**, **bookmark ping** (`/api/ping`), **search-index build**, **health delete / retest / merge / auto-heal / open-broken / cache-scan / update-status**, **clear or refresh all bookmark previews**, **bookmark/page/category/finder/settings saves**, **uploads** (favicon, font, icon), and **reset theme colours**.

When the token is **not** set, behaviour is unchanged — everything stays open for local dev. When it **is** set, the dashboard, config, and health pages inject the token automatically so normal browser use is unaffected. The browser extension can store the same write token in **Settings → Write token**.

Outbound fetches (preview, ping, icons, auto-heal) use dial-time IP validation to block DNS-rebinding to private networks unless **allow localhost bookmarks** is enabled in settings.

---

## Features

### Keyboard-first workflow

**Navigation**
- `1–9` — jump directly to a page tab
- `Shift + ←/→` — cycle between page tabs (plain arrows move bookmarks only, not pages)
- `,` — page overview: all pages with bookmark counts (`Tab` / `Shift+Tab` move between rows; arrow keys do not affect bookmarks behind the overlay)
- `↑/↓/←/→` — move bookmark selection (first arrow key starts navigation); `1–9` page switch also selects the first visible bookmark; mouse hover softens the stale keyboard highlight until your next keypress
- `Tab` / `Shift+Tab` — step linearly through all bookmarks when one is already selected
- `G + 1–9` — jump to the nth category and select its first bookmark (`G` is for categories only — it does not switch pages)
- `Ctrl + Home` / `Ctrl + End` — first / last bookmark on the page (`Cmd` on Mac)
- `Enter` / `Space` — open the focused bookmark (middle-click also counts toward open stats and smart collections)
- `Esc` — clear selection, close overlay, or undo an unsaved drag reorder (before the 1s save completes)

**Bookmarks**
- `+` — open the full new-bookmark modal (dashboard only, when no input is focused)
- `&` — quick-add omnibox: type `name | url | shortcut` in one line
- `Ctrl + Shift + A` — same full new-bookmark modal from anywhere
- `Ctrl + V` — paste a URL anywhere on the dashboard to open the new-bookmark modal pre-filled (blocked while inline edit or the tag word cloud is open)
- `;` — inline-edit the focused bookmark
- `Shift + M` — *Move to…* quick-move popover: choose a category or page with arrow keys
- `Ctrl + C` / `Cmd + C` — copy the URL of the focused bookmark (row flashes green)
- `[` — toggle the hover preview card on the focused bookmark
- `Delete` — delete the focused bookmark

**Search & commands**
- `>` — open search; empty state shows recent queries and saved searches as chips; `←`/`→` select a chip, `Enter` applies it
- `/` — fuzzy search; ranked by prefix → word-boundary → substring; also matches URL domain, tags, and note text
- `:` — command palette
- `?` — finders (e.g. `?g query` to search Google)
- `*` — recent bookmarks panel
- `! or F1` — keyboard cheat sheet (filterable with a type-to-search input; blocked while page overview `,` is open)
- `category:` / `tag:` / `page:` / `status:` — filter directly in the search bar
- `:goto <url-or-domain>` — navigate to a URL or bare domain (e.g. `:goto github.com`)
- `:new` — open new-bookmark modal (same as `+` / `Ctrl+Shift+A`)
- `:note` — edit the note of the focused bookmark
- `:pin` / `:unpin` — toggle pin on the keyboard-selected bookmark
- `:tag` — list tags; `:tag <name>` or `:tag:<name>` browse bookmarks by tag in the command palette only (dashboard unchanged); `:tag +name` / `:tag -name` add or remove on the keyboard-selected bookmark
- `/` (desktop, tag cloud on) — open tag word cloud on dashboard; filters tiles by tag (Escape or Clear clears)
- `:open all` — open all bookmarks on the current page in new tabs
- `:open last [n]` — open the N most recently opened bookmarks on the current page (default 5, max 50; same 15-tab safe cap as `:open all`)
- `:remove` — delete the focused bookmark
- `:sort <method>` — `order` / `az` / `recent` / `custom`
- `:stale [days]` — list stale bookmarks; optional day window (e.g. `:stale 7`)
- `:duplicate` / `:duplicates` — list bookmarks with duplicate URLs (opens health duplicates view)
- `:layout <preset>` — `default` / `compact` / `cards` / `masonry` / `list` / `launcher` …
- `:theme <name>` — switch colour theme
- `:density <mode>` — `comfortable` / `compact` / `dense`
- `:columns <n>` — set column count (1–6)
- `@` — global search across all pages at once; each result shows the page name as context
- `:find <text>` — hide tiles whose name or URL don't match; clear with `:find`
- `:buttonbar <position>` — move the button bar: `bottom` / `bottom-left` / `bottom-right`
- `:save` / `:saved` — save current query / show saved searches

**Config page**
- `1–9` — jump to the Nth visible config tab
- `←`/`→` — move between visible config tabs (when focus is not in an input)
- `S` — save changes
- `Alt + ↑/↓` — reorder the selected bookmark
- `Ctrl/Cmd + K` — open the config command palette
- `Ctrl/Cmd + Shift + K` — find settings, tabs, and help sections

**Config guided tours** (desktop-width window, once per tab until completed or skipped) — spotlight walkthroughs on **General**, **Bookmarks**, **Pages**, **Categories**, **Tags**, **Collections**, **Finders**, **Stats**, and **Theme**. The **General** tour is overview-only (Essentials / Advanced layers, no user input). Other tours may include optional hands-on demos (temporary pages, categories, tags, collections, bookmarks, finders, or a custom theme) with automatic cleanup. Replay any tour from **config → general → Advanced → System & tools → Tours & onboarding** (open the matching tab first).

**Settings search promo** (desktop config, once until dismissed) — first visit may highlight **Search settings…** in the breadcrumb row with a **New** badge and speech balloon (`Ctrl/Cmd+Shift+K` for settings navigation vs `Ctrl/Cmd+K` quick actions). Reset from **Tours & onboarding → Reset settings search promo**.

Tours, rotating tips, settings search promo, and promo banners do not run on the mobile layout.

#### Config → General (for self-hosters)

**Essentials vs Advanced** — On `config#general`, everyday options (language, appearance, layout, bookmarks, smart collections summary, status overview) live under **Essentials**. Power features (full status tuning, branding, search behaviour, backups) are under **Advanced**. Sticky section links jump and highlight as you scroll; **Show all sections on one page** flattens everything with **Expand all** / **Collapse all**. Hash links (`#general/advanced/…`) restore layer and open collapsed panels.

**↺ Reset** — per-control reset buttons beside many General fields restore defaults (marks dirty until **Save**). Advanced **Reset to defaults** card requires expanding before the destructive button is enabled.

**Search settings…** — `Ctrl+Shift+K` / `Cmd+Shift+K` in the breadcrumb row finds tabs, General panels, labels, stats sections, theme groups, keyboard bindings, and Help blocks; matching panels expand before scroll. On mobile, a subset search lives inside the General tab. `Ctrl+K` / `Cmd+K` opens quick actions only (save, open dashboard, tour resets). The General guided tour includes a desktop step for settings search.

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
- Drag-and-drop reorder within and between categories (drag strip on the left); saves debounce 1s with a success toast on the dashboard
- **Config → pages** and **config → categories** — drag or **↑/↓** to reorder; auto-save after ~600 ms with a localized sync toast; pages support **archive** (hide without deleting bookmarks)
- Long-press a bookmark row (~500 ms) to open inline edit — opaque panel with clear border (including glass launcher); **Save** / **Ctrl+Enter** persists immediately on the dashboard; edits and deletes from **smart-collection** rows sync to the category column and global bookmark store; page switches confirm before discarding unsaved edits; swipe and **Ctrl+V** paste are blocked while the editor is open
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
- Custom theme editor (`config#colors`) — dark/light default palettes, **packaged themes** subtab (edit built-in families), custom theme list with **export/import** and **undo**; live preview on palette cards with contrast warnings; optional **Theme** tab guided tour; on mobile the editor is read-only (viewer mode)
- Auto dark mode
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List, **Launcher** (large favicon tiles)
- Launcher layout preset — switch via **Config → General → Layout** or `:layout launcher` in search; icon size configurable (small / normal / large)
- Button bar position: center-bottom (default) or corner dock (bottom-left / bottom-right) via Config or `:buttonbar`
- ★ What's New star button in the corner opposite the button bar — always visible; latest release loads first, older notes on scroll
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Optional hover preview cards (off by default) — enable in **Config → General → Advanced → Bookmarks**; configurable hover delay
- Background image or gradient support
- Clickable date/time header showing a week-overview popover; optional calendar URL link

### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- Health view with dead-link detection; suggests archive/redirect/title fixes with one-click apply
- Health badge on the dashboard header: text pill (e.g. `3 broken`) with red/yellow styling; bulk open broken links asks for confirmation with a per-batch limit
- Filter, sort, and search state in the health view persists across page refreshes (sessionStorage)
- Favicon auto-refresh from the health view
- Usage stats in the config: top patterns, open counts, last-used dates
- Conflicts & duplicates block in stats: shows duplicate URL count and shortcut conflicts with a direct link to health; merge combines metadata into the kept bookmark

### Bookmarks

- Metadata auto-fetch (title, description, preview image) when adding a URL
- Hover preview card (opt-in) shows full URL, open count, and last-opened date when enabled in config
- Flash animation on bookmark open — subtle ripple confirms the action was registered
- Plain-text notes per bookmark — visible on the dashboard, in hover previews, and editable via command bar (`:note`), inline edit, or the config detail panel
- Open-count badge tracking usage per bookmark
- Pin bookmarks to keep them at the top
- Import from browser HTML export (Chrome, Firefox, Edge) — folders become categories, duplicate URLs skipped
- Export all bookmarks to CSV (Name, URL, Category, Page, Shortcut)
- Full ZIP backup and restore (pages, bookmarks, categories, settings, themes, `data/icons/`, custom favicon/font); atomic import with orphan cleanup; **last backup date** shown in Config → Backups
- Settings-only **export/import** of `settings.json` (migration-safe) from Config → Backups
- Bookmark icons: upload, URL fetch, link-preview fetch; re-upload **overwrites** same filename

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
| Long press a bookmark row (~500 ms) | Open inline edit (save with **Save** or **Ctrl+Enter**) |
| Hover over a bookmark | Show preview card when enabled (Config → General → Advanced → Bookmarks) |
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

## Contributing

Issues and pull requests are welcome — bugs, features, and translations alike.

---

## License

MIT
