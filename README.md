# 🚀 nextDash

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard. Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

📖 **[Full user manual (MANUAL.md)](MANUAL.md)** — step-by-step guide for new users: concepts, keyboard workflow, config, import/backup, health, extension, and efficient daily use.

📋 **[Changelog (CHANGELOG.md)](CHANGELOG.md)** — complete release history (new / fix), from early foundation through **v2026.06.30**.

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
- `G + 1–9` — jump to the nth category or smart collection and select its first bookmark (hold `G` ~300 ms, or press `G` then a digit; a **quick tap** on `G` opens bookmark shortcuts starting with `G` instead)
- `G + P` — jump to the first pinned bookmark on the page (hold `G` or `G` then `P`)
- `GG` — jump to the very first bookmark (second `G` while the chord is pending)
- `Ctrl + Home` / `Ctrl + End` — first / last bookmark on the page (`Cmd` on Mac)
- `Enter` / `Space` — open the focused bookmark (middle-click also counts toward open stats and smart collections)
- `Esc` — clear selection, close overlay, or undo an unsaved drag reorder (before the 1s save completes)

**Blocking overlays** — While search (`>`), the cheat sheet (`!` / `F1`), recent bookmarks (`*`), tag cloud (`/`), page overview (`,`), quick-add omnibox (`&`), quick-move/delete/tag popovers (`Shift+M` / `Shift+D` / `Shift+T`), inline edit (`;`), or an app modal is open, keyboard focus stays inside that overlay (`Tab` cycles within it) and the bookmark grid behind it is `inert` (not clickable). With an **active tag filter**, only the filtered bookmark list is `inert` — the filter banner and bulk toolbar stay interactive while the tag cloud is open. Closing the overlay restores mouse and keyboard access to the grid; quick-move/delete/tag popovers also restore the keyboard highlight on the same bookmark row.

**Bookmarks**
- `+` — open the full new-bookmark modal (dashboard only, when no input is focused)
- `&` — quick-add omnibox: type `name | url | shortcut` in one line
- `Ctrl + Shift + A` — same full new-bookmark modal from anywhere
- `Ctrl + V` — paste a URL anywhere on the dashboard to open the new-bookmark modal pre-filled (blocked while inline edit or the tag word cloud is open)
- `;` — inline-edit the focused bookmark
- `Shift + M` — *Move to…* quick-move popover: choose a category or page with arrow keys
- `Shift + T` — *Quick tag* popover beside the focused bookmark: `↑`/`↓` navigate ranked tags; `Enter`/`Space` toggle a tag and advance to the next; `✓` shows tags already on the bookmark
- `Shift + D` — quick-delete popover with undo in the toast
- `Ctrl + C` / `Cmd + C` — copy the URL of the focused bookmark (row flashes green)
- `[` — toggle the hover preview card on the focused bookmark
- `Delete` — delete the focused bookmark

