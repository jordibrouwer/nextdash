<p align="center">
  <img src="logo-ascii-on-black-large.png" alt="nextDash" width="720">
</p>

# nextDash

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

My bookmark bar had become a graveyard, so I built a self-hosted dashboard that tells me which links are already dead.

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard.

It is not only links. **Widgets** sit on the page among your categories and answer *what is going on* rather than *where do I go*: uptime per monitored service, a thirty-day trend, what is waiting in the inbox, which certificate is running out, how old the newest backup is. Thirteen of them read data nextDash already collects and need no setup at all, and a fourteenth — the **custom widget** — points at any address that answers with JSON, with **28 self-hosted services** already filled in, from Sonarr and Plex to Pi-hole, Proxmox and Home Assistant. A new install arrives with a Health widget already on the page.

Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

📖 **[Full user manual (MANUAL.md)](MANUAL.md)** — step-by-step guide for new users: concepts, keyboard workflow, config, import/backup, health, extension, and efficient daily use.

📋 **[Changelog (CHANGELOG.md)](CHANGELOG.md)** — complete release history (new / fix).

🗂️ **[Cheat sheet](nextDash-cheatsheet.pdf?raw=true)** — every keyboard shortcut, printable ([HTML](nextDash-cheatsheet.html?raw=true)); press **!** or **F1** on the dashboard for the live searchable list. Regenerate with `npm run generate:cheatsheet`.

