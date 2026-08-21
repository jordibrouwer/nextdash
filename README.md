<p align="center">
  <img src="logo-ascii-on-black-large.png" alt="nextDash" width="720">
</p>

# nextDash

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

My bookmark bar had become a graveyard, so I built a self-hosted dashboard that tells me which links are already dead.

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard. Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

📖 **[Full user manual (MANUAL.md)](MANUAL.md)** — step-by-step guide for new users: concepts, keyboard workflow, config, import/backup, health, extension, and efficient daily use.

📋 **[Changelog (CHANGELOG.md)](CHANGELOG.md)** — complete release history (new / fix).

🗂️ **[Cheat sheet](nextDash-cheatsheet.pdf?raw=true)** — every keyboard shortcut, printable ([HTML](nextDash-cheatsheet.html?raw=true)); press **!** or **F1** on the dashboard for the live searchable list. Regenerate with `npm run generate:cheatsheet`.

🌐 **Official Website:** [nextdash.cc](https://nextdash.cc)

📰 **Developer Blog & Updates:** [jordibrw.cc](https://jordibrw.cc)

🍏 **macOS Dropzone 5 Integration:** Send URLs straight to your dashboard or Inbox from any app or browser using the [Dropzone 5 script for nextDash](https://github.com/jordibrouwer/dropzone-script-for-nextdash-on-macos).

---

## Screenshots
<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-1.png" alt="Dashboard" width="100%" />
      <br />
      <sub><b>Dashboard</b> — Your new home.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-2.png" alt="Inbox view" width="100%" />
      <br />
      <sub><b>Inbox</b> — The inbox holding area for links you want to keep without deciding where they go yet.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-3.png" alt="Health view" width="100%" />
      <br />
      <sub><b>Health</b> — The health view collects everything needing attention across all pages.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-4.png" alt="Health monitoring" width="100%" />
      <br />
      <sub><b>Health Monitor</b> — Monitored bookmarks keep a history.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-5.png" alt="Statistics" width="100%" />
      <br />
      <sub><b>Inbox</b> — See trends of your bookmarks usage.</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>


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

Set environment variable `NEXTDASH_WRITE_TOKEN` to a long random string. Protected endpoints then require header `X-NextDash-Token` with that value. The dashboard injects the token automatically when you open it in a browser.

The two capture routes — `GET /share` (the PWA share target) and `GET /add` (the bookmarklet) — cannot send a header: a phone's share sheet and a `javascript:` bookmark have no way to set one. On an install with a write token they therefore need a token in the address. Set `NEXTDASH_CAPTURE_TOKEN` to a second long random string and use that one: it opens capture and nothing else, so a bookmarklet sitting in a browser's history can at worst add a link to your inbox. The write token is accepted there too, for a script that already carries it.

Protected actions include: **reset all data** (also requires `{"confirm":true}`), **download or import backup**, **delete page**, **bookmark preview fetch**, **bookmark ping** (`/api/ping`), **health delete / retest / merge / auto-heal / open-broken / cache-scan / update-status**, **clear or refresh all bookmark previews**, **bookmark/page/category/finder/settings saves**, **uploads** (favicon, font, icon), and **reset theme colours**.

When the token is **not** set, behaviour is unchanged — everything stays open for local dev. When it **is** set, the dashboard injects the token automatically so normal browser use is unaffected. The browser extension can store the same write token in **Settings → Write token**.

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

# Automatic backups: how many are kept, and where they live
NEXTDASH_AUTO_BACKUP_KEEP=3                        # 1–50; default 3
NEXTDASH_AUTO_BACKUP_DIR=/mnt/backups/nextdash     # absolute path; default data/auto-backups

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

To read them without shell access, open **Config → Data & backups → Server log** and set **Show** to **Activity only** — the same lines, with the request traffic around them filtered out. It needs **Collect server log** switched on, because it is the same buffer; which events get written is still decided by the environment variables above.

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

### Analytics & privacy

nextDash can record **anonymous, privacy-friendly usage statistics** through a self-hosted [Umami](https://umami.is) instance at `stats.nextdash.cc`. It is **opt-in**: off until you turn it on, and nothing is measured before then.

On a fresh install a card offers **Turn on**, **What is recorded?**, or **No thanks**. Upgrading does not change a setting you already made — if you had analytics on, it stays on.

#### Turn it on or off

**Config → Behavior → Privacy** → tick or clear **Privacy-friendly analytics**. It applies after the page reloads.

From the keyboard: press <kbd>:</kbd> and run **`:telemetry on`** (or `:telemetry off`). Typing `:telemetry` on its own shows the current state. It writes the same setting and reloads the page for you.

#### Disable it for the whole instance

Set the environment variable **`DISABLE_TELEMETRY=true`** to switch analytics off server-wide, regardless of what any user has configured:

```yaml
environment:
  - DISABLE_TELEMETRY=true
```

The tracker is then never emitted, the setting cannot be turned back on through the API or the `:telemetry` command, and the **Privacy** checkbox in config renders disabled with a note explaining why. `:telemetry` shows a single row saying it is off for this server, rather than an **on** option that could not take effect. Accepts `true`, `1`, `yes`, or `on`; unset or `false` leaves analytics under user control.

Each user's own preference is left stored and untouched, so it returns exactly as it was if you ever unset the variable.

When it is off, the tracker script is **not emitted into the page at all** — it is never even downloaded, and **no request leaves your machine**. There is no client-side flag quietly suppressing calls; the code simply is not there. The choice is stored per user in `settings.json` as `analyticsOptIn`, so it follows you across devices.

#### Why it exists

nextDash was built without any picture of how it is actually used. Which views do people open? Does anyone use finders, the tag cloud, or the inbox? Where do people abandon the add-bookmark form? Without answers, every decision about what to build, fix, or remove is guesswork.

These statistics exist to answer exactly that — **which features get used, and what can be improved** — and nothing else. They are explicitly **not** for following individual users. The measurement is abstract and technical: flow through the app and feature usage, aggregated across everyone.

#### What is measured

Everything below is an event name plus a small set of properties. Names come from a fixed list in the code; nothing you type is ever a property value.

- **Page views** — the dashboard, config, health, and colors pages.
- **Views and navigation** — opening the health and inbox views, switching dashboard pages (by position, never by name), which config tab you land on, and use of the `<` dashboard↔config shortcut. Within config, which of the eight **sections** you open, which **sub-tab** you land on and whether you got there by click or by arrow key, whether an overview *needs attention* row was followed, whether a summary tile handed off to another view, and whether the **Only changed** filter is on.
- **Settings changes** — the **name** of the setting you changed, never what you typed into it. Toggles also report `true`/`false`, since on/off is the whole point of measuring one and cannot identify anyone. Free-text fields — dashboard title, webhook URL, custom text — report the name alone, and search boxes are not reported at all. A panel's **Reset** and its **Show all / Hide all** report how many fields they touched.
- **List shape in health and inbox** — which filter or sort you picked, and whether you used a summary tile or a filter pill. The search box in either view is never reported.
- **Overlays** — opening search, commands, finders, the cheat sheet, the tag cloud, what's-new, and the add-bookmark form.
- **Bookmark opens** — the fact that one was opened and where from (`dashboard`, `search`, `recent`, or `health`).
- **Commands** — which command palette command was run, by its name (`theme`, `config`, `density`, …). Only names from the built-in command list are recorded; anything else you typed is discarded.
- **Bookmark maintenance** — starting an edit and saving it (with whether that was on the dashboard or in config), deleting, moving to another category (with a bucketed count, so a bulk move counts once), reordering by drag or by keyboard, changing a bookmark's checking mode, and which entry you picked from a right-click menu — on a bookmark or on a category header.
- **Outcomes** — whether adding or editing a bookmark succeeded, or hit a duplicate, shortcut conflict, validation error, stale edit, or failure. This shows where the form trips people up.
- **Inbox and health actions** — snooze, mark-read, wake, promote, delete, and bulk clean-ups; rechecks, retest-all, redirect detection, title refresh, delete, muting alerts, accepting drift, auto-heal, recovering from the archive, opening the expectations or monitor-stats panels, stepping through a review session, reading the trend chart, and exporting history. Bulk actions and exports also report **how many rows they touched**, rounded into a band (`1`, `2`, `5`, `10`, `25`, `50`, `100`, `100+`).
- **Category width** — switching a category to spread across columns, or back.
- **Fresh** — turning it on from its walkthrough, and opening the card that offers it.
- **First-run help** — a tour or walkthrough being shown, and whether it was finished or abandoned, with the step you left on: the spread, inbox, health and Fresh walkthroughs, and which session **tip** was shown.
- **A settings snapshot** — once per page load, which features you have switched on: theme (built-in id, or just `custom`), layout, density, spacing, font, background, button-bar position, columns, the row toggles, search options, inbox and health settings, smart collections, and a dozen more, as plain booleans and small enums with numbers bucketed. It carries the **release you are running**, so adoption can be read per version — without it a default that changed between releases looks like a gradual drift rather than the switch it was. The version is the published release tag, not your hostname, install or machine.
- **A content snapshot** — once per page load, **how much** is in the install: bookmarks, pages, categories, tags, finders, your own smart collections, how many bookmarks are monitored and how many merely checked, and four inbox figures (waiting now, plus lifetime added, promoted and deleted). Every one is bucketed before it leaves the browser — `500+`, never `1274` — because an exact total is distinctive enough to follow one install across releases. Counted on the server, since the page you have open only knows about itself.

Both snapshots are capped at Umami's 50 properties per event and say so (`truncated: true`) rather than letting the tail be dropped in silence.

#### What is never measured

No bookmark names, URLs, search queries, page or category names, notes, or tags. No personal profile is built, and there is no tracking across other websites. Every number is rounded into a band before it leaves the browser — `500+` rather than `1274`, `25` rather than `23` — and the rounding sits in the one function all events pass through, so a new event cannot reintroduce an exact figure by forgetting to round it. The two exceptions are a page position and a walkthrough step, which are small fixed ranges that describe nothing about your collection. No cookies are set, and the instance is self-hosted, so nothing is shared with an advertising network.

The tracker loads from `stats.nextdash.cc`, which is allow-listed in the CSP (`script-src` and `connect-src`).

### DNS rebinding (IP pinning)

Outbound HTTP(S) dials pin resolved public IPs for ~2 minutes so a hostname cannot switch to a private address between the safety check and the connection (unless **allow localhost bookmarks** is enabled).

### Startup validation

On boot, nextDash validates `PORT` (1–65535, default `8080`) and ensures `NEXTDASH_DATA_DIR` exists and is writable. Invalid config exits with a clear error before listening.

### Production Docker example

`docker-compose.prod.yml` serves CSS/JS from the embedded binary (only `./data` is mounted). As of **v2026.08.02** the production image ships only the Go binary (~40% smaller), sets a 256 MB memory cap, and caches hot server paths (parsed templates, store reads, precomputed asset hashes). Since **v2026.08.02.1** the entrypoint starts as root for host Docker hooks, then runs the app as `nextdash` (`NEXTDASH_RUN_AS_ROOT=1` optional). Optional TLS and long-cache static serving: `docker compose -f docker-compose.proxy.yml up -d` with `deploy/Caddyfile`.

Recommended LAN/VPS environment block:

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
- `Shift + I` — open **Inbox** view directly (recommended; `0` still works)
- `1–9` — jump directly to a bookmark page tab
- `Shift + ←/→` — cycle between page tabs (plain arrows move bookmarks only, not pages)
- `Shift + H` — open **Health** view directly (inside dashboard)
- `,` — page overview: all pages with bookmark counts (`Tab` / `Shift+Tab` move between rows; arrow keys do not affect bookmarks behind the overlay); same modal from the **pages** grid icon in the header (evenly spaced with inbox, health, and config)
- `<` — open **config** (`<` is `Shift+,`); in config, `<` returns to the dashboard, confirming first if there are unsaved changes
- `↑/↓/←/→` — move bookmark selection (first arrow key starts navigation); `1–9` page switch also selects the first visible bookmark; mouse hover softens the stale keyboard highlight until your next keypress; on **Modern**, keyboard-selected rows use a full-row accent fill
- `Tab` / `Shift+Tab` — step linearly through all bookmarks when one is already selected
- `G + 1–9` — jump to the nth category or smart collection and select its first bookmark. The first `G` arms the chord straight away and it lapses after three seconds; a second `G` jumps to the top of the page
- `G + P` — jump to the first pinned bookmark on the page (hold `G` or `G` then `P`)
- `GG` — jump to the very first bookmark (second `G` while the chord is pending)
- `Ctrl + Home` / `Ctrl + End` — first / last bookmark on the page (`Cmd` on Mac)
- `Enter` / `Space` — open the focused bookmark (middle-click also counts toward open stats and smart collections)
- `Esc` — clear selection, close overlay, or undo an unsaved drag reorder (before the 1s save completes)

**Blocking overlays** — While search (`>`), the cheat sheet (`!` / `F1`), recent bookmarks (`*`), tag cloud (`/`), page overview (`,`), quick-add omnibox (`&`), quick-move/delete/tag popovers (`Shift+M` / `Shift+D` / `Shift+T`), inline edit (`Shift+E`), or an app modal is open, keyboard focus stays inside that overlay (`Tab` cycles within it) and the bookmark grid behind it is `inert` (not clickable). With an **active tag filter**, only the filtered bookmark list is `inert` — the filter banner and bulk toolbar stay interactive while the tag cloud is open. Closing the overlay restores mouse and keyboard access to the grid; quick-move/delete/tag popovers also restore the keyboard highlight on the same bookmark row.

**Bookmarks**
- `+` — open the full new-bookmark modal (dashboard only, when no input is focused)
- `&` — quick-add omnibox: type `name | url | shortcut` in one line
- `Ctrl + Shift + A` — same full new-bookmark modal from anywhere
- `Ctrl + V` — paste a URL on the dashboard: choose **Save to Inbox** or open the new-bookmark modal (blocked while inline edit or the tag word cloud is open; default under General → *Paste URL default*)
- `Shift + E` — inline-edit the focused bookmark (`;` still works, undocumented)
- `Shift + M` — *Move to…* quick-move popover: choose a category or page with arrow keys
- `Shift + T` — *Quick tag* popover beside the focused bookmark: `↑`/`↓` navigate ranked tags; `Enter`/`Space` toggle a tag and advance to the next; `✓` shows tags already on the bookmark
- `Shift + D` — quick-delete popover with undo in the toast
- `Shift + C` — *Checking* popover beside the focused bookmark: choose **Off**, **Periodic**, or **Monitor** with `o` / `p` / `m`, or arrow to one and press `Enter`
- `Shift + P` — pin or unpin the focused bookmark; also in the right-click menu
- `Shift + L` — share the focused bookmark, or copy its name and URL where no share sheet exists
- `Shift + R` — open the focused bookmark on its own row in **Health**
- `t` — filter the grid to the focused bookmark's tag; several tags open the picker
- `Ctrl/Cmd + Enter` — open the focused bookmark in a new tab for that press alone, whatever **open in new tab** is set to
- `Ctrl + C` / `Cmd + C` — copy the URL of the focused bookmark (row flashes green)
- `Shift + V` — open the preview card on the focused bookmark and keep it open, with **Copy**, **Refresh** and **Edit** in its footer; `Esc` closes it and hands focus back to the row. Works whatever the card's mode is, so it is the whole of the feature on **keyboard only** (`[` still works, undocumented)
- `Delete` — delete the focused bookmark
- `x` / `X` — tick the focused bookmark and advance / tick its whole category. `Shift + ↑`/`↓` extends a range, `Ctrl/Cmd + A` takes everything on screen, and `Alt+click` / `Shift+click` do the same with the mouse — `Ctrl/Cmd + click` is left to the browser, where it opens the bookmark in a new tab (**v1.3.1**; it used to tick the row). A toolbar appears with **Move**, **Open**, **Copy links** and **Delete**, matching the entries the right-click menu gains; `Esc` clears the selection. A plain click with a selection open clears it rather than opening a bookmark

**Search & commands**
- `>` — open search; empty state shows recent queries and saved searches as chips; `←`/`→` select a chip, `Enter` applies it
- `/` — fuzzy search; ranked by prefix → word-boundary → substring; also matches URL domain, tags, and note text
- `:` — command palette (lone `:` from the dashboard); **5 collapsible groups** (**Bookmarks**, **Search & navigate**, **Look & layout**, **Smart collections**, **Settings & tools**) — click a header to expand; **recent commands** appear at the top when you reopen lone `:`; toggles refresh in place with `(on)`/`(off)` or `✓` after `Enter` (no toasts). In an open `>` search with text already typed, `:` inserts filter syntax (`category:`, `tag:`, …) instead of switching modes
- `?` — finders (e.g. `?g query` to search Google)
- `*` — recent bookmarks panel
- `! or F1` — keyboard cheat sheet (filterable with a type-to-search input; blocked while page overview `,` is open)
- `category:` / `tag:` / `page:` / `status:` — filter directly in the search bar; autocomplete suggests values after each prefix (single **Filters** group)
- `:goto <url-or-domain>` — navigate to a URL or bare domain (e.g. `:goto github.com`); `:goto config` / `stats` / `health` for quick navigation
- `:new` — open new-bookmark modal (same as `+` / `Shift+B` / `Ctrl+Shift+A`)
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
- `:inbox` / `:inbox triage` — open Inbox page (`Shift + I`) or start triage on unread items
- `:config [section]` — open config or a tab (`bookmarks`, `backups`, `stats`, …)
- `:remove` — delete the focused bookmark
- `:sort <method>` — per focused category: `order` / `az` / `recent` (palette shows the category name)
- `:stale [days]` — list stale bookmarks; optional day window (e.g. `:stale 7`)
- `:duplicate` / `:duplicates` — list bookmarks with duplicate URLs (opens health duplicates view)
- `:health [filter]` — open health view — `broken`, `duplicate`, `stale`, `refresh`, …; `:health page [n]` opens health with a page context
- `:monitor` — how many bookmarks are being checked; `:monitor off` stops checking all of them, `:monitor on` opens the never-checked list where the bulk enable lives
- `:dark` / `:title` / `:lang` / `:animations` / `:status` / `:opacity` — display and theme toggles
- `:collections` — toggle smart collections (today, recent, stale, most used)
- `:backup` / `:export` — open config backups or download a ZIP backup
- `:metadata` — health missing previews or config bookmarks
- `:layout <preset>` — `default` / `compact` / `cards` / `masonry` / `list` / `launcher` …
- `:theme <name>` — switch colour theme
- `:density <mode>` — `comfortable` / `compact` / `dense`
- `:columns <n>` — set column count (1–6)
- `:width on|off` — spread the focused category across columns (`:width all` switches every one back)
- `@` — global search across all pages at once; each result shows the page name as context
- `:find <text>` — hide tiles whose name or URL don't match; `:find clear` removes the filter
- `:buttonbar <position>` — move the button bar: `bottom` / `bottom-left` / `bottom-right` / `side-left` / `side-right`
- `:save` / `:saved` — save current query / show saved searches (kept in settings, so they are in every ZIP backup and follow you between browsers)

**Config view**
- `Shift+S` or `<` (`Shift+,`) — open config from the dashboard
- `Esc` — close config and return to the dashboard (dismisses an open modal, search or tag cloud first)
- `←`/`→` — previous/next sub-tab, wrapping at both ends
- `Home` / `End` — first / last sub-tab

> **Release history** — what changed in each version, with the reasoning behind it, lives in the
> **[changelog](CHANGELOG.md)**. The **★** button in the dashboard shows the same notes in-app.
> This section describes what nextDash does today.

#### Config (for self-hosters)

**Where things live** — config is a view inside the dashboard at `/#config`, opened with **`Shift+S`**, **`<`**, or the header link, and closed with **`Escape`**. Reopening it within **5 minutes** restores the **last section and sub-tab** you were on, whichever way you left — including the header buttons that switch view around it; after that it starts on **Overview** again. A deep link like `/#config/behavior/privacy` still wins. It has eight sections: **Overview**, **Pages & tags**, **Bookmarks**, **Appearance**, **Behavior**, **Data & backups**, **Statistics**, and **Help**. Sections with sub-tabs are addressable too — `/#config/behavior/privacy` opens Behavior on Privacy — so a link to any setting can be shared.

The settings a self-hoster reaches for most: **Behavior → General** (localhost & private-network bookmarks, HyprMode, session tips), **Behavior → Privacy** (analytics), **Behavior → Status & health** (background rechecks, downtime webhook), and **Data & backups** (backup, restore, import/export, the **Trash** — deleted bookmarks stay recoverable for 30 days, with search and bulk restore — and **Reset**, each on its own sub-tab).

**Saving** — most settings save the moment you change them and confirm with a short *Saved* message. The bookmark editor is the exception: it collects edits and writes them on **Save**.

**Phone vs tablet** — every config section is reachable at any width; content stacks and controls reflow on narrow screens. Phones (≤768px) still use the reduced dashboard footer (**Search** + **+ Bookmark** only).

**ℹ and ↺** — many controls carry an **ℹ** explaining the setting and a **↺** restoring its default.

**Keyboard** — sub-tab strips follow the ARIA tabs pattern: **`←`/`→`** move and wrap, **`Home`**/**`End`** jump to the ends. Explanations behind **ℹ** are localised (EN / NL / DE / FR).

**Branding & PWA** — Custom title and favicon under Advanced → Branding apply to the browser tab, the web app manifest (`/manifest.webmanifest`), and “Add to Home Screen” / installed PWA name and icon. **Advanced → HyprMode** includes an **Add to home screen** panel with platform steps and a browser install button when available.

In-app help: Config → Help tab → *General settings* (same content, translated). **Tips** filters to the single tip, and a topic that continues on another tab links straight to the panel it continues in (**v1.3.0**). Since **v1.3.0** every help article opens with a small drawing of its own subject — the search prefixes in a field, the health tiles in their own colours, a certificate meter, a maintenance window — rather than a paragraph describing a shape.

### Search filters

Type these directly in the search bar (`>` mode, or after opening search). Expand **Filters** in the empty state or start typing a prefix for autocomplete:

- `category:` — filter by category name
- `status:online` / `status:offline` / `status:broken` / `status:ok`
- `status:pinned` / `status:unpinned` / `status:checked` / `status:unchecked`
- `status:untagged` / `status:tagged` / `status:noted` / `status:unnoted` (**v1.2.0**)
- `status:feed` / `status:unfed` (**v1.3.1**) — bookmarks whose page publishes something Fresh can read, and the rest
- `-` before any filter excludes instead of selects (**v1.2.0**) — `tag:dev -status:pinned` is "dev links I have not pinned"; a half-typed `-tag:` excludes nothing
- `page:current` / `page:all` / `page:2`
- `tag:name` — filter by tag
- `added:` / `opened:` — `today`, `week`, `month` or `year`; `opened:never` finds bookmarks you have never opened. Both are offered while you type, with their words listed once the key is in
- The page's own fetched description is searched too, below the title, URL, tags and your note — often the only place holding what you remember about a page titled *Untitled* or *Login*

Partial values (e.g. `status:on`) keep showing suggestions until the filter is complete. `status:online` uses persisted reachability on monitored bookmarks, not only the live status cache.

### Organisation

- Unlimited pages and categories
- Drag-and-drop reorder within and between categories (drag strip on the left); saves debounce 1s with a success toast on the dashboard; bulk tag-filter move/delete groups rapid toasts into one message
- **One rule for the keyboard** (**v1.1.1**) — every action on a bookmark is `Shift` plus a letter (`Shift+E` edit, `Shift+V` preview, `Shift+L` share), `Shift+S` always opens config, bare letters act on the first press, `k`/`j` move the highlight, and `Shift+Home` reaches the category header. The right-click menu shows the key beside each entry
- **A shortcut opens the moment it matches** (**v1.3.0**) — the default v1.2.0 changed, and changed back. Typing a bookmark shortcut opens it straight away: a shortcut that needs `Enter` to finish is not much of a shortcut, and making `Enter` the default treated a rare collision as the normal case
- **…and the other two modes are still there** — **Config → Behavior → Search → Typing a bookmark shortcut** offers *open after a short pause*, which waits until you stop typing so a longer word carries on untouched, and *press `Enter` to open*, where typing only narrows the list. The ℹ beside them spells out what each one costs: on an install with 200 shortcuts, eight of thirteen everyday words were swallowed mid-word by the instant mode, and which ones survive depends on the shortcuts you happen to own
- **Letters belong to the grid while a row is selected** (**v1.2.0**) — `g`, `j` and `k` no longer eat the first letter of a word, the query line shows the key that started it (`>`, `:`, `?`) with an **×** to clear
- **A key legend under the grid** (**v1.2.0**) — appears after the first keystroke, goes on `Enter`. **Config → Behavior → General**; on for new installs. *Show shortcut hints on toolbar icons* now starts **off**, for existing installs too
- **Undo a move** (**v1.2.0**) — one bookmark or a whole selection, including a cross-page bulk move; each bookmark returns to the category it actually came from, not all to one
- **Category icons and `Alt+←/→`** (**v1.2.0**) — right-click a category header for **Icon…** with a live preview in the heading; `Alt` with the arrows moves the category itself
- **Read the activity log in config** (**v1.1.1**) — **Data & backups → Server log → Show → Activity only**
- **Config → Bookmarks has two sub-tabs** (**v1.1.0**) — **List** and **Settings**; the settings used to sit under a list of fifty to five hundred rows
- **A filtered list is a link** (**v1.3.1**) — what you searched, the page, the category, the tag and the sort all ride in the address, so "the 41 untagged on Work" survives a reload and can be sent to someone. An empty list says which filter emptied it, a selection survives a filter change (the bar says how many are hidden by it), and bulk tags, pins and availability can be undone from the same toast delete uses
- **A long list stays quick** (**v1.3.1**) — the rows near the viewport are drawn and the rest are two spacers of the right height, so a library of two thousand costs about a thousand elements instead of sixty-seven thousand, with the scrollbar unchanged
- **Spread a category across columns** (**v1.1.0**) — a long category can run across several grid columns instead of towering over its neighbours, its bookmarks flowing across them. A switch, not a width: how many columns it takes follows from **items per category** and how many bookmarks it holds, so it grows and shrinks with the category and never exceeds the column count. Right-click the header, **Shift+W**, `:width`, or a ↔ button per row in **Config → Pages & tags → Categories**
- **Per-category sort** — sort by name, by when you last opened a bookmark, by when you added it, or by how often you open it. The sort in use sits in the category header as a single chip and the rest are behind a **⋯**; click the active chip again for manual order. Also `:sort` in the command palette
- **Tags on the rows** — off by default (**Config → Appearance → Display**); the first two show and the rest collapse into a count. Click one to filter the grid to it
- **Config → pages** and **config → categories** — drag or **↑/↓** to reorder; auto-save after ~600 ms with a localized sync toast; **Usage** column with popularity bar + bookmark count (Tags-style tier styling)
- **Config → tags** (desktop) — popularity-scaled word cloud (dashboard-style), structured list with usage bars, sorted by bookmark count; scrolls with the page; global rename/merge/delete; drill-down with **Open**; filter + clear; auto-save with undo; **↑/↓** moves focus between tag rows
- **Config → finders** (desktop) — filter list; drag or **↑/↓** reorder with auto-save; usage stats on tab open; stable ids + duplicate shortcut guard
- Long-press a bookmark row (~500 ms) to open inline edit — nearly opaque panel with the rest of the page dimmed behind it (the blur was dropped in **v1.3.2**: it gave each column its own compositing layer, and in Safari that layer swallowed clicks meant for the form); **Save** / **Ctrl+Enter** persists immediately on the dashboard; **Esc** cancels; edits and deletes from **smart-collection** rows sync to the category column and global bookmark store; page switches confirm before discarding unsaved edits; swipe and **Ctrl+V** paste are blocked while the editor is open
- Press and hold a category header (~500 ms, not on sort buttons) to rename it — double-click still works
- Double-click a page tab to rename it — also set an emoji icon and a colour dot per page
- Collapsible categories with optional always-collapsed default
- Tags on bookmarks with autocomplete; filter by tag in search and collections

### Config

- **Config is a view inside the dashboard** (`Shift + S`, `<`, the gear icon, or `/#config`) across eight sections; deep-link a section or sub-tab with `/#config/appearance/layout`. Most settings save the moment you change them
- **Find a setting** — `Ctrl/Cmd + Shift + K`, or **Find settings** below the section list. Since **v2026.09.07** every setting is indexed from the moment config opens rather than only the tabs you have already visited, and settings also match related words that are not in their label (*uptime*, *wallpaper*, *telemetry*, *hotkey*)
- **See what you have changed** (v2026.09.07) — **Overview → At a glance** says how many settings differ from their default and links to them; **Only changed** above each settings tab hides the rest; **Reset panel** puts a whole group back at once, beside the per-setting **↺**
- Most settings carry an **ℹ** explaining what they do and a **↺** to restore the default
- On a phone the section list is a single swipeable row rather than four wrapped rows (v2026.09.07)

### Inbox

- **Inbox** (`/#inbox`, `Shift + I`, or `:inbox`) — a holding area for links worth keeping before you know where they belong. Paste a URL on the dashboard and it lands here, becomes a bookmark, or asks you which, depending on **Config → Behavior → Inbox**; the browser extension saves here too, and a URL already in the inbox is turned away rather than duplicated. Items live in `data/inbox.json`
- Filter **All** / **Unread** / **Snoozed** / **With note**, filter by site, search, and sort newest, oldest, title or site — oldest-first is how a backlog actually clears, since the links you have been avoiding are at the bottom. Every filter carries its own count, and a sentence under the toolbar says what the active filter selects; the **ℹ** beside **Triage** explains what read and unread track, what snoozing hides, and what promoting leaves behind. Filter, sort, search and site all appear in the address bar, so any view can be bookmarked or shared
- **Snooze** a link (`z`: 3 hours, tomorrow, the weekend, next week, or a date of your own) and it is hidden until it wakes — left out of every count, tile and filter except **Snoozed**, so the numbers above the list always describe what is actually waiting for you. **Wake now** brings one back early
- **Promote** (`p`) opens the full bookmark form pre-filled, with every page and category available; the inbox entry goes once the bookmark is saved. **Triage** (`t`, or `:inbox triage`) walks the list one link at a time without the mouse: `j`/`k` move, `o` open, `p` promote, `r` keep, `d` delete, `Esc` close
- Tick rows to mark read, snooze or delete just those; **Mark all read** and **Clear read** act on the whole list, and **Clear read** leaves snoozed links alone. Export the filtered list as CSV or JSON. Long lists load further rows as you scroll
- **Every count follows the filter** (**v1.2.0**) — a search or a site filter narrows the tiles, the pills and the badge along with the list, **Mark all read** becomes **Mark shown read** while the view is narrowed, and the first tile is **Active**. A line under the list says how many links are asleep and when the first one wakes
- **Import** (**v1.2.0**) — beside the CSV and JSON exports; skips links already there and reports how many arrived, how many were already in and how many did not fit. A link can also go back to **unread**, and the page's own fetched description shows under the title
- The first visit runs a **one-time tour** — seven steps through the whole loop, from where links come from to how a backlog gets cleared. **Config → Help → Inbox** covers the same ground at any time, and **Show quick-start card again** under **Config → Behavior → General** brings the tour back
- Toggle under **Config → Behavior → Inbox → Enable Inbox**; unread items show a badge on the Inbox tab

### Smart collections

Dynamic bookmark groups that appear automatically:

- **Today** — bookmarks matching your work/evening/weekend keyword sets
- **Recently opened** — bookmarks you've opened lately
- **Most used** — your highest open-count bookmarks
- **Stale** — bookmarks you haven't visited in a while
- **Recently added** — what you have just saved, off by default with its own limit and choice of pages; every other collection keys on what you *open*, so this was the one question they could not answer
- **Fresh** (**v1.3.0**) — bookmarks whose page has published something since you last opened it. Turn it on under **Config → Behavior → Fresh**, a tab of its own: switching it on reads the head of every page you have saved, notes any RSS or Atom feed advertised there, polls what it found hourly with a conditional request, and puts a small count on the row. The tab says how many bookmarks were asked and how many publish a feed at all. Opening the bookmark clears it. Not a feed reader — no articles are stored, only how many entries are newer than your last visit
- **Tag collections** — one group per tag, shown when a tag has enough entries

Collections of your own take rules on category, tag, page, URL, name and status, plus **pinned**, **untagged**, **days since last opened** and **days since last changed** — so "my dev links I have not touched in 90 days" is something you can build rather than something only the built-in collections could do.

### Appearance

- 57+ built-in theme families, dark and light variants (including Terminal Amber, Dusk Horizon, Moss & Stone, Candy Pop, Midnight Ink, Bio Abyss, Sea Glass, and fifteen more added in v2026.07.26)
- **Random theme** — pick a different built-in theme on each page refresh or each view change (bookmarks ↔ config ↔ inbox ↔ health); auto dark mode limits the pool to matching variants (`Config → Appearance`)
- Custom theme editor (`config#colors`) — dark/light default palettes, **packaged themes** subtab (edit built-in families), custom theme list with **export/import** and **undo**; live preview on palette cards with contrast warnings; on mobile the editor is read-only (viewer mode)
- Auto dark mode — follows system light/dark without overwriting your saved theme palette id
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List, **Launcher** (large favicon tiles)
- **Show favicons** — toggle bookmark favicons in **Config → Appearance → Display** or with `:favicons on/off` on the dashboard
- Launcher layout preset — switch via **Config → Appearance → Layout** or `:layout launcher` in search; icon size configurable (small / normal / large)
- Button bar position: center-bottom (default), corner dock (bottom-left / bottom-right), or a vertical side rail on either edge (side-left / side-right) via Config or `:buttonbar`
- **Config → Appearance → Button bar** holds the whole bar since **v1.3.0**: the five positions and the two groups of toggles — **Button bar — main buttons** and **Button bar — extras** — each with **Show all** / **Hide all** and a count of what is showing. **Toolbar & tabs** keeps the **Header** group. Hiding a button leaves its keyboard shortcut working
- ★ What's New star button in the corner opposite the button bar — always visible; latest release loads first; scroll for up to **50 recent versions** (each loads on demand)
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Link preview cards — **on hover by default**, with **keyboard only** and **off** as the other two answers in **Config → Appearance → Display**; hover delay (Fast, Balanced or Calm — Calm by default) and a checklist of the rows the card draws
- Background image or gradient support
- Clickable date/time header showing a week-overview popover; optional calendar URL link

### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- **Health view** (`/#health`) — dashboard-first health triage with summary tiles, quick filters, search, sort, retest, row score breakdown, and keyboard-first navigation (`j`/`k`, `Tab`, `g`/`G`, `Home`/`End`, `s`, `p`, `f` to work through the list, `x`, `m`, `c`, `i`, `Enter`/`Space` to open, `R`/`?` to reload the cached report). Every row also shows **when you last opened it** (*just opened*, *yesterday*, *3d ago*, then a date) in a **right-aligned column** beside the domain. Share or deep-link a single row with `?hv_id=pageId:index`. The panel head shows **% healthy** and the active filter trail (`health › broken`) below the title, like Config subpages. Per-row overflow actions include **detect redirect**, **refresh title**, **archive**, and delete, reachable from the **More** button, `m`, or by **right-clicking the row** — which opens the same menu at the cursor. Edit opens the dashboard inline editor. Reach a row from the other direction with **Show in Health** in the dashboard right-click menu or the Config → Bookmarks row menu. Optional server-side background rechecks under Config → Behavior → Status & health. On the **Monitored** filter, **Export history** downloads the individual up/down checks behind an uptime percentage as CSV — one row per check with timestamp, ping time and HTTP status — where the ordinary **Export** gives the current state of each bookmark; that one also carries interval, uptime and response times when the list holds monitored rows. A sentence under the toolbar says what the active filter selects, the **ℹ** beside it explains how the score, the tiles and the uptime figures are arrived at, and the header names how old the cached report is. Legacy `/health` URLs redirect into this view. The header Health entry is always available.

- **Uptime monitoring** — set a bookmark to **Monitor** and it is checked on its own interval (5 minutes to 24 hours, default 15) with 30 days of history behind it, giving an uptime percentage over 24h / 7d / 30d, a heartbeat bar, a response-time sparkline, and an outage list with durations and causes. Open the whole picture at full size with **⤢** on the row or `i` — a large response-time chart with min/average/max, the three uptime windows side by side, interval, last check, and the complete outage list. Change a row's mode from the health view (`c`), the dashboard right-click menu, or `Shift + C`; a filtered list can be switched in bulk after confirming the count. A monitored bookmark shows its status on the dashboard like a periodic one, and **Config → Behavior → Status & health** decides how much it stands out: only when something is down (default), always with its own accent edge, or never. Optional downtime webhook under Config → Behavior → Status & health, alerting after N consecutive failures (default 3) and again on recovery. The same alerts can go to your **browser** instead, arriving while nextDash is closed — allow notifications once per device from the dashboard card or Config → Behavior → Status & health. That needs HTTPS: Safari and every browser on iPhone and iPad refuse notifications over `http://localhost`. The interval is changeable from the row itself once a bookmark is monitored, and an uptime percentage carries the number of checks behind it — *100%* from three checks is a weaker claim than *100%* from three hundred. History lives in `data/health-history.json`, pruned to 30 days and 2000 samples per URL.
- **Ten links, two minutes** (**v1.3.0**) — when enough links want attention, a card in the corner of the dashboard names what is waiting (*"10 links to review: 4 broken, 3 never opened, 3 not opened in a year"*) and runs the health view's **Work through** over the worst ten. The session ends: it counts what you dealt with, offers another ten, and **Done for today** puts the offer away until tomorrow
- **A failure says why** (**v1.2.0**) — DNS, timeout, refused, TLS, redirect or content, on the outage list, the timeline and the CSV export, where anything that was not an HTTP error used to show no cause at all. A failed check is re-probed five seconds later and only recorded if it fails again, so one dropped check no longer dents a month of uptime, and a recovery names how long the service was down
- **Honest windows and wider coverage** (**v1.2.0**) — a 30-day figure says how much history is actually behind it instead of labelling a week "30 days", certificate expiry now comes from every check rather than only from monitored bookmarks, the trend chart can draw broken, stale, unchecked or the score, a whole selection can be muted at once, and the three-second limit per check is a setting under **Config → Behavior → Status & health**
- **[`integrations/`](integrations/)** — a shell script, two Raycast commands, a Dropzone action, a Ulauncher extension, and Alfred and Apple Shortcuts recipes, all on top of the same one-line `/add` route
- **Save a link from anywhere** — install nextDash as an app and it appears in your phone's share sheet, saving straight to the Inbox; or use the bookmarklet **Config → Help → Inbox** generates for you, which works in Safari, Firefox and anything else the extension will never reach. Same route for scripts: `GET /add?url=…&title=…`. On an install with a write token, set `NEXTDASH_CAPTURE_TOKEN` and pass it — it opens capture and nothing else
- **Filter the page you are on** (`Shift + F`) — a slim bar above the grid narrows the rows in place and hides the categories left empty, keeping the layout, the cursor and any selection. Search (`>`) is still the overlay that takes you anywhere
- **`Shift + Alt + ←/→`** — move the selected bookmark into the category beside it, without a popover
- **A selection can be pinned and switched to Periodic or Monitor** in one action, and a bulk tag change can be undone for eight seconds
- **Come back to where you were on a page** — the scroll offset is kept per page, survives a trip through Health, Inbox or config and a reload; switch it off under **Config → Behavior → General**
- **A dashboard that arrives in one piece** — the 99 scripts and 42 stylesheets are served as two bundles, the Help tab's translations load with Help, the generated theme is inlined, and the three views' stylesheets arrive when a view is opened. First load: **169 requests and 915 KB → 30 requests and 685 KB**, same page, same files on disk (`NEXTDASH_BUNDLE=off` restores the individual tags)
- **The trend where it costs nothing** — the 90-day healthy line is a sparkline in the tile row, not a panel above the list; the tile, or the ▲/▼ in the header, opens the full chart with its series picker
- **Link rot, as its own subject** — every checked bookmark records how long it has been failing; a monitored check can spot a page that answers **200** while saying *not found*; the list can be read **grouped by site**, so one host down reads as one problem; a **Rot report** in the toolbar sums up what has gone, moved, been failing for over a month, or broke this week; a selection can **follow redirects** in one action after a domain move; and a dead link can be pointed at its **last Web Archive capture**, with the original address kept in the note
- **Uptime figures that cover what they claim** — each day is folded into a summary before its raw checks are dropped, kept for 90 days, so the 7-day and 30-day windows count the whole span instead of the week the per-URL cap left. Certificate warnings have a configurable lead time, and checks are spread one-at-a-time per host so twenty bookmarks on one domain do not arrive as twenty simultaneous requests
- **The list does not move under you** (**v1.2.1**) — opening a bookmark is what this view asks for, and it used to be punished: *never opened* and *not opened in 30 days* each cost 10 points, so the first open raised the row's score and, under the worst-first sort, sent it hundreds of rows down. Usage no longer costs score — it stays as the **Unused** and **Stale** tiles and filters — and nothing else in the sort key changes when you act on a row. Where a filter does stop selecting the row, opening one under **Unused** or fixing one under **Broken**, it keeps its position marked **handled** until you change the filter or reload the report
- **Work through the list** — filtering to Broken tells you what is wrong and then makes you find each row again after every fix. **Work through** in the toolbar, or `f`, puts one bookmark on screen at a time with its actions large: re-check (`p`), open (`Enter`), delete (`d`), skip (`j`), `k` to go back. It starts on the row under the cursor rather than the top, stops at either end instead of wrapping, and `Esc` leaves you on the row you reached
- **Say what "up" means for a page** — a site that answers 200 while showing *Database connection failed* is up by every ordinary measure. Press `c` on the row and choose **Expected response**, which opens a panel in the row itself: set **Text the page must contain** (or invert it to catch an error banner) and the **status codes** that count as healthy — `200`, `200-299`, `200,301,401`. Those failures get their own **Content** tile and filter, apart from Broken: a server that is down and a checkout button that vanished need different responses
- **Drift detection** — a bookmark can answer 200 forever while the page behind it stops being the page you saved. Opt in per bookmark and the next check records a baseline; every check after compares against *that*, so a page cannot drift past the alarm one small step at a time. Rows carry **Moved**, **Retitled** or **Changed**, and a rebrand that trips dozens at once is cleared in one go with **Accept drift** — which also drops the stale baselines, so the next check records the pages as they are now
- **Certificate expiry** — every monitored HTTPS check already completes a TLS handshake, so the expiry date costs nothing extra. Rows carry a badge with the days left and warnings go out at 30, 7 and 3 days. Certificates belong to a host, so ten bookmarks on one domain share one and a single renewal clears them all
- **Maintenance windows** — a service that restarts nightly is not broken. Set the days and times under **Config → Behavior → Status & health** and failures inside them raise no alert and do not count against uptime, while the checks still run and the heartbeat still records what happened. A window whose end precedes its start runs past midnight, which is when most maintenance happens
- **Alerts that fit the service** — pick **Slack**, **Discord**, **Telegram**, **Gotify**, **ntfy**, **Pushover** or raw JSON, each asking only for what it needs, and **Send test alert** confirms delivery before you rely on it. Silence a single bookmark with **Do not alert me about this bookmark** — it is still checked and still shown as down, carrying a **Muted** badge, and only the message is withheld. When one host takes everything behind it down at once, the alerts collapse into a single message rather than a dozen near-identical ones a second apart
- **The collection, not just the row** — the **Monitored** filter opens with the whole set at once: pooled uptime over 24h / 7d / 30d, how many monitors are responding now, the average response time, the least available monitors, anything measurably slower than the week before, and every recorded outage newest first. Uptime pools individual checks rather than averaging per-monitor percentages, so a monitor with three recorded checks cannot outweigh one with three thousand. The health view also draws the share of healthy bookmarks over time, beside the text explaining the active filter, on a fixed 0–100 scale — point at a day to read out its date and the share healthy on it, and days you did not open the dashboard leave a gap rather than a straight line through them. One point per day is kept for 90 days in `data/health-trend.json`
- Health badge on the dashboard and config headers: compact count-only pill (e.g. `3`) with theme accent colours for broken vs warnings; refreshes about once a minute while you stay on bookmarks or Inbox (Health keeps its own live refresh on the Monitored filter); screen readers get a full `aria-label`; bulk open broken links asks for confirmation with a per-batch limit
- Filter, sort, and search state in the health view persists across page refreshes (sessionStorage) and syncs to URL query parameters (`hv_filter`, `hv_sort`, `hv_q`, `hv_id` for a selected row)
- Favicon display and refresh from the health view (per row)
- **Find a setting by what it is set to** (**v1.3.0**) — `Ctrl/Cmd + Shift + K` matches the current value as well as the name (*8099*, *Monitor*), shows it after the location, and marks the settings that stay server-wide while *Keep settings on this device only* is on
- **Config → stats** (desktop) — insights block, finder usage, period filters with honest lifetime-open labels, **week-over-week** comparison on Activity when the week period is selected, **Refresh** / **Export CSV**, global table filter, row click opens bookmark editor, mobile chip-nav, formatted **Last backup** on overview; conflicts link to health
- **Statistics says what its figures mean** (**v1.3.1**) — the tab opens with the three things that follow from them: where your opening lands, what is going unread, and what is not answering, each with the button that acts on it, and nothing shown when there is nothing to report. Tiles carry the direction a count moved over the week, read from the daily points the health report has been recording all along, and the CSV export waits for the Health and Inbox tabs so it is not silently missing two of its five sections.

### Bookmarks

- Metadata auto-fetch (title, description, preview image) when adding a URL
- The preview card answers three questions in a fixed order: what the page is (favicon, title, one address, a status pill), what it says (image, description, your note, tags), and what you know about it (last check and ping, uptime, certificate expiry, Fresh count, opens and last opened, shortcut and location). Rows with nothing to say are left out, and none of it costs a request — the health figures come from the report the health icon already fetched
- Flash animation on bookmark open — subtle ripple confirms the action was registered
- Plain-text notes per bookmark — visible on the dashboard, in hover previews, and editable via command bar (`:note`), inline edit, or the config detail panel
- Open-count badge tracking usage per bookmark
- **Share** a bookmark from the right-click menu, or from a row's **More** menu in the health view — hands its name and URL to the system share sheet. Sharing needs a **secure context**, and **Safari on macOS refuses it over plain `http://`, `localhost` included**; use **HTTPS** (reverse proxy or Tailscale) for a real sheet. Chrome and Firefox on macOS/Linux have no Web Share at all. Where a sheet cannot open, the entry copies `name — URL`, says so, and re-labels itself **Copy name + URL**
- Pin bookmarks to keep them at the top of their category (no pin badge on dashboard rows; use `:pin` / inline edit)
- **A link you already have is found wherever it is** (**v1.3.0**) — saving a URL that is already on the *same* page is refused, and a copy on *another* page is a question instead: nextDash names the page and category it is already filed under, offers to open it, and **Save anyway** keeps the second copy. The add form, quick add and the extension all ask it the same way
- Import from browser HTML export (Chrome, Firefox, Edge) — folders become categories, duplicate URLs skipped; **missing icons are batch-fetched with a progress bar**
- Export all bookmarks to CSV (localized headers: Name, URL, Category, Page, Shortcut, Tags, Notes), and **import that CSV back** onto the current page — tidy hundreds of rows in a spreadsheet and return the result; unlike the browser-HTML import this route carries **tags and notes**
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
| Right-click a bookmark | Actions in one place: open in new tab, copy URL, **share**, edit, tags, move, availability checking, **select** / **select all in category**, delete (`Shift` + right-click gives the browser's own menu). Right-clicking a bookmark inside an open selection switches the menu to the whole selection, with the count named |
| Drag the left strip of a bookmark | Reorder within category or move to another category |
| Long press a bookmark row (~500 ms) | Open inline edit (save with **Save** or **Ctrl+Enter**) |
| Hover over a bookmark | Show the preview card (unless set to keyboard only or off in Config → Appearance → Display) |
| Long press a category header (~500 ms) | Rename the category (not on sort buttons; double-click still works) |
| `Shift + W` on a category | Spread it across columns, or put it back to one |
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

## License

MIT
