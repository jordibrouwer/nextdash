# 🚀 nextDash

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard. Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

📖 **[Full user manual (MANUAL.md)](MANUAL.md)** — step-by-step guide for new users: concepts, keyboard workflow, config, import/backup, health, extension, and efficient daily use.

📋 **[Changelog (CHANGELOG.md)](CHANGELOG.md)** — complete release history (new / fix).

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
docker compose up -d
```

**Build from a git checkout:** use `docker-compose.prod.yml` for production (only `./data` is mounted; CSS/JS come from the image). Use `docker-compose.yml` for development (mounts `./static` and `./templates` so changes apply without rebuild).

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

### Build from source

```sh
go build -o nextDash && ./nextDash
```

By default, data is stored in `./data`. Override with `NEXTDASH_DATA_DIR` (absolute or relative path) when you need a separate data location.

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

### Optional CORS allowlist (LAN / VPS / extension)

By default, bookmark API responses send `Access-Control-Allow-Origin: *` so the browser extension and cross-origin tools work without extra config.

Set `NEXTDASH_CORS_ORIGINS` to a comma-separated allowlist when you want to restrict cross-origin reads/writes, for example:

```bash
NEXTDASH_CORS_ORIGINS=https://dash.example.com,chrome-extension://your-extension-id
```

Only matching `Origin` headers receive `Access-Control-Allow-Origin` in the response. Unset or empty keeps the default `*`.

### Activity log (bookmark events)

Structured JSON activity lines are written to the server log for bookmark mutations and status checks by default. Opens are off unless enabled.

```bash
# Default: mutate + status (opens off)
NEXTDASH_ACTIVITY_LOG=mutate,status,open   # include opens
NEXTDASH_ACTIVITY_LOG=off                  # disable all activity logs

# Optional rotating file under the data directory
NEXTDASH_ACTIVITY_LOG_PERSIST=1
NEXTDASH_ACTIVITY_LOG_FILE=/path/to/activity.log   # optional; default data/activity.log

# Optional security events (auth denied, rate limits)
NEXTDASH_ACTIVITY_LOG=mutate,status,security
```

Example log line:

```text
activity: {"ts":"2026-07-03T12:00:00Z","event":"bookmark.add","pageId":1,"name":"GitHub","url":"https://github.com","source":"dashboard"}
```

Status pings are deduplicated for the same URL + result for 10 minutes unless `refresh=1` is passed to `/api/ping`. URLs appear in logs — treat log files as sensitive on shared hosts.

### Rate limits (outbound & SSRF APIs)

Optional per-IP limits on server-initiated fetches and user-triggered SSRF-sensitive endpoints:

```bash
NEXTDASH_OUTBOUND_REQUESTS_PER_MIN=120   # preview, ping, favicon, auto-heal (default 120)
NEXTDASH_SSRF_API_RATE_PER_MIN=60        # /api/bookmark-preview, /api/ping, icon uploads (default 60)
```

When exceeded, the API returns **429** and (if enabled) logs a `security` activity event.

### Content-Security-Policy

nextDash sends a restrictive CSP on HTML pages by default. Set `NEXTDASH_CSP=off` only when a reverse proxy or custom integration requires it.

### DNS rebinding (IP pinning)

Outbound HTTP(S) dials pin resolved public IPs for ~2 minutes so a hostname cannot switch to a private address between the safety check and the connection (unless **allow localhost bookmarks** is enabled).

### Startup validation

On boot, nextDash validates `PORT` (1–65535, default `8080`) and ensures `NEXTDASH_DATA_DIR` exists and is writable. Invalid config exits with a clear error before listening.

### Production Docker example

`docker-compose.prod.yml` serves CSS/JS from the image (only `./data` is mounted). Recommended LAN/VPS environment block:

```yaml
environment:
  - PORT=8080
  - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
  - NEXTDASH_CORS_ORIGINS=https://dash.example.com,chrome-extension://your-extension-id
  - NEXTDASH_ACTIVITY_LOG=mutate,status,security
  - NEXTDASH_ACTIVITY_LOG_PERSIST=1
  # Optional tuning:
  # - NEXTDASH_OUTBOUND_REQUESTS_PER_MIN=120
  # - NEXTDASH_SSRF_API_RATE_PER_MIN=60
  # - NEXTDASH_CSP=off
  # - NEXTDASH_DISABLE_PREFETCH=1
