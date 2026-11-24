<p align="center">
  <img src="header.svg" alt="nextDash: your links, your services, your homelab. in one place." width="100%">
</p>

# nextDash

> 🇨🇳 **本应用支持简体中文。** nextDash 的界面提供中文语言选项 — 在设置中将语言切换为「中文」即可。

**A keyboard-first, self-hosted dashboard for your links, your services and your homelab. No accounts, no cloud, no noise.**

- **Bookmarks:** pages, categories, tags, notes, an inbox, smart collections, and one search panel.
- **Monitoring:** dead links, uptime, certificate and domain expiry, a status page, and alerts.
- **Containers:** logs, start, stop and update with rollback for your Docker host.
- **Widgets:** weather, feeds, your machine, Unraid, media services, Home Assistant, any JSON API.
- **Looks:** 446 themes, 285 backdrops and a theme studio, in six languages. Works on a phone.
- **Assistant (optional):** Claude, OpenAI or your own model. Off until you turn it on.
- **Yours:** one Go binary, plain JSON files, automatic backups, imports from browsers and other tools.

📖 [Manual](MANUAL.md) · 📋 [Changelog](CHANGELOG.md) · 🗂️ [Cheat sheet](nextDash-cheatsheet.pdf?raw=true) ([HTML](nextDash-cheatsheet.html?raw=true)) · 🌐 [nextdash.cc](https://nextdash.cc) · [Demo](https://demo.nextdash.cc) · [Dev log](https://brewedbits.dev)

Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

<p align="center">
  <img src="screenshots/nextdash-dashboard.jpg" alt="The nextDash dashboard in Tarnished Brass: a large clock with a greeting and the weather in big type beside it, the notifications bell in the header, categories in columns, and widgets for health, uptime, the inbox, notes and the weather" width="100%" />
</p>

<details>
<summary><b>See every theme</b> — the dark and light halves of every family, each on the same dashboard</summary>

<p align="center">
  <img src="screenshots/nextdash-themes-dark.jpg" alt="All 220 dark themes, each shown on the same dashboard" width="100%" />
  <br />
  <sub><b>All 220 dark themes</b></sub>
</p>

<p align="center">
  <img src="screenshots/nextdash-themes-light.jpg" alt="All 220 light themes, each shown on the same dashboard" width="100%" />
  <br />
  <sub><b>All 220 light themes</b></sub>
</p>

</details>

---

## Screenshots

<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-bookmarks-view.jpg" alt="Bookmarks view" width="100%" />
      <br />
      <sub><b>Bookmarks view</b> <i>(Oceanic Steel, light)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-search.jpg" alt="Search" width="100%" />
      <br />
      <sub><b>Search</b> <i>(Porcelain Blue, light)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-inbox.jpg" alt="Inbox view" width="100%" />
      <br />
      <sub><b>Inbox</b> <i>(Paper Ink, light)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-edit-mode.jpg" alt="Edit mode" width="100%" />
      <br />
      <sub><b>Edit mode</b> <i>(Oceanic Steel)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-digest.jpg" alt="Weekly digest" width="100%" />
      <br />
      <sub><b>Weekly digest</b> <i>(Oceanic Steel)</i></sub>
    </td>
  </tr>
</table>

<details>
<summary><b>More screenshots</b> — more views, in other themes</summary>
<br />

<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-dashboard-homelab.jpg" alt="Homelab dashboard" width="100%" />
      <br />
      <sub><b>A second page</b> <i>(Terminal Amber)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-triage.jpg" alt="Inbox triage" width="100%" />
      <br />
      <sub><b>Triage</b> <i>(Royal Amethyst)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-bookmarks-health.jpg" alt="Broken bookmarks" width="100%" />
      <br />
      <sub><b>Broken links</b> <i>(Oxblood Leather)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-collection-health.jpg" alt="Collection health" width="100%" />
      <br />
      <sub><b>Collection health</b> <i>(Salt Flat, light)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-search-tags.jpg" alt="Tag search" width="100%" />
      <br />
      <sub><b>Search by tag</b> <i>(Neon Grid)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-commands.jpg" alt="Command palette" width="100%" />
      <br />
      <sub><b>Command palette</b> <i>(ThinkDashboard Classic)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-containers.jpg" alt="Containers view" width="100%" />
      <br />
      <sub><b>Containers</b> <i>(Harbour Fog)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-themes.jpg" alt="Theme studio" width="100%" />
      <br />
      <sub><b>The theme studio</b> <i>(Mulberry Silk)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-glances.jpg" alt="Glances" width="100%" />
      <br />
      <sub><b>Glances</b> <i>(Deep Lagoon)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-glances-widgets.jpg" alt="Glances widgets on a page" width="100%" />
      <br />
      <sub><b>Glances on the dashboard</b> <i>(Deep Lagoon)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-config-appearance.jpg" alt="Config: Appearance" width="100%" />
      <br />
      <sub><b>Config → Appearance</b> <i>(Sea Glass, light)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-config-statistics.jpg" alt="Config: Statistics" width="100%" />
      <br />
      <sub><b>Config → Statistics</b> <i>(Copper Circuit)</i></sub>
    </td>
  </tr>
</table>

<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-unraid-black.jpg" alt="Unraid widgets in the Unraid Black theme" width="100%" />
      <br />
      <sub><b>Unraid Black</b> <i>(dark)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-unraid-azure.jpg" alt="Unraid widgets in the Unraid Azure theme" width="100%" />
      <br />
      <sub><b>Unraid Azure</b> <i>(light)</i></sub>
    </td>
  </tr>
</table>

<table border="0" width="100%">
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-containers-health.jpg" alt="Containers and health" width="100%" />
      <br />
      <sub><b>Containers and health</b> <i>(Deep Lagoon)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-containers-updates.jpg" alt="Updates with a way back" width="100%" />
      <br />
      <sub><b>Updates with a way back</b> <i>(Smoked Plum)</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-unraid-dashboard.jpg" alt="Unraid on the dashboard" width="100%" />
      <br />
      <sub><b>Unraid on the dashboard</b> <i>(Tarnished Brass)</i></sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-unraid-config.jpg" alt="Config: Unraid" width="100%" />
      <br />
      <sub><b>Config: Unraid</b> <i>(Nordic Frost)</i></sub>
    </td>
  </tr>
</table>

</details>

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
      # On a LAN or VPS, require a token for every write (see Security):
      # - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
    restart: unless-stopped
```

```sh
docker compose up -d
```

Open `http://localhost:8080`.

From a git checkout, use `docker compose -f docker-compose.prod.yml up -d --build` for production. `docker-compose.yml` is for development. Put your own changes in `docker-compose.override.yml`.

### Build from source

```sh
go build -o nextDash && ./nextDash
```

Data is stored in `./data`. `NEXTDASH_DATA_DIR` moves it.

### System widgets

The Processor, Memory, Disks and Containers widgets need no setup with the binary. A container needs read-only mounts:

```yaml
    volumes:
      - ./data:/app/data
      - /mnt:/host/root/mnt:ro,rslave                     # Disks: required
      # - /proc:/host/proc:ro                             # Processor, Memory: optional
      # - /var/run/docker.sock:/var/run/docker.sock:ro    # Containers: a real grant
    environment:
      - NEXTDASH_HOST_ROOT=/host/root
      # - NEXTDASH_HOST_PROC=/host/proc
      # - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
      # - NEXTDASH_DOCKER_CONTROL=1                       # Containers: start/stop/update/remove
```

### Containers view

> [!IMPORTANT]
> Access to the Docker socket is root on the host, also with `:ro`. With actions on, anyone who can open the dashboard can stop, update or remove your containers. Keep nextDash behind Tailscale or a reverse proxy with authentication.

1. **Socket:** mount `/var/run/docker.sock` and set `NEXTDASH_DOCKER_SOCKET`.
2. **Actions:** set `NEXTDASH_DOCKER_CONTROL=1` to start, stop, update and remove. Without it the view only reads.
3. **Write token:** set `NEXTDASH_WRITE_TOKEN`.
4. **Only if the log says `is owned by gid 0`:** set `NEXTDASH_RUN_AS_ROOT=1`.

```yaml
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
      - NEXTDASH_DOCKER_CONTROL=1                        # start/stop/restart/update/remove
      - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
      # - NEXTDASH_RUN_AS_ROOT=1                         # only if the log says "owned by gid 0"
```

On **Unraid** (Docker → nextDash → Edit), fill in **Docker socket**, **Docker socket variable** and **Write token**. Set **Docker actions** to `1` for actions. Leave **Run as root** at `0`.

Details, including Synology and QNAP: [manual](MANUAL.md#156-what-it-needs). How containers, bookmarks and monitoring link up: [self-hosted guide](MANUAL.md#self-hosted-guide).

### Unraid

nextDash reads an Unraid server through its own API (Unraid 7.2, or older with the Unraid Connect plugin): seven widgets and alerts. Connect it once under **Config → Unraid** with a **Viewer** API key. nextDash only reads. [Manual](MANUAL.md#unraid)

---

## Security

nextDash has **no user accounts**. Anyone who can reach the address can read and change the data. **Do not expose it directly to the internet.** Use one of these:

- A private network such as [Tailscale](https://tailscale.com/).
- A reverse proxy with authentication (Traefik, Caddy or nginx).
- Local only: bind to `127.0.0.1` and use an SSH tunnel.

Also:

- **Write token:** `NEXTDASH_WRITE_TOKEN` requires the header `X-NextDash-Token` on writes. It is not a login: the dashboard hands it to every browser that opens it. Use a long random string (`openssl rand -hex 32`).
- **Capture token:** `/add` and the share target cannot send a header. Give them `NEXTDASH_CAPTURE_TOKEN`.
- **Activity trail:** it can contain URLs and searches. Treat the files as private.

More: [manual § 24](MANUAL.md#24-security-and-self-hosting).

### Production Docker

`docker-compose.prod.yml` mounts only `./data` and limits memory to 256 MB. For TLS, run `docker compose -f docker-compose.proxy.yml up -d` with `deploy/Caddyfile`. Recommended LAN/VPS environment:

```yaml
environment:
  - PORT=8080
  - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
  - NEXTDASH_CORS_ORIGINS=https://dash.example.com
  - NEXTDASH_ACTIVITY_LOG=mutate,status,security
  - NEXTDASH_ACTIVITY_LOG_PERSIST=1
  # Capture from a bookmarklet, share sheet or script without the write token:
  # - NEXTDASH_CAPTURE_TOKEN=a-second-long-random-string
  # Automatic backups:
  # - NEXTDASH_AUTO_BACKUP_KEEP=7
  # - NEXTDASH_AUTO_BACKUP_DIR=/backups            # mount a volume there
  # Logging:
  # - NEXTDASH_LOG_LEVEL=warn
  # - NEXTDASH_ACTIVITY_LOG_FORMAT=json            # for Loki or Vector
  # - NEXTDASH_ACTIVITY_LOG_URLS=host
  # - NEXTDASH_ACTIVITY_LOG_MAX_AGE_DAYS=30
  # System widgets (see Quick Start):
  # - NEXTDASH_HOST_ROOT=/host/root
  # - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
  # - NEXTDASH_DOCKER_CONTROL=1
  # Rate limits and headers:
  # - NEXTDASH_OUTBOUND_REQUESTS_PER_MIN=120
  # - NEXTDASH_SSRF_API_RATE_PER_MIN=60
  # - NEXTDASH_STATUS_PING_RATE_PER_MIN=300
  # - NEXTDASH_TRUSTED_PROXIES=10.0.0.0/8
  # - NEXTDASH_CSP=off
  # For everyone on this server:
  # - DISABLE_TELEMETRY=true
  # - DISABLE_UPDATE_CHECK=true
  # - DISABLE_NEWS_FEED=true
```

`GET /version` returns the version and commit.

### Environment variables (reference)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP port (1–65535) |
| `NEXTDASH_DATA_DIR` | `./data` | Where pages, bookmarks, settings and uploads live |
| `NEXTDASH_WRITE_TOKEN` | *(unset)* | Require `X-NextDash-Token` on writes |
| `NEXTDASH_ALLOWED_HOSTS` | *(unset)* | With a write token: extra host names the dashboard may be opened by, comma-separated (`*.example.com` allowed, `*` turns the check off). IPs, `localhost` and private names always pass |
| `NEXTDASH_CAPTURE_TOKEN` | *(unset)* | A token that opens only `/add` and the share target |
| `NEXTDASH_CORS_ORIGINS` | *(unset)* | Extra origins allowed to use the API, comma-separated; `*` for all. Extensions are always allowed. |
| `NEXTDASH_CSP` | on | `off` disables the Content-Security-Policy header |
| `NEXTDASH_OUTBOUND_REQUESTS_PER_MIN` | `120` | Rate limit for requests the server makes for you |
| `NEXTDASH_SSRF_API_RATE_PER_MIN` | `60` | Rate limit for the preview, icon, archive, check-URL and alert-test APIs |
| `NEXTDASH_STATUS_PING_RATE_PER_MIN` | `300` | Rate limit for `/api/ping`, the status checks the dashboard runs in your browser |
| `NEXTDASH_TRUSTED_PROXIES` | *(unset)* | Addresses or CIDR ranges whose `X-Forwarded-For` is believed, comma-separated |
| `NEXTDASH_AUTO_BACKUP_KEEP` | `3` | How many automatic backups are kept (1–50) |
| `NEXTDASH_AUTO_BACKUP_DIR` | `data/auto-backups` | Where automatic backups are stored (absolute path) |
| `NEXTDASH_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. **Detail level** in the app wins. |
| `NEXTDASH_ACTIVITY_LOG` | `mutate,status` | `off`, or channels: `mutate`, `status`, `open`, `security`, `health`, `sources`, `feeds`, `archive`, `backup`, `store`, `widgets`, `notify`, `search`, `keys`, `nav`, `session`, `clienterror`. **Activity trail** in the app wins. |
| `NEXTDASH_ACTIVITY_LOG_PERSIST` | off | `1` writes a rotating `activity.log` in the data directory |
| `NEXTDASH_ACTIVITY_LOG_FILE` | `data/activity.log` | Another path for that file |
| `NEXTDASH_ACTIVITY_LOG_FORMAT` | `text` | `text` (a readable sentence) or `json` on stdout, for Loki or Vector |
| `NEXTDASH_ACTIVITY_LOG_URLS` | `full` | `full`, `host` or `off` — how URLs and search text appear in the trail |
| `NEXTDASH_ACTIVITY_LOG_SAMPLE` | *(unset)* | Sampling per channel, e.g. `open=0.1,keys=0.25` |
| `NEXTDASH_ACTIVITY_LOG_MAX_AGE_DAYS` | `0` (off) | Delete rotated `activity.log.N` files older than this |
| `NEXTDASH_ACTIVITY_OPEN_DETAIL` | `basic` | `off`, `basic` or `full` — what a bookmark-open record holds. **Open detail** in the app wins. |
| `NEXTDASH_HOST_ROOT` | *(unset)* | Prefix the host's disks are mounted under, for the **Disks** widget |
| `NEXTDASH_HOST_PROC` | `/proc` | The host's `/proc`, for **Processor** and **Memory** |
| `NEXTDASH_DOCKER_SOCKET` | *(unset)* | The Docker socket, for the **Containers** widget and view; unset hides the widget |
| `NEXTDASH_DOCKER_CONTROL` | off | `1` allows start, stop, pause, restart, update and remove in the **Containers** view |
| `NEXTDASH_COMPOSE_MAP` | *(unset)* | Where a stack folder on the host appears inside nextDash, `hostPrefix:containerPrefix`, comma separated; the **Containers** view reads, edits and runs a stack's compose files there |
| `NEXTDASH_COMPOSE_IMAGE` | `docker:29.7-cli` | The helper image that runs `docker compose` for a stack |
| `NEXTDASH_COMPOSE_SOCKET` | *(derived)* | The Docker socket's path on the host, when nextDash cannot tell from its own mounts |
| `NEXTDASH_COMPOSE_DOCKER_CONFIG` | *(unset)* | A folder with `config.json` mounted read-only into the helper, so a pull can use your registry logins |
| `NEXTDASH_DISABLE_PREFETCH` | off | `1` skips the icon prefetch at start-up |
| `NEXTDASH_HEALTH_STARTUP_GRACE` | `15m` | How long after start-up a bookmark's first failed check is held back (a Go duration such as `15m`); `0` turns it off |
| `NEXTDASH_DEMO` | off | `1` makes a public demo. **It empties `NEXTDASH_DATA_DIR` on every start and reset**; never set it on your own install. See `deploy/demo/docker-compose.yml` |
| `NEXTDASH_DEMO_RESET_MINUTES` | `30` | Demo only: minutes between resets |
| `NEXTDASH_DEMO_IDLE_MINUTES` | `10` | Demo only: reset this many minutes after the last change |
| `NEXTDASH_DEMO_ANALYTICS_ID` | unset | Demo only: Umami website id for the demo's visits |
| `NEXTDASH_RUN_AS_ROOT` | off | `1` keeps the container running as root |
| `NEXTDASH_BUNDLE` | on | `off` serves scripts and stylesheets one by one, for debugging |
| `NEXTDASH_STATIC_MUTABLE` | off | `1` re-hashes assets on every request, for a bind-mounted `./static` |
| `DISABLE_ICON_SETS` | off | `1` stops fetching the app icon sets (dashboard-icons, selfh.st/icons) from jsDelivr |
| `DISABLE_TELEMETRY` | off | `true` turns analytics and the daily install count off for everyone |
| `NEXTDASH_DISABLE_INSTALL_PING` | off | `1` turns the daily install count off and leaves analytics alone, for test runs and CI |
| `DISABLE_UPDATE_CHECK` | off | `true` turns the daily GitHub release check off for everyone |
| `DISABLE_NEWS_FEED` | off | `true` stops fetching posts from nextdash.cc |

---

## Features

The [manual](MANUAL.md) explains everything.

- **Bookmarks:** [pages and categories](MANUAL.md#9-pages-categories-and-collections), [edit mode](MANUAL.md#edit-mode), [tags and tag suggestions](MANUAL.md#10-tags), [Bookmarks view](MANUAL.md#11-the-bookmarks-view), [inbox](MANUAL.md#13-inbox).
- **Search and keyboard:** [everything by key](MANUAL.md#7-keyboard), [search, commands, finders and sums](MANUAL.md#8-search-commands-and-finders), [Quick launch](MANUAL.md#quick-launch).
- **Monitoring:** [uptime and collection health](MANUAL.md#118-collection-health), [network tests](MANUAL.md#1114-the-tests-tab-network-checks), [alerts](MANUAL.md#124-alerts), [status page](MANUAL.md#127-the-status-page), [watch feeds](MANUAL.md#14-watch-feeds).
- **Widgets:** [64 kinds](MANUAL.md#16-widgets), including a [custom widget](MANUAL.md#165-the-custom-widget) for any JSON service.
- **Containers:** [Containers view](MANUAL.md#15-containers), [updates and rollback](MANUAL.md#155-actions-and-updates), [compose stacks](MANUAL.md#1512-compose-stacks), [Glances](MANUAL.md#16a-glances).
- **Appearance:** [themes, backdrops and theme studio](MANUAL.md#17-appearance).
- **Data:** [imports, backups and trash](MANUAL.md#20-data-backups-and-import), [sources](MANUAL.md#202-sources), [logs](MANUAL.md#21-logs).

---

## What nextDash talks to

- **Browser extension:** load `extension/` as an unpacked extension. [Manual](MANUAL.md#22-browser-extension-and-capture)
- **Capture route:** `GET /add?url=…&title=…` saves to the inbox. [Manual](MANUAL.md#222-capture-without-the-extension)
- **[`integrations/`](integrations/):** shell, Raycast, [Dropzone 5](https://github.com/jordibrouwer/dropzone-script-for-nextdash-on-macos), Ulauncher, Alfred, Apple Shortcuts.
- **Bookmarklet and share sheet:** [manual](MANUAL.md#23-phones-tablets-and-the-installed-app).
- **[Webhooks](MANUAL.md#203-webhooks)**, an **[MCP endpoint](MANUAL.md#246-the-mcp-endpoint)** and an **[assistant](MANUAL.md#2411-the-assistant)**; the last two are off by default.
- **Sent by itself:** a daily install count (random id and version), a release check on GitHub and the nextdash.cc news feed. Turn each off under **Config → Behavior → Privacy & sync**. None carries bookmarks, settings or addresses. [Manual](MANUAL.md#247-what-nextdash-contacts)

---

## Contributing

Issues and pull requests are welcome — bugs, features and translations alike.

### Branch workflow

| Branch | Purpose |
|--------|---------|
| **`dev`** | Day-to-day development (tests, CI, scripts) |
| **`main`** | The published release, for Docker and the public repository page |

1. Branch from **`dev`** and open pull requests **into `dev`**.
2. CI runs on pushes and pull requests to **`dev`**.
3. When a release is ready, merge **`dev` → `main`** with:

   ```bash
   git checkout dev
   ./scripts/release-to-main.sh v1.11.0
   ```

   The script merges, removes development-only files from `main` (tests, Playwright, internal scripts), tags the release, pushes, and publishes a **GitHub Release** with [`gh`](https://cli.github.com/). One-time setup: `brew install gh` and `gh auth login`.

Do **not** merge `dev` into `main` by hand on GitHub.

**Clone for development:** `git clone`, then `git checkout dev`.
**Clone for Docker or stable use:** stay on the default **`main`** branch.

## License

MIT