🌐 **Official Website:** [nextdash.cc](https://nextdash.cc)

📰 **Developer Blog & Updates:** [jordibrw.cc](https://jordibrw.cc)

🧩 **Save a link from anywhere:** [`integrations/`](integrations/) holds a shell one-liner, two Raycast commands, a **Dropzone 5** action, a Ulauncher extension for Linux, and recipes for Alfred and Apple Shortcuts — every one of them a few lines on top of the same `GET /add` route, so anything that can open a URL or run `curl` can save to your **Inbox**. The [Dropzone 5 script](https://github.com/jordibrouwer/dropzone-script-for-nextdash-on-macos) also has a repository of its own.

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

Protected actions include: **reset all data** (also requires `{"confirm":true}`), **download or import backup**, **list, download, run, restore or delete an automatic backup**, **delete page**, **bookmark preview fetch**, **bookmark ping** (`/api/ping`), **health delete / retest / merge / auto-heal / open-broken / cache-scan / update-status**, **clear or refresh all bookmark previews**, **bookmark/page/category/finder/settings saves**, **uploads** (favicon, font, icon), and **reset theme colours**.

When the token is **not** set, behaviour is unchanged — everything stays open for local dev. When it **is** set, the dashboard injects the token automatically so normal browser use is unaffected. The browser extension can store the same write token in **Settings → Write token**.

Outbound fetches (preview, ping, icons, auto-heal, the health view's check-a-URL) use dial-time IP validation to block DNS-rebinding to private networks unless **allow localhost bookmarks** is enabled in settings, and each is rate-limited (`NEXTDASH_SSRF_API_RATE_PER_MIN`).

**The data directory is not served** (**v1.3.3**). `/data/` publishes `data/icons/` and an uploaded favicon or font, and nothing else — `settings.json`, the bookmark files, `inbox.json`, `trash.json`, the monitoring history and the automatic backup ZIPs are reachable only through the APIs above, which the write token guards. Icons are content-named and never reused, so they are served `immutable`. Bookmarks put into the **trash** are validated on the way in — URL scheme, private addresses, icon path — because a restore puts them straight back on their page.

### Optional CORS allowlist (LAN / VPS / extension)

By default, only an installed browser extension's origin (`chrome-extension://…`, `moz-extension://…`, `safari-web-extension://…`) receives `Access-Control-Allow-Origin`. A web page on another origin gets no CORS header and cannot read the API.

Before 1.4 the default was `Access-Control-Allow-Origin: *`, which meant any site open in a tab could read your bookmarks from a nextDash whose address it could guess — the read routes need no token. The extension is unaffected by the change: a Manifest V3 extension with host permissions is granted cross-origin access by the browser itself, without CORS.

Set `NEXTDASH_CORS_ORIGINS` to a comma-separated allowlist when you want to restrict cross-origin reads/writes, for example:

```bash
NEXTDASH_CORS_ORIGINS=https://dash.example.com,chrome-extension://your-extension-id
```

Only matching `Origin` headers receive `Access-Control-Allow-Origin` in the response; extension origins are always allowed. Set `NEXTDASH_CORS_ORIGINS=*` to restore the pre-1.4 behaviour of answering every origin.

### Activity log (bookmark events)

A machine-readable trail of what happened, kept apart from the readable log. Bookmark changes and status checks are recorded by default; opens and the eight channels added in **v1.4.2** are off unless asked for.

Since **v1.4.2** the channels are also chosen in the app, under **Config → Data & backups → Server log → Activity trail**. The environment variables below keep working and mean the same thing; a choice made in the app wins over them.

```bash
# Default: mutate + status (opens off)
NEXTDASH_ACTIVITY_LOG=mutate,status,open   # include opens
NEXTDASH_ACTIVITY_LOG=off                  # disable all activity logs

# The channels added in v1.4.2, all off unless named
NEXTDASH_ACTIVITY_LOG=mutate,status,health,sources,feeds,archive,backup,store,widgets,notify

# Automatic backups: how many are kept, and where they live
NEXTDASH_AUTO_BACKUP_KEEP=3                        # 1–50; default 3
NEXTDASH_AUTO_BACKUP_DIR=/mnt/backups/nextdash     # absolute path; default data/auto-backups

# Optional rotating file under the data directory
NEXTDASH_ACTIVITY_LOG_PERSIST=1
NEXTDASH_ACTIVITY_LOG_FILE=/path/to/activity.log   # optional; default data/activity.log

# Optional security events (auth denied, rate limits)
NEXTDASH_ACTIVITY_LOG=mutate,status,security
```

Example trail line, as written to `activity.log` and to the in-app buffer:

```text
{"ts":"2026-07-03T12:00:00Z","event":"bookmark.add","pageId":1,"name":"GitHub","url":"https://github.com","source":"dashboard"}
```

The container log gets a sentence for the same event instead of the JSON (**v1.4.2**) — `INFO mutate added "GitHub" (https://github.com)`. With twelve channels available, printing the JSON between the readable lines would have made `docker logs` unreadable.

To read the trail without shell access, open **Config → Data & backups → Server log** and set **Show** to **Activity only**. It needs **Collect server log** switched on, because it is the same buffer.

Status pings are deduplicated for the same URL + result for 10 minutes unless `refresh=1` is passed to `/api/ping`. URLs appear in logs — treat log files as sensitive on shared hosts.

### Outgoing endpoints (webhooks, MCP)

Both are **off until you configure them**, and both are described in full under
[Integrations](#outgoing-telling-other-programs-what-happened).

The **MCP endpoint** answers questions about every bookmark in the install, so
`POST /mcp` returns `404` until *Answer assistants at this address* is ticked
under **Config → Data & backups → Webhooks**. When it is on, every request's
`Origin` is checked against the host it arrived on: a browser will POST to
`localhost` from any page on the internet, and a local server that answers those
is one visited page away from being read. A client that is not a browser sends no
`Origin` at all, which is the normal case and passes.

**Webhook** endpoint URLs go through the same address rules as a bookmark ping —
a local receiver is reachable only on an install that has allowed local
addresses — and they are checked twice: when you save the endpoint, so the screen
can refuse it while you are looking at the field, and again at delivery, because
a name is resolved again then. Redirects are not followed. The signing keys live
in `webhooks.json` at `0600`; reading the endpoint list needs the write token,
since an endpoint URL is not a description of a webhook, it *is* the webhook.

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

Separately from analytics, the config overview shows the latest posts from **nextdash.cc**. That feed is fetched by your server, not your browser: one request every six hours for the whole install, carrying no query, no identifier and nothing about you. **Behavior → Privacy → Show posts from nextdash.cc** switches it off, and off means the request is never made.

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
| `NEXTDASH_CORS_ORIGINS` | *(unset)* | Extra `Origin` allowlist for API CORS, comma-separated. Extension origins always allowed; `*` answers everyone |
| `NEXTDASH_LOG_LEVEL` | `info` | How much the server writes: `error`, `warn`, `info`, `debug`. Overridden by **Detail level** in the app when set |
| `NEXTDASH_ACTIVITY_LOG` | `mutate,status` | `off`, `mutate`, `status`, `open`, `security`, `health`, `sources`, `feeds`, `archive`, `backup`, `store`, `widgets`, `notify` (comma-separated). Overridden by **Activity trail** in the app when set |
| `NEXTDASH_ACTIVITY_LOG_PERSIST` | off | `1` = rotate `activity.log` under data dir |
| `NEXTDASH_ACTIVITY_LOG_FILE` | `data/activity.log` | Custom activity log path |
| `NEXTDASH_OUTBOUND_REQUESTS_PER_MIN` | `120` | Rate limit for server outbound fetches |
| `NEXTDASH_SSRF_API_RATE_PER_MIN` | `60` | Rate limit for preview/ping/icon APIs |
| `NEXTDASH_CSP` | on | Set `off` to disable Content-Security-Policy headers |
| `NEXTDASH_DISABLE_PREFETCH` | off | `1` = skip background favicon prefetch on startup |

---

## Screenshots
<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-6.png" alt="Dashboard with combined columns" width="100%" />
      <br />
      <sub><b>Dashboard</b> with combined columns.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-7.png" alt="Widget settings" width="100%" />
      <br />
      <sub><b>Widget</b> settings.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-8.png" alt="Dashboard with widgets" width="100%" />
      <br />
      <sub><b>Dashboard</b>  with widgets.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-9.png" alt="Widget settings" width="100%" />
      <br />
      <sub><b>Widgets</b> settings.</sub>
    </td>
  </tr>
</table>

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
- `:config [section]` — open a config section in place (`overview`, `bookmarks`, `appearance`, `pages-tags`, `behavior`, `data-backups`, `widgets`, `stats`, `help`, `about`). Names that used to be sections and are now sub-tabs — `categories`, `tags`, `finders`, `pages`, `backups`, `themes` — still work and land on their tab
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

**Where things live** — config is a view inside the dashboard at `/#config`, opened with **`Shift+S`**, **`<`**, or the header link, and closed with **`Escape`**. Reopening it within **5 minutes** restores the **last section and sub-tab** you were on, whichever way you left — including the header buttons that switch view around it; after that it starts on **Overview** again. A deep link like `/#config/behavior/privacy` still wins. It has ten sections: **Overview**, **Pages & tags**, **Bookmarks**, **Appearance**, **Behavior**, **Data & backups**, **Widgets**, **Statistics**, **Help**, and **About**. Sections with sub-tabs are addressable too — `/#config/behavior/privacy` opens Behavior on Privacy — so a link to any setting can be shared.

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

- **Your browser's address bar is a nextDash search box** (**v1.4.0**) — type the keyword, `Tab`, a term, `Enter`, and you land in your bookmarks with the results on screen. No extension and no dashboard to open first. Your browser offers it after one visit; give it a short keyword in the browser's own settings. A search now has an address of its own (`#search?q=…`), so one can be bookmarked or shared like any other view
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
- **The server log says what it is doing** (**v1.4.2**) — every line names how serious it is and which part of nextDash it came from, in a sentence written for someone running it rather than reading its source: *checked 110 bookmarks, 2 failed*, or *dash.example could not be saved*. Whole parts of the server that used to pass in silence now say what they did — a check round, a feed poll, an import, a saved copy, a scheduled backup, a write to disk that did not work. **Detail level** decides how much is written, here and in `docker logs` alike (*Quiet*, *Normal*, *Verbose*), and takes effect on the very next line with no restart; **Activity trail** beside it picks which twelve things are recorded in machine-readable form, with **Reset panel** restoring the default pair
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

### Where bookmarks come from

- **A Sources tab** (**v1.4.0**) — **Config → Data & backups → Sources**, for the services that keep sending bookmarks, as opposed to the import buttons that read a file once. Each source remembers what it already brought in, where its bookmarks land, and what the last round did, and previews what it would write before writing it
- **Five services** (**v1.4.0**) — **GitHub stars** and **Raindrop.io** need a token; **Hacker News**, **YouTube** and **Mastodon** need nothing at all, since all three publish public XML at a predictable address. Type a username or a channel and that is the whole setup
- **The browser bookmark file, in and out** (**v1.4.0**) — the thirty-year-old format every browser exports, and that Pocket, Pinboard, Raindrop, linkding, Shiori, Linkwarden and Karakeep all speak. Folders become categories, and tags, notes and the date you saved a link survive the trip. **Export bookmarks (HTML)** hands the collection back in the same format, readable by any browser
- Import also reads **CSV** and **JSON**, and — since **v1.4.0** — the CSV route keeps the tags and notes it always claimed to

### Keeping a copy of a page

- **Ask the Web Archive to keep a copy the day you save a link** (**v1.4.0**) — everything else in the health view is diagnosis: it tells you a link is dead and offers whatever copy somebody else happened to take, which for a page nobody else bookmarked is usually none. Switch it on under **Config → Data & backups → Sources**, with an archive.org key pair and a one-page test capture to prove them
- **Local copies on your own disk** (**v1.4.0**) — a whole page, text, styling and images, saved as one file in your data directory through [monolith](https://github.com/Y2Z/monolith), so it stays readable when the site and the Web Archive are both gone. **Config → Bookmarks → Local copies** lists what you have, grouped by the bookmark it belongs to, and since **v1.4.2** a button clears them all at once, after asking and saying how many and how much space it frees
- **A copy says why it failed, and when it is blank** (**v1.4.2**) — a capture that cannot be made now names the reason instead of an exit status, pages up to **52 MB** can be saved where the ceiling was 32 MB, and a page that saved as an empty shell — one that builds itself in the browser — says so rather than leaving you to find out on opening it
- **archive.today** (**v1.4.0**) — the two archives disagree by design. The Web Archive honours a site that turns it away and drops what a site later withdraws; archive.today keeps what it captured. For a link that died behind a paywall, *no copy* from the first is routinely not *no copy*
- **The date the web lost a page** (**v1.4.0**) — reading the archive's own index rather than asking for the capture nearest to now, which for a dead link is usually a copy of the error page

### Config

- **The overview is a news stream** (**v1.3.3**) — posts from nextdash.cc, releases, and the settings each release introduced, in one dated list with the newest first, every row labelled with its source and opening on its own. Source chips narrow it to one kind or hide the site's posts entirely. Ten of the fourteen rows are kept for the site's own posts (**v1.4.1.1**, two of six before that), so a day of releases does not push them off the page, and the settings shown are those from the two most recent releases that introduced one (**v1.3.3.2**). A green dot and a count on **Overview** in the rail mark anything published since you last read it; *All news & features* opens the full list under **About**, with the older settings catalogue and a button that saves nextdash.cc as a bookmark so **Fresh** counts its posts. Beside the stream: **About the developer** level with the top of the list, and under a *Your install* line the figures — **At a glance** and what differs from the defaults — which you look up rather than meet on the way in, and which is what puts the stream above the fold. It replaced a carousel that showed one of forty-nine features at a time and a *Latest update* panel repeating the release named directly above it.
- **The site feed is fetched by your server** (**v1.3.3**, `/api/site-news`) and held for **90 minutes** (**v1.3.3.1**, six hours before that — long enough that a release could ship and the overview would go on saying nothing had), with conditional requests and a mirror in the data directory so a nightly reboot does not fetch again. Your browser refetches after 30 minutes rather than keeping what it had for the whole session; the two windows are deliberately out of step. The page never contacts another host and nothing about you goes out with it. **Behavior → Privacy → Show posts from nextdash.cc** switches it off — the request is then never made — and `DISABLE_NEWS_FEED=true` does the same for a whole server.
- **A command with an argument can be typed** (**v1.3.3.1**) — `:buttons cheatsheet` and its like lost letters to the grid's own shortcuts on the way into the palette, and a space ran the highlighted row instead of separating two words. A category's **⋯** sort menu also opens with `ArrowDown`, which it had advertised all along
- **Where you were on a page is used once** (**v1.3.3.1**) — the offset was restored on every later visit to that page rather than only on the return it was recorded for
- **Release notes open the moment a new version does** (**v1.3.3.1**) — once, and never again for that release. They used to wait for the dashboard to settle, which read as being interrupted rather than told.
- **About has two tabs** (**v1.3.3**) — the colophon, and **News & features**: the whole stream with its source filters, every setting worth switching on including the ones from earlier releases, and a button that saves nextdash.cc as a bookmark so **Fresh** counts its posts.
- **Config is a view inside the dashboard** (`Shift + S`, `<`, the gear icon, or `/#config`) across eight sections; deep-link a section or sub-tab with `/#config/appearance/layout`. Most settings save the moment you change them
- **Find a setting** — `Ctrl/Cmd + Shift + K`, or **Find settings** below the section list. Since **v2026.09.07** every setting is indexed from the moment config opens rather than only the tabs you have already visited, and settings also match related words that are not in their label (*uptime*, *wallpaper*, *telemetry*, *hotkey*)
- **See what you have changed** (v2026.09.07) — **Overview → At a glance** says how many settings differ from their default and links to them; **Only changed** above each settings tab hides the rest; **Reset panel** puts a whole group back at once, beside the per-setting **↺**
- Most settings carry an **ℹ** explaining what they do and a **↺** to restore the default
- On a phone the section list is a single swipeable row rather than four wrapped rows (v2026.09.07)

- **Panels fold shut** (**v1.4.0**) — **Sources** and **Backups & data** stacked every panel open, which is a wall to scroll past before reaching the one you came for. They open on a click and remember they were open
- **The slow actions show progress** (**v1.4.0**) — refreshing every link preview is one request per bookmark, well over a minute for a real collection, and it used to sit there looking hung
- **Widgets is a section of its own** (**v1.4.0**) — in the rail under **Data & backups**, with a short description of what each type does
- **A backup carries your whole data directory** (**v1.4.0**) — files had been left out one at a time, each for a reason that held alone, until together they made a restore an install that had lost its history and had to earn it back over weeks: the uptime chart alone needs thirty days before the window it claims is real. Two switches under **What a backup carries** decide whether saved pages and stored tokens travel with it — the first is by far the largest thing in a backup, the second makes a restore need nothing typed in again and makes the backup file itself a secret
### Inbox

- **Inbox** (`/#inbox`, `Shift + I`, or `:inbox`) — a holding area for links worth keeping before you know where they belong. Paste a URL on the dashboard and it lands here, becomes a bookmark, or asks you which, depending on **Config → Behavior → Inbox**; the browser extension saves here too, and a URL already in the inbox is turned away rather than duplicated. Items live in `data/inbox.json`
- Filter **All** / **Unread** / **Snoozed** / **With note**, filter by site, search, and sort newest, oldest, title or site — oldest-first is how a backlog actually clears, since the links you have been avoiding are at the bottom. Every filter carries its own count, and a sentence under the toolbar says what the active filter selects; the **ℹ** beside **Triage** explains what read and unread track, what snoozing hides, and what promoting leaves behind. Filter, sort, search and site all appear in the address bar, so any view can be bookmarked or shared
- **Snooze** a link (`z`: 3 hours, tomorrow, the weekend, next week, or a date of your own) and it is hidden until it wakes — left out of every count, tile and filter except **Snoozed**, so the numbers above the list always describe what is actually waiting for you. **Wake now** brings one back early
- **Promote** (`p`) opens the full bookmark form pre-filled, with every page and category available; the inbox entry goes once the bookmark is saved. **Triage** (`t`, or `:inbox triage`) walks the list one link at a time without the mouse: `j`/`k` move, `o` open, `p` promote, `r` keep, `d` delete, `Esc` close
- **The paste dialog is styled on the dashboard** (**v1.3.3.5**) — pasting a URL opens *Save this link*, and it drew as plain unstyled text: the address printed over the question, and **Add bookmark** and **Save to Inbox** collapsed onto one line with their `1` and `2` stranded below. Its thirteen rules shipped in the stylesheet that loads with Inbox, Health or Config, none of which is open when you paste on the dashboard, so on a fresh load not one of them had arrived.
- Tick rows to mark read, snooze or delete just those; **Mark all read** and **Clear read** act on the whole list, and **Clear read** leaves snoozed links alone. Export the filtered list as CSV or JSON. Long lists load further rows as you scroll
- **Every count follows the filter** (**v1.2.0**) — a search or a site filter narrows the tiles, the pills and the badge along with the list, **Mark all read** becomes **Mark shown read** while the view is narrowed, and the first tile is **Active**. A line under the list says how many links are asleep and when the first one wakes
- **Import** (**v1.2.0**) — beside the CSV and JSON exports; skips links already there and reports how many arrived, how many were already in and how many did not fit. A link can also go back to **unread**, and the page's own fetched description shows under the title
- The first visit runs a **one-time tour** — seven steps through the whole loop, from where links come from to how a backlog gets cleared. **Config → Help → Inbox** covers the same ground at any time, and **Show quick-start card again** under **Config → Behavior → General** brings the tour back
- Toggle under **Config → Behavior → Inbox → Enable Inbox**; unread items show a badge on the Inbox tab

### Widgets

A dashboard of links can only answer *where do I go*. Widgets answer *what is
going on* — and they work off data nextDash already collects, so most of them
need nothing configured beyond being added. A **new install ships with a Health
widget already on the page**, so the feature is visible rather than something
you have to go and find.

- **A block on a page can hold something other than links** (**v1.4.0**) — a widget is drawn among the categories, dragged into place like one, and can be one or two columns wide. Add, name and arrange them under **Config → Widgets**; the block order is the same list that orders categories, so there is one answer to where anything sits
- **A widget is renamed, resized and closed from its own header** (**v1.4.2**) — right-click a widget title for rename, one column or two, fold, its settings, and close. Renaming writes the name **Config → Widgets** shows, and closing is *disable it there* rather than a delete, so the widget and its settings survive being put away
- **The keyboard goes into a widget instead of around it** (**v1.4.2**) — arrow keys step inside and move through its rows the way they move through a category's, **Enter** opens the row under the cursor, and every action in the right-click menu has a key of its own. Widgets had been the one block on the page the keyboard skipped
- **A widget folds away like a category** (**v1.4.1.2**) — click its title to fold it shut, or **Enter**/**Space** with it focused; the same gesture on the same header categories have always had, so a page of open summaries no longer pushes the block you want below the fold. **Fold all** and the `.` key take widgets with them, and each block stays as you left it
- **Thirteen types, each reading something nextDash already keeps** (**v1.4.0**) — no configuration beyond adding the tile, because the data is already there. **Health** and **Uptime** report what the health view reports, worst first, with a heartbeat per monitored link; **Trend** draws the last thirty days; **Inbox** says what is waiting; **Neglected** surfaces what you saved and never opened; **Unchecked** and **Duplicates** name what the collection has quietly accumulated; **Trash** counts what is still recoverable and **Backups** how old the newest one is; **Archive** says how much has a copy kept locally; and **Sources**, **Feeds** and **Certificates** show the three things that were previously visible only by going looking — a failed import, a feed gone quiet, a certificate running out
- **A custom widget, with 28 services already filled in** (**v1.4.0**) — the fourteenth type points at any address that answers with JSON, so a service nextDash has never heard of needs no code. Pick a **preset** and the address shape, the fields and the labels arrive already written; the list covers **Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Overseerr / Jellyseerr, Tautulli, Jellyfin / Emby, Plex, Immich, qBittorrent, SABnzbd and NZBGet** for media, **Pi-hole (v5 and v6), AdGuard Home, Traefik and Speedtest Tracker** for the network, **Proxmox VE, TrueNAS, Glances and Syncthing** for the machine, and **Nextcloud, Paperless-ngx, Home Assistant, Grafana and ntfy** alongside. Nothing is hard-coded per service — a preset is a starting point you can edit, and writing your own from scratch is the same form with the fields left blank
- **A custom widget keeps itself up to date** (**v1.4.2.1**) — the one tile that reads a service of your own, and reloading the page used to be the only way to see a newer figure, so a dashboard left open all day showed the download speed it found at breakfast. Each custom tile now refreshes on its own **How long an answer keeps** interval — 60 seconds for a speed, five minutes for a queue, an hour for something measured hourly — and the presets already carry a sensible figure per service, so there is nothing to set. Nothing is asked while the tab is in the background, so a dashboard on a second monitor does not spend the day questioning your own machines
- **Ask a custom tile again, now** (**v1.4.2.2**) — right-click its title for **Refresh now**. When a service turns nextDash away the answer is held for half a minute, so a service that is down is not asked again by every open dashboard — right until you have just fixed the reason it was failing, and then it is thirty seconds of watching an error you have already dealt with. The interval field also says what it takes now (30 seconds to 24 hours, empty means five minutes) with an **ℹ** explaining how to choose, and a number outside that range is brought into it instead of being dropped
- **The custom widget's request is made by the server, not your browser** (**v1.4.0**) — the address and any API key stay on the machine running nextDash, which is what lets a tile read a service that is not reachable from the browser at all, and keeps the key out of a page anyone can view source on. It inherits the same SSRF checks and rate limiting as every other outbound request
- **Settings per widget** (**v1.4.0**) — which page it counts, how many rows it shows, what it is called, how wide it is. A tile that leaves rows out says how many, so five of twelve does not look like five of five
- **A figure opens the rows behind it** (**v1.4.0**) — clicking a count on a health tile lands in the health view with that filter already applied

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

- **A theme browser, not a list** (**v1.4.0**) — 214 themes used to arrive as a listbox of 214 alphabetically sorted lines, which puts a theme twenty positions from its own other half, shows nothing of what any of them look like, and cannot be searched. It is a grid of cards now: one per family with a light/dark switch on it, so 214 becomes 107, with a search box, segments for **all** / **favourites** / **light** / **dark**, and a star per family. The live preview on the real dashboard is unchanged — move through the grid and the page follows, leave without choosing and your theme comes back
- **Every theme has its own accent** (**v1.4.0**) — the accent was the *success* colour, because there had only ever been one, so every install accented green or teal whatever the theme was called: *this link answers* and *this is a Mulberry Silk install* were the same value. All 214 variants carry their own now. A custom theme written before this keeps accenting in its success colour rather than losing its accent
- **Depth, in three settings** (**v1.4.0**) — a theme declares thirteen colours of which two are surfaces, and two surfaces cannot express depth: a card, a panel and a control were painted the same and only a border said where one stopped. A second layer is derived from what a theme already declares — a tint in its greys, a ladder of surfaces, a sheen on a card — under **Config → Appearance**: **flat**, **soft** or **rich**. *Flat* is the dashboard exactly as it was, so preferring the old look is one control rather than not upgrading
- **The page is no longer one flat rectangle** (**v1.4.0**) — two large, soft washes of light behind it, in the theme's own accent and warning hues at 7% and 5% scaled by the depth setting. A single hue reads as a mistake; two related hues read as light. A background image of your own switches it off, because a background you chose was chosen instead of this rather than on top of it
- **Backdrops beyond dots** (**v1.4.0**) — dots, grid, lines, hatch or none. Left on **auto** the theme decides: most ask for dots, and the handful whose texture is part of what they are ask for something else
- **107 built-in theme families, 214 variants** — thirty-three families added in **v1.4.0** (Rosé Pine, City Lights, Tomorrow Dusk, Cobalt Ink, Iceberg Drift, Owl Hours, Polar Night, Zen Ember, Great Wave, Bamboo Panda, Synth Sunset and twenty-two more), on top of Terminal Amber, Dusk Horizon, Moss & Stone, Candy Pop, Midnight Ink, Bio Abyss, Sea Glass and the rest
- **Random theme** — pick a different built-in theme on each page refresh or each view change (bookmarks ↔ config ↔ inbox ↔ health); auto dark mode limits the pool to matching variants (`Config → Appearance`)
- Custom theme editor (`config#colors`) — dark/light default palettes, **packaged themes** subtab (edit built-in families), custom theme list with **export/import** and **undo**; live preview on palette cards with contrast warnings; on mobile the editor is read-only (viewer mode)
- Auto dark mode — follows system light/dark without overwriting your saved theme palette id
- Layout presets: Default, Compact, Cards, Terminal-ish, Masonry, Detailed List, **Launcher** (large favicon tiles)
- **Show favicons** — toggle bookmark favicons in **Config → Appearance → Display** or with `:favicons on/off` on the dashboard
- Launcher layout preset — switch via **Config → Appearance → Layout** or `:layout launcher` in search; icon size configurable (small / normal / large)
- Button bar position: center-bottom (default), corner dock (bottom-left / bottom-right), or a vertical side rail on either edge (side-left / side-right) via Config or `:buttonbar`
- **Config → Appearance → Button bar** holds the whole bar since **v1.3.0**: the five positions and the two groups of toggles — **Button bar — main buttons** and **Button bar — extras** — each with **Show all** / **Hide all** and a count of what is showing. **Toolbar & tabs** keeps the **Header** group. Hiding a button leaves its keyboard shortcut working
- **A new version shows its release notes once**, on the first visit after the upgrade; closing them marks that release read. A brand-new install is left alone — quick start comes first.
- ★ What's New star button in the corner opposite the button bar
- Font presets: Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, System UI
- Adjustable columns (1–6), font size, font weight, background opacity, and density
- Link preview cards — **on hover by default**, with **keyboard only** and **off** as the other two answers in **Config → Appearance → Display**; hover delay (Fast, Balanced or Calm — Calm by default) and a checklist of the rows the card draws
- Background image or gradient support
- Clickable date/time header showing a week-overview popover; optional calendar URL link

- **A new install starts with the button bar in the bottom-right corner** (**v1.4.0**) — it began centred above the bookmarks, floating over the thing you open the dashboard to look at. If you have ever chosen a position, yours is untouched
- **What's new opens on the release** (**v1.4.0**) — the version is the headline, the summary its subtitle, and everything older is one line each that opens when you ask. A third of the window used to go to an update notice, a boxed summary and a request for support before the first word
### Monitoring & health

- Real-time online/offline status with ping timings per bookmark
- **Health view** (`/#health`) — dashboard-first health triage with summary tiles, quick filters, search, sort, retest, row score breakdown, and keyboard-first navigation (`j`/`k`, `Tab`, `g`/`G`, `Home`/`End`, `s`, `p`, `f` to work through the list, `x`, `m`, `c`, `i`, `Enter`/`Space` to open, `R`/`?` to reload the cached report). Every row also shows **when you last opened it** (*just opened*, *yesterday*, *3d ago*, then a date) in a **right-aligned column** beside the domain. Share or deep-link a single row with `?hv_id=pageId:index`. The panel head shows **% healthy** and the active filter trail (`health › broken`) below the title, like Config subpages. Per-row overflow actions include **detect redirect**, **refresh title**, **archive**, and delete, reachable from the **More** button, `m`, or by **right-clicking the row** — which opens the same menu at the cursor. Edit opens the dashboard inline editor. Reach a row from the other direction with **Show in Health** in the dashboard right-click menu or the Config → Bookmarks row menu. Every summary tile narrows the list, **Certificates** included (**v1.3.3.3**) — the count is hosts, the list is the bookmarks on them. On **Missing preview**, **Fetch previews** asks each page for its title, description and image: re-checking only asks whether a link answers, so it could never shorten that list. Optional server-side background rechecks under Config → Behavior → Status & health. On the **Monitored** filter, **Export history** downloads the individual up/down checks behind an uptime percentage as CSV — one row per check with timestamp, ping time and HTTP status — where the ordinary **Export** gives the current state of each bookmark; that one also carries interval, uptime and response times when the list holds monitored rows. A sentence under the toolbar says what the active filter selects, the **ℹ** beside it explains how the score, the tiles and the uptime figures are arrived at, and the header names how old the cached report is. Legacy `/health` URLs redirect into this view. The header Health entry is always available.

- **Uptime monitoring** — set a bookmark to **Monitor** and it is checked on its own interval (5 minutes to 24 hours, default 15) with 30 days of history behind it, giving an uptime percentage over 24h / 7d / 30d, a heartbeat bar, a response-time sparkline, and an outage list with durations and causes. Open the whole picture at full size with **⤢** on the row or `i` — a large response-time chart with min/average/max, the three uptime windows side by side, interval, last check, and the complete outage list. Change a row's mode from the health view (`c`), the dashboard right-click menu, or `Shift + C`; a filtered list can be switched in bulk after confirming the count. A monitored bookmark shows its status on the dashboard like a periodic one, and **Config → Behavior → Status & health** decides how much it stands out: only when something is down (default), always with its own accent edge, or never. Optional downtime webhook under Config → Behavior → Status & health, alerting after N consecutive failures (default 3) and again on recovery. The same alerts can go to your **browser** instead, arriving while nextDash is closed — allow notifications once per device from the dashboard card or Config → Behavior → Status & health. That needs HTTPS: Safari and every browser on iPhone and iPad refuse notifications over `http://localhost`. The interval is changeable from the row itself once a bookmark is monitored, and an uptime percentage carries the number of checks behind it — *100%* from three checks is a weaker claim than *100%* from three hundred. History lives in `data/health-history.json`, pruned to 30 days and 2000 samples per URL.
- **Ten links, two minutes** (**v1.3.0**) — when enough links want attention, a card in the corner of the dashboard names what is waiting (*"10 links to review: 4 broken, 3 never opened, 3 not opened in a year"*) and runs the health view's **Work through** over the worst ten. The session ends: it counts what you dealt with, offers another ten, and **Done for today** puts the offer away until tomorrow
- **A failure says why** (**v1.2.0**) — DNS, timeout, refused, TLS, redirect or content, on the outage list, the timeline and the CSV export, where anything that was not an HTTP error used to show no cause at all. A failed check is re-probed five seconds later and only recorded if it fails again, so one dropped check no longer dents a month of uptime, and a recovery names how long the service was down
- **Honest windows and wider coverage** (**v1.2.0**) — a 30-day figure says how much history is actually behind it instead of labelling a week "30 days", certificate expiry now comes from every check rather than only from monitored bookmarks, the trend chart can draw broken, stale, unchecked or the score, a whole selection can be muted at once, and the three-second limit per check is a setting under **Config → Behavior → Status & health**
- **[`integrations/`](integrations/)** — a shell script, two Raycast commands, a Dropzone action, a Ulauncher extension, and Alfred and Apple Shortcuts recipes, all on top of the same one-line `/add` route ([Integrations](#integrations))
- **Save a link from anywhere** — install nextDash as an app and it appears in your phone's share sheet, saving straight to the Inbox; or use the bookmarklet **Config → Help → Inbox** generates for you, which works in Safari, Firefox and anything else the extension will never reach. Same route for scripts: `GET /add?url=…&title=…`. On an install with a write token, set `NEXTDASH_CAPTURE_TOKEN` and pass it — it opens capture and nothing else
- **Filter the page you are on** (`Shift + F`) — a slim bar above the grid narrows the rows in place and hides the categories left empty, keeping the layout, the cursor and any selection. Search (`>`) is still the overlay that takes you anywhere
- **`Shift + Alt + ←/→`** — move the selected bookmark into the category beside it, without a popover
- **A selection can be pinned and switched to Periodic or Monitor** in one action, and a bulk tag change can be undone for eight seconds
- **Come back to where you were on a page** — the scroll offset is kept per page, survives a trip through Health, Inbox or config and a reload; switch it off under **Config → Behavior → General**
- **A dashboard that arrives in one piece** — the 99 scripts and 42 stylesheets are served as two bundles, the Help tab's translations load with Help, the generated theme is inlined, and the three views' stylesheets arrive when a view is opened. First load: **169 requests and 915 KB → 30 requests and 685 KB**, same page, same files on disk (`NEXTDASH_BUNDLE=off` restores the individual tags)
- **The trend where it costs nothing** — the 90-day healthy line is a sparkline in the tile row, not a panel above the list; the tile, or the ▲/▼ in the header, opens the full chart with its series picker
- **Link rot, as its own subject** — every checked bookmark records how long it has been failing; a monitored check can spot a page that answers **200** while saying *not found* — including the sites that never say so, by asking the host what it does with an address that cannot exist, while a site that answers every address with a **sign-in page** is left alone rather than reported gone (**v1.4.1.2**); the list can be read **grouped by site**, so one host down reads as one problem; a **Rot report** in the toolbar sums up what has gone, moved, been failing for over a month, or broke this week; a selection can **follow redirects** in one action after a domain move; and a dead link can be pointed at its **last Web Archive capture**, with the original address kept in the note
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
- **Statistics reports what the app already knows** (**v1.4.0**) — the Health tab pools **uptime** across every monitor over the last day, week and month with the average response and the outages on record, lists the **certificates** close to expiry per site on your own warning window, and says how much of the collection has a **copy kept on this disk**. The Content tab counts everything that is not a bookmark: widgets by kind, feeds, import sources, the trash and the automatic backups. The healthy share counts every failing state rather than three of them, the cleanup score names the neglect threshold you actually set, category panels show names rather than the ids underneath them, and the timestamp follows your 12- or 24-hour setting.
- **Statistics says what its figures mean** (**v1.3.1**) — the tab opens with the three things that follow from them: where your opening lands, what is going unread, and what is not answering, each with the button that acts on it, and nothing shown when there is nothing to report. Tiles carry the direction a count moved over the week, read from the daily points the health report has been recording all along, and the CSV export waits for the Health and Inbox tabs so it is not silently missing two of its five sections.

- **Check a service you have to be signed in to** (**v1.4.0**) — a self-hosted service bookmarked at its web interface answers *not signed in* to an anonymous check, so the row read broken while the service was fine, and the only way to stop that was to stop watching the bookmark most worth watching. Store the sign-in once under **Config → Data & backups → Sources → Health sign-ins** and point any number of bookmarks at it; the bookmark keeps only a name, and the secret stays out of your backups unless you ask for it
- **Buttons on a downtime alert** (**v1.4.0**) — an alert reaching your phone through **ntfy** carries **Open link** and **Health**, so you can act on it without finding a laptop. A failure is sent above the default priority so it breaks a quiet-hours rule, a recovery below it. Give nextDash its own address under **Downtime alerts** for the second button to appear
- **Three slow jobs on a whole selection** (**v1.4.0**) — tick rows in the health view and **Rebuild previews**, **Refresh favicons** and **Save a copy on this disk** act on all of them. Each was already on a single row's menu, which is where the tedium was: a filter that finds forty bookmarks with no preview is exactly the case for doing them at once. They run one request at a time behind a bar that counts, because each one fetches a page belonging to somebody else
- **A bookmark can stop reporting one condition** (**v1.4.2**) — a link you have already looked at and judged fine kept being flagged as stale, unused or broken on every visit, and the only ways to quiet it were to delete the bookmark or stop checking it. Press **n** or **z** on a row, or use its menu, to set that one flag aside: the bookmark stays in the collection and keeps being checked, it simply stops raising that condition. An **Ignored** filter lists everything set aside, and one click puts a bookmark back
- **A bot check is not a dead link** (**v1.4.0**) — a site asking *are you a robot* was counted as gone. Only the answers that say the page or the host no longer exists count now; the rest read as unknown, which is the difference between a monitor people trust and one they switch off
### Bookmarks

- Metadata auto-fetch (title, description, preview image) when adding a URL
- **The add/edit form is two columns** (**v1.3.3**) on a window wide enough for them — name, address, icon and note on one side, page, category, tags, shortcut, pinned and availability on the other. Stacked it was 735 px tall, more than a 1366×768 laptop leaves; side by side it is about 435. Pinned, the availability pills and every warning explain themselves in a bubble on the control instead of a line under it, so a shortcut clash no longer pushes the fields down as you type. On a phone the fields stay in one column and **Icon** and **Note** are hidden — hidden, not dropped, so editing there keeps what the bookmark already had
- The preview card answers three questions in a fixed order: what the page is (favicon, title, one address, a status pill), what it says (image, description, your note, tags), and what you know about it (last check and ping, uptime, certificate expiry, Fresh count, opens and last opened, shortcut and location). Rows with nothing to say are left out, and none of it costs a request — the health figures come from the report the health icon already fetched
- Flash animation on bookmark open — subtle ripple confirms the action was registered
- Plain-text notes per bookmark — visible on the dashboard, in hover previews, and editable via command bar (`:note`), inline edit, or the config detail panel
- Open-count badge tracking usage per bookmark
- **Share** a bookmark from the right-click menu, or from a row's **More** menu in the health view — hands its name and URL to the system share sheet. Sharing needs a **secure context**, and **Safari on macOS refuses it over plain `http://`, `localhost` included**; use **HTTPS** (reverse proxy or Tailscale) for a real sheet. Chrome and Firefox on macOS/Linux have no Web Share at all. Where a sheet cannot open, the entry copies `name — URL`, says so, and re-labels itself **Copy name + URL**
- Pin bookmarks to keep them at the top of their category (no pin badge on dashboard rows; use `:pin` / inline edit)
- **A link you already have is found wherever it is** (**v1.3.0**) — saving a URL that is already on the *same* page is refused, and a copy on *another* page is a question instead: nextDash names the page and category it is already filed under, offers to open it, and **Save anyway** keeps the second copy. The add form, quick add and the extension all ask it the same way
- Import from browser HTML export (Chrome, Firefox, Edge) — folders become categories, duplicate URLs skipped; **missing icons are batch-fetched with a progress bar**
- Export all bookmarks to CSV (localized headers: Name, URL, Category, Page, Shortcut, Tags, Notes), and **import that CSV back** onto the current page — tidy hundreds of rows in a spreadsheet and return the result; unlike the browser-HTML import this route carries **tags and notes**
- Full ZIP backup and restore (pages, bookmarks, categories, **finders**, settings, themes, `data/icons/`, custom favicon/font); atomic import with orphan cleanup — **finders preserved** when omitted from ZIP; **last backup date** shown in Config → Backups; after restore, missing bookmark icons are prefetched the same way. An archive that carries **no bookmark page at all is refused** (**v1.3.3**) — committing an import removes the pages the archive does not name, so such a file used to empty the library and report success
- Settings-only **export/import** of `settings.json` (migration-safe) from Config → Backups
- Bookmark icons: upload, URL fetch, link-preview fetch; re-upload **overwrites** same filename

- **A card says what the page says about itself** (**v1.4.0**) — publisher, author and publication date alongside the title, description and image it already showed, and for the video providers a player you can start from the card
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

The extension needs no CORS configuration: its origin is allowed by default, and its host permissions let the browser grant the request regardless. `NEXTDASH_CORS_ORIGINS` is only for pages of your own.

See `extension/README.md` for full usage and development notes.

---

## Integrations

The extension covers Chrome and its relatives. [`integrations/`](integrations/)
covers everything else, and it is all one route:

```
GET /add?url=<address>&title=<optional title>[&token=<capture token>]
```

It saves to the **Inbox** — the same place the extension and the share sheet
save to, with the same duplicate handling — and answers with a page a person can
read, so a bookmarklet or a Shortcut can simply open it. Anything that can open
a URL or run `curl` is therefore an integration; these are the ones worth
keeping around.

| | |
|---|---|
| [`shell/nextdash-add`](integrations/shell/nextdash-add) | The one-line saver. Quick Actions, Keyboard Maestro, cron, an alias — anything that runs a command |
| [`raycast/save-to-nextdash.sh`](integrations/raycast/save-to-nextdash.sh) | Raycast: type a URL, save it |
| [`raycast/save-current-tab.sh`](integrations/raycast/save-current-tab.sh) | Raycast: save the front tab of Safari, Chrome, Arc, Brave or Edge |
| [`dropzone/nextDash.dzbundle.rb`](integrations/dropzone/nextDash.dzbundle.rb) | **Dropzone 5**: drop a link on the target, or click it to save the clipboard |
| [`alfred/README.md`](integrations/alfred/README.md) | Alfred: a keyword workflow, and a hotkey for the front tab |
| [`shortcuts/README.md`](integrations/shortcuts/README.md) | Apple Shortcuts, for the macOS and iOS share sheets — the route that works on iOS, where Safari does not implement the web share target |
| [`ulauncher/`](integrations/ulauncher/) | Ulauncher, on Linux: `nd <url>` |

Two environment variables configure all of them: **`NEXTDASH_URL`** (default
`http://localhost:8080`) and **`NEXTDASH_TOKEN`**, which is only needed when the
install runs with a write token. Give it the `NEXTDASH_CAPTURE_TOKEN` rather
than the write token: that one opens the two capture routes and nothing else, so
a copy sitting in a script or a browser's history can at worst add a link to
your inbox.

```sh
curl -s --get --data-urlencode "url=https://example.com/article" \
     --data-urlencode "title=An article" \
     https://nextdash.example.com/add >/dev/null
```

Use `--data-urlencode` rather than building the query by hand — an address
carrying its own `?x=1&y=2`, or a title with an ampersand, is exactly what
breaks that. [`integrations/README.md`](integrations/README.md) has the rest,
including which scripts were run against a live install and which could only be
syntax-checked, since several of them need a host app to exercise at all.

The **Dropzone 5** action also has [a repository of its
own](https://github.com/jordibrouwer/dropzone-script-for-nextdash-on-macos).

### Outgoing: telling other programs what happened

Everything above sends a link *in*. Since **v1.4.0** nextDash can also push *out*,
so nothing has to poll it to find out that something changed.

**Webhooks** — **Config → Data & backups → Webhooks**. Five events: a bookmark
added, changed or removed, and a monitored bookmark going down or coming back.
A receiver can subscribe to all of them or to a few.

Every delivery is signed with the [Standard
Webhooks](https://www.standardwebhooks.com/) scheme, so a receiver that already
verifies those needs no special case:

```
POST /your-endpoint
content-type: application/json
webhook-id: msg_2b7f…
webhook-timestamp: 1756253400
webhook-signature: v1,K5s0…

{"type":"bookmark.added","timestamp":"2026-08-27T09:30:00Z","data":{…}}
```

The signature is an HMAC-SHA256 over `{id}.{timestamp}.{payload}` with the
endpoint's own key, base64-encoded. The id and the timestamp are signed rather
than merely sent: the id is how a receiver recognises a redelivery it already
acted on, and the timestamp is how it refuses one replayed at it a day later.

The key is generated when you save the endpoint and shown **once**, in the answer
to that save — copy it into the receiver then. Keys live in `webhooks.json` at
`0600` beside the health sign-ins, and are excluded from backups unless you ask
for them. A failed delivery is retried twice with a growing gap; a `4xx` is not
retried, since that is the receiver saying the request itself is wrong.

**MCP**, for an AI assistant — same tab, and **off until you switch it on**. One
endpoint at `POST /mcp` speaking JSON-RPC 2.0, with four tools: search the
collection, look one bookmark up, list the tags in use, and add a bookmark.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

It is off by default because it answers questions about every bookmark in the
install, which is not something to add to a default install quietly. `Origin` is
checked on every request — a browser will POST to `localhost` from any site on
the internet — and adding a bookmark goes through the same handler the dashboard
posts to, so the duplicate check, the URL validation and the outgoing webhook all
still apply. If the install runs with a write token, the assistant needs it to
write.


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