```

`GET /version` returns build metadata (version, commit). `GET /api/data-revision` returns a hash so open dashboard tabs detect bookmark/settings changes without a full reload.

### Environment variables (reference)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP listen port (validated 1–65535) |
| `NEXTDASH_DATA_DIR` | `./data` | Pages, bookmarks, settings, uploads |
| `NEXTDASH_WRITE_TOKEN` | *(unset)* | Require `X-NextDash-Token` on write/destructive APIs |
| `NEXTDASH_CORS_ORIGINS` | `*` | Comma-separated `Origin` allowlist for API CORS |
| `NEXTDASH_ACTIVITY_LOG` | `mutate,status` | `off`, `mutate`, `status`, `open`, `security` (comma-separated) |
| `NEXTDASH_ACTIVITY_LOG_PERSIST` | off | `1` = rotate `activity.log` under data dir |
| `NEXTDASH_ACTIVITY_LOG_FILE` | `data/activity.log` | Custom activity log path |
| `NEXTDASH_OUTBOUND_REQUESTS_PER_MIN` | `120` | Rate limit for server outbound fetches |
| `NEXTDASH_SSRF_API_RATE_PER_MIN` | `60` | Rate limit for preview/ping/icon APIs |
| `NEXTDASH_CSP` | on | Set `off` to disable Content-Security-Policy headers |
| `NEXTDASH_DISABLE_PREFETCH` | off | `1` = skip background favicon prefetch on startup |

---

## Features

### Keyboard-first workflow

**Navigation**
- `0` — open **Inbox** (when search is closed)
- `1–9` — jump directly to a bookmark page tab
- `Shift + ←/→` — cycle between page tabs (plain arrows move bookmarks only, not pages)
- `,` — page overview: all pages with bookmark counts (`Tab` / `Shift+Tab` move between rows; arrow keys do not affect bookmarks behind the overlay)
- `↑/↓/←/→` — move bookmark selection (first arrow key starts navigation); `1–9` page switch also selects the first visible bookmark; mouse hover softens the stale keyboard highlight until your next keypress; on **Modern** and **Glass**, keyboard-selected rows use a full-row accent fill (**v2026.07.01.2**)
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
- `Ctrl + V` — paste a URL on the dashboard: choose **Save to Inbox** or open the new-bookmark modal (blocked while inline edit or the tag word cloud is open; default under General → *Paste URL default*)
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
- `:inbox` / `:inbox triage` — open Inbox page (`0`) or start triage on unread items
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
- `1–9` — jump to the Nth visible config tab (order follows tab groups: **System** → **Dashboard** → **Extras** → **Help**)
- `←`/`→` — previous/next config tab; crosses into the next tab group at group edges (when focus is not in an input or modal)
- `Alt` + `←`/`→` — jump to the first tab of the previous/next tab group
- `S` — save changes
- `Alt + ↑/↓` — reorder the selected bookmark on the Bookmarks tab
- `Ctrl/Cmd + K` — open the config command palette
- `Ctrl/Cmd + Shift + K` — find settings, tabs, and help sections

**Config guided tours** (desktop-width window, once per tab until completed or skipped) — spotlight walkthroughs on **General**, **Bookmarks**, **Pages**, **Categories**, **Tags**, **Stats**, **Collections**, **Finders**, and **Theme** (Stats tour re-enabled in **v2026.07.02**). The **General** tour is overview-only (Essentials / Advanced layers, no user input). Other tours may include optional hands-on demos (temporary pages, categories, tags, collections, bookmarks, finders, or a custom theme) with automatic cleanup. Replay any tour from **config → general → Advanced → System & tools → Tours & onboarding** (open the matching tab first).

**Desktop discoverability promos** (desktop dashboard, once per feature until dismissed) — contextual **Got it** balloons beside search modes (`>`, `:`, `?`, filters), grid arrow navigation, **G+jump** (hold `G` ~300 ms or `G` then `1`–`9`, `G+P`, or `GG` — quick tap `G` opens shortcuts starting with `G`; promo may appear on hold and retries when blocked by What's new), smart collections, inline edit, tag cloud, tag-filter bulk toolbar, recent bookmarks (`*`), preview (`[`), quick-add (`&`), week overview, category collapse, **category rename** (first long-press or double-click rename), quick move (`Shift+M`), quick tag (`Shift+T`), quick delete (`Shift+D`), page overview (`,`), keyboard cheat sheet (`!` / `F1`), and **weather location** when geolocation is blocked. Dismissed promos persist in **`settings.json`** (`discoverabilityState`) and sync across browsers (**v2026.07.01.1**). **Reset all dashboard promos** or individual resets (G+jump, cheat sheet, weather location) from **Tours & onboarding**.

**Settings search promo** (desktop config, once until dismissed) — first visit may highlight **Search settings…** in the breadcrumb row with a **New** badge and speech balloon beside the field (`Ctrl/Cmd+Shift+K` for settings navigation vs `Ctrl/Cmd+K` quick actions). Reset from **Tours & onboarding → Reset settings search promo**.

**Config tab consistency (v2026.06.31)** — list tabs share intro copy, toolbars, filters, and empty states; on **Classic** layout, toolbar + list fuse into one surface card. The breadcrumb row shows tab save mode (**Requires save** / **Auto-save** / **Read-only**) and sub-context on Bookmarks and Categories. **Config → Bookmarks** uses a collapsible **Context** panel (page/category switcher; structure edits on Pages/Categories tabs) that remembers open/closed state. Unified save status beside **Save** replaces the old unsaved badge. Opening `#bookmarks` on a phone shows a desktop-only card instead of a broken editor.

**Config tab bar v5 (v2026.07.01)** — tabs are grouped as **System**, **Dashboard**, **Extras**, and **Help** (Keyboard lives in System). Compact save strip with save-mode pill and dirty-only **Undo**/**Discard**; proportional group widths; tab scroll hint when the bar overflows. On **Modern** and **Glass**, the header + save row + tabs fuse into one chrome card and list tabs use a single fused surface. On **Classic** (**v2026.07.01.3**), the configuration title and header links stay separate from the save row and grouped tabs — each in its own bordered card with spacing between them. `←`/`→` cross tab groups; `Alt+←`/`→` jump between groups. Compact breadcrumb (`tab › context`).

**Config surface parity (v2026.07.01.1)** — **Keyboard**, **Bookmarks**, **Stats**, **Backups**, and **Help** tabs use the shared `config-tab-surface` list-shell: toolbar + content in one card with divided rows (no nested floating cards). Bookmarks search matches other list-tab filter styling; Stats moves **Refresh**/**Export CSV** into the in-surface toolbar. Health links show a compact count-only badge pill. Dismissed discoverability promos and What's new progress sync via `settings.discoverabilityState` in `settings.json` across browsers.

**Config polish (v2026.07.01.4)** — **Pages** and **Categories** list tabs show a **Usage** column (Tags-style popularity bar + bookmark count). Unsaved changes show a dot on the tab group label (e.g. **System ●**). Config tab chrome respects `prefers-reduced-motion`. The Stats guided tour is temporarily disabled.

**Config surface polish (v2026.07.01.5)** — **Bookmarks** Context and **Collections** editor fused into tab surfaces; list tabs share the `config-list-tab` shell; breadcrumb shows Tags filter, Stats period, and Collections edit context; **Skip tour** always persists completion on the server. **Health** redirect check no longer freezes the app.

**Config polish continued (v2026.07.01.8)** — unsaved dot on **Extras ●** when only **Collections** changes (C14); broader `prefers-reduced-motion` coverage for tag cloud, keyboard pulse, health shimmer, and settings-search promo (C15).

**General Advanced toolbar (v2026.07.01.9)** — Essentials / Advanced buttons align flush with the fused General surface; no gap or overlap with Expand/Collapse bulk actions on the Advanced layer.

**Security & self-hosting (v2026.07.03)** — activity log (`NEXTDASH_ACTIVITY_LOG`), CSP headers, outbound/SSRF rate limits, DNS IP pinning, startup validation for `PORT` and `NEXTDASH_DATA_DIR`. README, MANUAL, and Config → Help document write token, CORS, and production Docker.

**Activity log (v2026.07.03)** — structured JSON lines for bookmark mutations, status checks, optional opens, and security events; optional rotating `activity.log` under the data directory.

**Extension shortcuts (v2026.07.03)** — optional shortcut when saving a tab; auto-suggest from bookmark name; **409** when the shortcut is already taken on that page.

**Dashboard sync hardening (v2026.07.03)** — hash-based `GET /api/data-revision`; stale-cache detection for name, URL, and shortcut; preview metadata cache flushes periodically; shared cache-bust tokens across dashboard, config, and health.

**What's new modal (v2026.07.03)** — scroll to load up to the **7 most recent** releases (lazy per-version JSON).

**General layer scroll (v2026.07.03)** — Essentials/Advanced toggle preserves the General layer toolbar viewport position when scroll is within both layers.

**Playwright E2E (v2026.07.03)** — full test suite green with isolated temp data per run; config, tags, finders, and layout-nudge tests aligned with current behaviour.

**Inbox (v2026.07.06)** — lightweight link capture page separate from bookmark pages: save via paste (`Ctrl+V`), browser extension, or API; filter unread, triage one-by-one (`J`/`K`/`O`/`P`/`R`/`D`), promote to a full bookmark; shortcuts `0`, `:inbox`, `:inbox triage`; one-time intro modal; EN/NL/DE/FR.

**Page overview & tips (v2026.07.06)** — pages button opens a centered `AppModal` with card-style rows; rotating footer tips off by default (`:tips on` to enable); `:quicktag` removed from the command palette.

**What's new hotfixes (v2026.07.05.1)** — ★ corner FAB below `/` tag cloud again (not in the centre dock toolbar); Config → Help *Show what's new* with dashboard-matching modal chrome; status-row hover/selection and config save-indicator fixes; merge-regression restores for config load and dashboard assets.

**Config shell & polish (v2026.07.05)** — Help split-shell with chip nav (B5); Tags/Backups divided rows; Theme Colors toolbar matches General chrome; Theme dirty state via save row only (B10); broader `prefers-reduced-motion` (C15).

**Dashboard chrome (v2026.07.05)** — unified header chips and toolbar hierarchy; theme surface tokens on footer buttons; lighter card rows; shared toolbar modal chrome; polished empty states, search overlay anchoring, and layout radii; page overview icons and tag-filter recovery.

**Recent modal & status rows (v2026.07.05)** — rank, recency badge, and open count in recent bookmarks (D8); status-row hover/selection via shared bookmark-row tokens (D12).

**Fresh-install toolbar (v2026.07.05)** — new installs show Search, Commands, Finders, and + Add bookmark in the centre dock only; Recent and cheat sheet off until enabled in Config → General → Header & buttons (★ What's new is a separate corner FAB — see **v2026.07.05.1**).

**Status loading default (v2026.07.05)** — show status loading indicator is off unless explicitly enabled.

**Classic layout default (v2026.07.05)** — onboarding keeps Classic; Modern/Glass show a one-time early-beta notice. Classic config header stays separate from save row and tabs (**v2026.07.01.3** — C10 reverted).

**Config surface polish (v2026.07.04)** — General layer switcher (Essentials / Advanced / Show all in one row); stronger active tab group styling; list tabs share `config-list-tab` intro shell; button visibility as divided rows.

**Bookmarks master/detail (v2026.07.04)** — filters and bulk actions above a split view: bookmark list (master) + detail editor (pane) inside one fused surface.

**Stats split-layout (v2026.07.04)** — chip navigation and sidebar index inside one fused Stats surface (Help-style split shell).

**Theme colors divided list (v2026.07.04)** — color rows, custom themes, and preview use divided-list rhythm inside the fused Theme surface (no nested cards on Modern, Glass, or Classic).

**Bookmark category sync (v2026.07.02)** — new bookmarks and category changes appear in the correct dashboard column right away; `GET /api/data-revision` keeps open tabs in sync after saves and server restarts.

**Bookmark tag sync (v2026.07.02)** — tag edits re-render smart collections and the tag-filter view; stale-cache detection includes tags.

**Config polish (v2026.07.02)** — Stats guided tour re-enabled; General spacing (B6), shared tab intro (B7), uniform label width (A8), keyboard row rhythm (A10), persistent empty hints (B11), broader reduced-motion (C15).

**Inline edit focus (v2026.07.01.8)** — long-press inline editor uses a nearly opaque panel and tour-like full-page blur so labels and fields stay readable on glass and launcher layouts.

**General split-shell (v2026.07.07)** — Config → General uses the same sticky-sidebar layout as Stats and Help: a **quick links** column lists every section and stays in view while you scroll, highlighting the section currently on screen. Opening a section — from the sidebar or by clicking its own title — collapses whichever other section was open (single-section accordion); a second click on an already-open, in-view section closes it again, and clicking the link for an open section scrolled out of view scrolls back to it instead of closing it invisibly. **Advanced** splits into smaller cards — **Search & input**, **System & tools**, and a standalone **Tours & onboarding** — instead of one long block. *Offline retries*, *Retry delay*, and *Minimum bookmarks per tag* number inputs now use the same themed styling as other fields.

**Help rework & shell polish (v2026.07.08, hotfixed in v2026.07.08.1)** — Config → Help's topics are consolidated into fewer, reordered sections (*Getting started, Configuring nextDash, Keyboard shortcuts, Search/commands/toolbar, Finders, Appearance & display, Organizing bookmarks, Pages/categories/bulk editing, Tags & collections, Inbox, Health & status, Data & backups, Self-hosting & troubleshooting*) and now shares General's sticky **quick links** sidebar and single-section accordion. Quick-link clicks always land on the section title instead of scrolling partway in. The **Support me on Ko-fi** button gets the same twinkling-star glow animation as the What's New modal's donate CTA, centered on its own row; the **jordibrw.nl** signature link is larger and accent-themed. General's sections now have a dividing border between them like Help's, and the vertical divider between the quick-links sidebar and content now runs the full height of the page on both tabs instead of stopping partway down. **v2026.07.08.1** fixes the same scroll-offset issue on General's own quick links, which still landed a few lines past the section title.

Tours, rotating tips, discoverability promos, and promo banners do not run on the mobile layout. After first-run onboarding finishes or is skipped, **rotating footer tips** wait one minute before appearing (desktop).

#### Config → General (for self-hosters)

**Essentials vs Advanced** — On `config#general`, everyday options (language, appearance, layout, bookmarks, smart collections summary, status overview) live under **Essentials**. Power features (full status tuning, branding, search behaviour, backups) are under **Advanced**. **First visit** always opens **Essentials**; your Essentials / Advanced / **Show all** choice is remembered only after you pick a layer explicitly (toolbar buttons, **Advanced settings →** links, or settings-search navigation). A sticky **quick links** sidebar (**v2026.07.07**) lists every section next to the settings and stays in view while you scroll. Click a section title, or its quick link, to expand or collapse it — opening one collapses whichever other section was open, so only one stays expanded at a time. **Show all sections on one page** flattens everything with **Expand all** / **Collapse all**. Hash links (`#general/advanced/…`) restore layer and open collapsed panels once a preference exists. Save row and main tab bar use a solid background so scrolling content does not show through.

**Phone vs tablet** — Only phones (≤768px width) limit config to **General** + **Help** with language, theme, and layout panels, and use the reduced dashboard footer (**Search** + **+ Bookmark** only). Portrait tablets and wider touch layouts keep the full config, Essentials/Advanced layers, guided tours, and the desktop dashboard toolbar.

**↺ Reset** — per-control reset buttons beside many General fields restore defaults (marks dirty until **Save**). Advanced **Reset to defaults** card requires expanding before the destructive button is enabled.

**Search settings…** — `Ctrl+Shift+K` / `Cmd+Shift+K` in the breadcrumb row finds tabs, General panels, labels, stats sections, theme groups, keyboard bindings, and Help blocks; matching panels expand before scroll. On mobile, a subset search lives inside the General tab. `Ctrl+K` / `Cmd+K` opens quick actions only (save, open dashboard, tour resets). The General guided tour includes a desktop step for settings search.

**ℹ info buttons** — Click the small ℹ next to any setting label for a short explanation in your current language (EN / NL / DE / FR). No need to leave the page or search the README for what a toggle does.

**Branding & PWA** — Custom title and favicon under Advanced → Branding apply to the browser tab, the web app manifest (`/manifest.webmanifest`), and “Add to Home Screen” / installed PWA name and icon. **Advanced → HyprMode** includes an **Add to home screen** panel with platform steps and a browser install button when available.

In-app help: Config → Help tab → *General settings* (same content, translated).

#### Config → Keyboard

Open **`config#keyboard`** (link from Help → Keyboard shortcuts or the footer tip). **Fixed defaults** at the top match the cheat sheet — add bookmark (`&`, `+` / `Ctrl+Shift+A`, `:new`, `Ctrl+V`), **quick actions** on a selected row (`Shift+M`, `Shift+T`, `Shift+D`, `Ctrl+C`, `[`, `Delete`), **grid navigation** chords (`G+1–9`, `G+P`, `G G`, `Shift+←/→`, Home/End, Tab, `F1`), and a **Config tab bar** section (`1–9`, `←/→` with group wrap, `Alt+←/→` between groups, `S`, `Ctrl/Cmd+K`, `Ctrl/Cmd+Shift+K`, `Alt+↑/↓` on Bookmarks). **Rebindable** keys below include search (`>`), command palette (`:`), page overview (`,`), global search (`@`), tag cloud (`/`), inline edit (`;`), arrows, Enter, and page tabs `1`–`9`. Click **Rebind**, press a key, then **Save** — conflicts with fixed or existing bindings show a warning. **Export** / **import** your rebindable preset as JSON from the toolbar; fixed shortcuts stay on the cheat sheet.

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
- **Config → pages** and **config → categories** — drag or **↑/↓** to reorder; auto-save after ~600 ms with a localized sync toast; pages support **archive** (hide without deleting bookmarks); **Usage** column with popularity bar + bookmark count (Tags-style tier styling)
- **Config → tags** (desktop) — popularity-scaled word cloud (dashboard-style), structured list with usage bars, sorted by bookmark count; scrolls with the page; global rename/merge/delete; drill-down with **Open**; filter + clear; auto-save with undo; **↑/↓** moves focus between tag rows
- **Config → finders** (desktop) — filter list; drag or **↑/↓** reorder with auto-save; usage stats on tab open; stable ids + duplicate shortcut guard
- Long-press a bookmark row (~500 ms) to open inline edit — nearly opaque panel with tour-like full-page blur behind it (including glass launcher); **Save** / **Ctrl+Enter** persists immediately on the dashboard; **Esc** cancels even when the inline-edit promo is open; edits and deletes from **smart-collection** rows sync to the category column and global bookmark store; page switches confirm before discarding unsaved edits; swipe and **Ctrl+V** paste are blocked while the editor is open
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
- ★ What's New star button in the corner opposite the button bar — always visible; latest release loads first; scroll for up to **7 recent versions** (each loads on demand)
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Optional hover preview cards (off by default) — enable in **Config → General → Advanced → Bookmarks**; configurable hover delay
- Background image or gradient support
- Clickable date/time header showing a week-overview popover; optional calendar URL link

### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- **Health beta** (`/health`) — compact nine-stat summary row, unified filter/bulk controls, multi-select bulk favicon/delete with partial-failure toasts, row favicons, keyboard navigation (`j`/`k`, `Enter` → Config editor, `O` → open URL), structured localized issue reasons, default `broken` filter on first visit, URL state sync; **Classic / Modern / Glass** layout parity with dashboard/config (preset, density, backgrounds, opacity, row-action chip styling); `health-runtime.js` keeps row actions responsive (coalesced renders, action lock, timed fetches); per-row repair via overflow menu (**detect redirect** with fast `redirectOnly` suggest and URL confirm, **refresh title**, **archive**); **Re-check status** in toolbar and overflow **Status** section
- Health view with dead-link detection; suggests archive/redirect/title fixes from the row overflow menu
- Health badge on the dashboard and config headers: compact count-only pill (e.g. `3`) with theme accent colours for broken vs warnings; screen readers get a full `aria-label` (**v2026.07.01.1**); bulk open broken links asks for confirmation with a per-batch limit
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
4. If the server uses `NEXTDASH_WRITE_TOKEN`, paste the same value under **Write token (optional)**
5. Choose a default page and save

### Save tab

- Pre-filled title and URL; optional **shortcut** (auto-suggested from the name when left empty)
- Pick page/category, tags, and note — or **Save to Inbox** for a quick capture without choosing a page
- Duplicate URL warning; **409** when the shortcut is already taken on that page
- If a dashboard tab is open on the same server, it may toast and refresh

When you restrict CORS with `NEXTDASH_CORS_ORIGINS`, include your extension origin (`chrome-extension://…` from `chrome://extensions`).

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
   ./scripts/release-to-main.sh v2026.07.02
   ```

   That script merges, strips dev-only files from `main` (tests, Playwright, internal scripts), tags the release, pushes, and publishes a **GitHub Release** (sidebar “Latest”) via [`gh`](https://cli.github.com/).

   **One-time setup:** `brew install gh` and `gh auth login`.

Do **not** merge `dev` into `main` manually on GitHub — the compare banner after pushing to `dev` is informational only until you run the release script.

**Clone for development:** `git clone` then `git checkout dev`.  
**Clone for Docker / stable use:** stay on the default **`main`** branch.

---

## License

MIT