**Search & commands**
- `>` — open search; empty state shows recent queries and saved searches as chips; `←`/`→` select a chip, `Enter` applies it
- `/` — fuzzy search; ranked by prefix → word-boundary → substring; also matches URL domain, tags, and note text
- `:` — command palette (lone `:` from the dashboard); **5 collapsible groups** (**Bookmarks**, **Search & navigate**, **Look & layout**, **Smart collections**, **Settings & tools**) — click a header to expand; **recent commands** appear at the top when you reopen lone `:`; toggles refresh in place with `(on)`/`(off)` or `✓` after `Enter` (no toasts). In an open `>` search with text already typed, `:` inserts filter syntax (`category:`, `tag:`, …) instead of switching modes
- `?` — finders (e.g. `?g query` to search Google)
- `*` — recent bookmarks panel
- `! or F1` — keyboard cheat sheet (filterable with a type-to-search input; blocked while page overview `,` is open)
- `category:` / `tag:` / `page:` / `status:` — filter directly in the search bar; autocomplete suggests values after each prefix (single **Filters** group)
- `:goto <url-or-domain>` — navigate to a URL or bare domain (e.g. `:goto github.com`); `:goto config` / `stats` / `health` for quick navigation
- `:new` — open new-bookmark modal (same as `+` / `Ctrl+Shift+A`)
- `:add` — quick-add omnibox (same as `&`)
- `:note` — edit the note of the focused bookmark
- `:move` / `:edit` / `:copy` / `:quicktag` (`:qt`) — move, inline edit, copy URL, or open quick-tag popover (`Shift+T`) on the keyboard-selected bookmark
- `:pin` / `:unpin` — toggle pin on the keyboard-selected bookmark
- `:tag` — list tags; `:tag <name>` or `:tag:<name>` browse bookmarks by tag in the command palette only (dashboard unchanged); `:tag +name` / `:tag -name` add or remove on the keyboard-selected bookmark
- `:category` / `:cat` — jump to a category or smart collection by number or name
- `:filter <tag>` / `:filter clear` — apply or clear dashboard tag filter (OR logic, same as tag cloud)
- `/` (desktop, tag cloud on) — open tag word cloud on dashboard; toggle one or more tags (OR match); bulk toolbar stays clickable while the cloud is open; filtered bookmarks stack vertically; with an active filter the cloud anchors beside the `/` FAB
- `:open all` — open all bookmarks on the current page in new tabs
- `:open pinned` — open pinned bookmarks on the current page
- `:open tag <name>` / `:open category <name>` — open bookmarks matching tag or category on the current page
- `:open last [n]` — open the N most recently opened bookmarks on the current page (default 5, max 50; same 15-tab safe cap as `:open all`)
- `:page` — switch page by name or number (palette stays open, `✓` on current)
- `:recent` / `:overview` / `:cheat` / `:whatsnew` / `:reload` — recent modal (`*`), page overview (`,`), cheat sheet, what's new, reload dashboard
- `:config [section]` — open config or a tab (`bookmarks`, `backups`, `stats`, …)
- `:remove` — delete the focused bookmark
- `:sort <method>` — per focused category: `order` / `az` / `recent` (palette shows the category name)
- `:stale [days]` — list stale bookmarks; optional day window (e.g. `:stale 7`)
- `:duplicate` / `:duplicates` — list bookmarks with duplicate URLs (opens health duplicates view)
- `:health [filter]` — open health page — `broken`, `duplicate`, `stale`, `refresh`, …; `:health page [n]` filters by page
- `:dark` / `:title` / `:lang` / `:animations` / `:status` / `:opacity` — display and theme toggles
- `:collections` — toggle smart collections (today, recent, stale, most used)
- `:backup` / `:export` — open config backups or download a ZIP backup
- `:metadata` — health missing previews or config bookmarks
- `:tour` / `:promo` — start feature tour or reset discoverability promos
- `:layout <preset>` — `default` / `compact` / `cards` / `masonry` / `list` / `launcher` …
- `:theme <name>` — switch colour theme
- `:density <mode>` — `comfortable` / `compact` / `dense`
- `:columns <n>` — set column count (1–6)
- `@` — global search across all pages at once; each result shows the page name as context
- `:find <text>` — hide tiles whose name or URL don't match; `:find clear` removes the filter
- `:buttonbar <position>` — move the button bar: `bottom` / `bottom-left` / `bottom-right` / `side-left`
- `:save` / `:saved` — save current query / show saved searches

**Config page**
- `1–9` — jump to the Nth visible config tab
- `←`/`→` — move between visible config tabs (when focus is not in an input)
- `S` — save changes
- `Alt + ↑/↓` — reorder the selected bookmark
- `Ctrl/Cmd + K` — open the config command palette
- `Ctrl/Cmd + Shift + K` — find settings, tabs, and help sections

**Config guided tours** (desktop-width window, once per tab until completed or skipped) — spotlight walkthroughs on **General**, **Bookmarks**, **Pages**, **Categories**, **Tags**, **Collections**, **Finders**, **Stats**, and **Theme**. The **General** tour is overview-only (Essentials / Advanced layers, no user input). Other tours may include optional hands-on demos (temporary pages, categories, tags, collections, bookmarks, finders, or a custom theme) with automatic cleanup. Replay any tour from **config → general → Advanced → System & tools → Tours & onboarding** (open the matching tab first).

**Desktop discoverability promos** (desktop dashboard, once per feature until dismissed) — contextual **Got it** balloons beside search modes (`>`, `:`, `?`, filters), grid arrow navigation, **G+jump** (hold `G` ~300 ms or `G` then `1`–`9`, `G+P`, or `GG` — quick tap `G` opens shortcuts starting with `G`; promo may appear on hold and retries when blocked by What's new), smart collections, inline edit, tag cloud, tag-filter bulk toolbar, recent bookmarks (`*`), preview (`[`), quick-add (`&`), week overview, category collapse, **category rename** (first long-press or double-click rename), quick move (`Shift+M`), quick tag (`Shift+T`), quick delete (`Shift+D`), page overview (`,`), keyboard cheat sheet (`!` / `F1`), and **weather location** when geolocation is blocked. **Reset all dashboard promos** or individual resets (G+jump, cheat sheet, weather location) from **Tours & onboarding**.

**Settings search promo** (desktop config, once until dismissed) — first visit may highlight **Search settings…** in the breadcrumb row with a **New** badge and speech balloon beside the field (`Ctrl/Cmd+Shift+K` for settings navigation vs `Ctrl/Cmd+K` quick actions). Reset from **Tours & onboarding → Reset settings search promo**.

Tours, rotating tips, discoverability promos, and promo banners do not run on the mobile layout. After first-run onboarding finishes or is skipped, **rotating footer tips** wait one minute before appearing (desktop).

#### Config → General (for self-hosters)

**Essentials vs Advanced** — On `config#general`, everyday options (language, appearance, layout, bookmarks, smart collections summary, status overview) live under **Essentials**. Power features (full status tuning, branding, search behaviour, backups) are under **Advanced**. **First visit** always opens **Essentials**; your Essentials / Advanced / **Show all** choice is remembered only after you pick a layer explicitly (toolbar buttons, **Advanced settings →** links, or settings-search navigation). Sticky section links jump and highlight as you scroll; in **Advanced** and **All**, the layer toolbar and nav stay pinned. **Show all sections on one page** flattens everything with **Expand all** / **Collapse all** and an *Advanced sections* divider in the nav. Hash links (`#general/advanced/…`) restore layer and open collapsed panels once a preference exists. Save row and main tab bar use a solid background so scrolling content does not show through.

**Phone vs tablet** — Only phones (≤768px width) limit config to **General** + **Help** with language, theme, and layout panels, and use the reduced dashboard footer (**Search** + **+ Bookmark** only). Portrait tablets and wider touch layouts keep the full config, Essentials/Advanced layers, guided tours, and the desktop dashboard toolbar.

**↺ Reset** — per-control reset buttons beside many General fields restore defaults (marks dirty until **Save**). Advanced **Reset to defaults** card requires expanding before the destructive button is enabled.

**Search settings…** — `Ctrl+Shift+K` / `Cmd+Shift+K` in the breadcrumb row finds tabs, General panels, labels, stats sections, theme groups, keyboard bindings, and Help blocks; matching panels expand before scroll. On mobile, a subset search lives inside the General tab. `Ctrl+K` / `Cmd+K` opens quick actions only (save, open dashboard, tour resets). The General guided tour includes a desktop step for settings search.

**ℹ info buttons** — Click the small ℹ next to any setting label for a short explanation in your current language (EN / NL / DE / FR). No need to leave the page or search the README for what a toggle does.

**Branding & PWA** — Custom title and favicon under Advanced → Branding apply to the browser tab, the web app manifest (`/manifest.webmanifest`), and “Add to Home Screen” / installed PWA name and icon. **Advanced → HyprMode** includes an **Add to home screen** panel with platform steps and a browser install button when available.

In-app help: Config → Help tab → *General settings* (same content, translated).

#### Config → Keyboard

Open **`config#keyboard`** (link from Help → Keyboard shortcuts or the footer tip). **Fixed defaults** at the top match the cheat sheet — add bookmark (`&`, `+` / `Ctrl+Shift+A`, `:new`, `Ctrl+V`), **quick actions** on a selected row (`Shift+M`, `Shift+T`, `Shift+D`, `Ctrl+C`, `[`, `Delete`), and **grid navigation** chords (`G+1–9`, `G+P`, `G G`, `Shift+←/→`, Home/End, Tab, `F1`). **Rebindable** keys below include search (`>`), command palette (`:`), page overview (`,`), global search (`@`), tag cloud (`/`), inline edit (`;`), arrows, Enter, and page tabs `1`–`9`. Click **Rebind**, press a key, then **Save** — conflicts with fixed or existing bindings show a warning. **Export** / **import** your rebindable preset as JSON from the toolbar; fixed shortcuts stay on the cheat sheet.

### Search filters

Type these directly in the search bar (`>` mode, or after opening search). Expand **Filters** in the empty state or start typing a prefix for autocomplete:

- `category:` — filter by category name
- `status:online` / `status:offline` / `status:broken` / `status:ok`
- `status:pinned` / `status:unpinned` / `status:checked` / `status:unchecked`
- `page:current` / `page:all` / `page:2`
- `tag:name` — filter by tag

Partial values (e.g. `status:on`) keep showing suggestions until the filter is complete. `status:online` uses persisted reachability on monitored bookmarks, not only the live status cache.

### Organisation

- Unlimited pages and categories
- Drag-and-drop reorder within and between categories (drag strip on the left); saves debounce 1s with a success toast on the dashboard; bulk tag-filter move/delete groups rapid toasts into one message
- **Per-category sort** — **A–Z** and **Rec** chips in each category header (including *Other* and unknown-category blocks); click an active chip again for manual order; `:sort` in the command palette; legacy global sort removed from Config → General
- **Config → pages** and **config → categories** — drag or **↑/↓** to reorder; auto-save after ~600 ms with a localized sync toast; pages support **archive** (hide without deleting bookmarks)
- **Config → tags** (desktop) — popularity-scaled word cloud (dashboard-style), structured list with usage bars, sorted by bookmark count; scrolls with the page; global rename/merge/delete; drill-down with **Open**; filter + clear; auto-save with undo; **↑/↓** moves focus between tag rows
- **Config → finders** (desktop) — filter list; drag or **↑/↓** reorder with auto-save; usage stats on tab open; stable ids + duplicate shortcut guard
- Long-press a bookmark row (~500 ms) to open inline edit — opaque panel with clear border (including glass launcher); **Save** / **Ctrl+Enter** persists immediately on the dashboard; **Esc** cancels even when the inline-edit promo is open; edits and deletes from **smart-collection** rows sync to the category column and global bookmark store; page switches confirm before discarding unsaved edits; swipe and **Ctrl+V** paste are blocked while the editor is open
- Press and hold a category header (~500 ms, not on sort buttons) to rename it — double-click still works
- Double-click a page tab to rename it — also set an emoji icon and a colour dot per page
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
- Auto dark mode — follows system light/dark without overwriting your saved theme palette id
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List, **Launcher** (large favicon tiles)
- **Show favicons** — toggle bookmark favicons in **Config → General → Bookmarks** or with `:favicons on/off` on the dashboard
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
- **Health beta** (`/health`) — compact nine-stat summary row, unified filter/bulk controls, multi-select bulk favicon/delete with partial-failure toasts, row favicons, keyboard navigation (`j`/`k`, `Enter` → Config editor, `O` → open URL), structured localized issue reasons, default `broken` filter on first visit, URL state sync; **Classic / Modern / Glass** layout parity with dashboard/config (preset, density, backgrounds, opacity, row-action chip styling); `health-runtime.js` keeps row actions responsive (coalesced renders, action lock, timed fetches); per-row repair via overflow menu (**detect redirect** with fast `redirectOnly` suggest and URL confirm, **refresh title**, **archive**); **Re-check status** in toolbar and overflow **Status** section
- Health view with dead-link detection; suggests archive/redirect/title fixes from the row overflow menu
- Health badge on the dashboard header: text pill (e.g. `3 broken`) with red/yellow styling; bulk open broken links asks for confirmation with a per-batch limit
- Filter, sort, and search state in the health view persists across page refreshes (sessionStorage) and syncs to query parameters
- Favicon display and refresh from the health view (per row or bulk selection)
- **Config → stats** (desktop) — insights block, finder usage, period filters with honest lifetime-open labels, **week-over-week** comparison on Activity when the week period is selected, **Refresh** / **Export CSV**, global table filter, row click opens bookmark editor, mobile chip-nav, formatted **Last backup** on overview; conflicts link to health

### Bookmarks

- Metadata auto-fetch (title, description, preview image) when adding a URL
- Hover preview card (opt-in) shows full URL, open count, and last-opened date when enabled in config
- Flash animation on bookmark open — subtle ripple confirms the action was registered
- Plain-text notes per bookmark — visible on the dashboard, in hover previews, and editable via command bar (`:note`), inline edit, or the config detail panel
- Open-count badge tracking usage per bookmark
- Pin bookmarks to keep them at the top of their category (no pin badge on dashboard rows; use `:pin` / inline edit)
- Import from browser HTML export (Chrome, Firefox, Edge) — folders become categories, duplicate URLs skipped; **missing icons are batch-fetched with a progress bar**
- Export all bookmarks to CSV (localized headers: Name, URL, Category, Page, Shortcut, Tags, Notes)
- Full ZIP backup and restore (pages, bookmarks, categories, **finders**, settings, themes, `data/icons/`, custom favicon/font); atomic import with orphan cleanup — **finders preserved** when omitted from ZIP; **last backup date** shown in Config → Backups; after restore, missing bookmark icons are prefetched the same way
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
| Long press a category header (~500 ms) | Rename the category (not on sort buttons; double-click still works) |
| Double-click a page tab | Rename the page |

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

### Branch workflow

| Branch | Purpose |
|--------|---------|
| **`dev`** | Day-to-day development (tests, CI, scripts) |
| **`main`** | Published release for Docker and the public repo page |

1. Branch from **`dev`**, make changes, and open pull requests **into `dev`**.
2. CI runs on pushes and PRs to **`dev`**.
3. When a release is ready, merge **`dev` → `main`** with:

   ```bash
   git checkout dev
   ./scripts/release-to-main.sh v2026.06.30
   ```

   That script merges, strips dev-only files from `main` (tests, Playwright, internal scripts), tags the release, pushes, and publishes a **GitHub Release** (sidebar “Latest”) via [`gh`](https://cli.github.com/).

   **One-time setup:** `brew install gh` and `gh auth login`.

Do **not** merge `dev` into `main` manually on GitHub — the compare banner after pushing to `dev` is informational only until you run the release script.

**Clone for development:** `git clone` then `git checkout dev`.  
**Clone for Docker / stable use:** stay on the default **`main`** branch.

---

## License

MIT
