<p align="center">
  <img src="logo-ascii-on-black-large.png" alt="nextDash" width="720">
</p>

# nextDash

> 🇨🇳 **本应用支持简体中文。** nextDash 的界面提供中文语言选项 — 在设置中将语言切换为「中文」即可。

**A keyboard-first, self-hosted bookmark dashboard. No accounts, no cloud, no noise.**

My bookmark bar had become a graveyard, so I built a self-hosted dashboard that tells me which links are already dead.

Self-host on any machine or container. Open it in your browser, organise bookmarks across multiple pages, and navigate everything from your keyboard.

It is not only links. **Widgets** sit on the page among your categories and answer *what is going on* rather than *where do I go*: uptime per monitored service, a thirty-day trend, what is waiting in the inbox, which certificate is running out, how old the newest backup is. Thirteen of them read data nextDash already collects and need no setup at all; four more report on the machine itself — **processor**, **memory**, **disks** and **containers** — behind read-only mounts you opt into; and the **custom widget** points at any address that answers with JSON, with **28 self-hosted services** already filled in, from Sonarr and Plex to Pi-hole, Proxmox and Home Assistant. A new install arrives with a Health widget already on the page.

Based on [ThinkDashboard](https://github.com/MatiasDesuu/ThinkDashboard) by MatiasDesuu.

📖 **[Full user manual (MANUAL.md)](MANUAL.md)** — step-by-step guide for new users: concepts, keyboard workflow, config, import/backup, health, extension, and efficient daily use.

📋 **[Changelog (CHANGELOG.md)](CHANGELOG.md)** — complete release history (new / fix).

🗂️ **[Cheat sheet](nextDash-cheatsheet.pdf?raw=true)** — every keyboard shortcut, printable ([HTML](nextDash-cheatsheet.html?raw=true)); press **!** or **F1** on the dashboard for the live searchable list. Regenerate with `npm run generate:cheatsheet`.

🌐 **Official Website:** [nextdash.cc](https://nextdash.cc)

📰 **Developer Blog & Updates:** [jordibrw.cc](https://jordibrw.cc)

🧩 **Save a link from anywhere:** a browser extension, a shell one-liner, Raycast, Dropzone 5, Alfred, Apple Shortcuts and Ulauncher — see [What nextDash talks to](#what-nextdash-talks-to).

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
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-6.png" alt="Dashboard with combined columns" width="100%" />
      <br />
      <sub><b>Dashboard</b> with combined columns.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-8.png" alt="Dashboard with widgets" width="100%" />
      <br />
      <sub><b>Dashboard</b> with widgets.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-7.png" alt="Widget settings" width="100%" />
      <br />
      <sub><b>Widgets</b> — Adding and configuring a widget.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="screenshots/nextdash-9.png" alt="Widget settings" width="100%" />
      <br />
      <sub><b>Widgets</b> — The full widget settings panel.</sub>
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

### System widgets — reading the machine (v1.4.8)

The **Processor**, **Memory**, **Disks** and **Containers** widgets report on the
machine nextDash runs on. They are the only ones that need setting up, because a
container cannot see the machine around it unless you let it. Running the binary
directly needs none of this.

```yaml
    volumes:
      - ./data:/app/data
      # Disks: required. Mount what you want to watch UNDER the prefix, keeping
      # its own name, so /mnt stays /mnt below /host/root.
      - /mnt:/host/root/mnt:ro,rslave           # Unraid, most Linux
      # - /volume1:/host/root/volume1:ro,rslave # Synology, QNAP
      # - /:/host/root:ro,rslave                # everything, boot device included
      # Processor and Memory: optional — /proc is not namespaced, so a container
      # already reads the host's CPU and memory. Mount it to be explicit.
      # - /proc:/host/proc:ro
      # Containers: read-only still exposes the daemon's whole read API.
      # - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - NEXTDASH_HOST_ROOT=/host/root
      # - NEXTDASH_HOST_PROC=/host/proc
      # - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
```

| Variable | What it does | Needed for |
|---|---|---|
| `NEXTDASH_HOST_ROOT` | The prefix your disks are mounted under. Paths typed in the widget resolve against it | **Disks** — required |
| `NEXTDASH_HOST_PROC` | Where the host's `/proc` is readable | Processor, Memory — optional |
| `NEXTDASH_DOCKER_SOCKET` | Path to the Docker socket. Unset means the Containers widget is not offered | **Containers** — required |

Name the disks in the widget's settings as **this machine** knows them —
`/mnt/user`, `/mnt/cache`, `/volume1` — never as the container sees them; the
server translates. Whatever is mounted and readable is offered under the field.
A source that is not mounted says so on the tile rather than showing a plausible
wrong number.

**The Docker socket is a real grant.** Read-only still exposes every container,
its image, its environment variables and its mounts. Add it only if you are
content with that for a container count; a socket proxy in front is the smaller
grant if you are not.

#### Unraid

Unraid has no compose file — the same thing is rows in the container template.
Go to **Docker → nextDash → Edit**, then **Add another Path, Port, Variable,
Label or Device** once per row below. Add only the rows for the widgets you
want; each is independent.

**For the Disks widget** (required — without it the tile reports the container's
own overlay, not your array):

| Config Type | Name | Container Path | Host Path | Access Mode |
|---|---|---|---|---|
| **Path** | Host disks | `/host/root/mnt` | `/mnt` | **Read Only** |

| Config Type | Name | Key | Value |
|---|---|---|---|
| **Variable** | Host root | `NEXTDASH_HOST_ROOT` | `/host/root` |

**For the Processor and Memory widgets** (optional — a container already reads
the host's CPU and memory, so this only makes explicit which `/proc` is used):

| Config Type | Name | Container Path | Host Path | Access Mode |
|---|---|---|---|---|
| **Path** | Host proc | `/host/proc` | `/proc` | **Read Only** |

| Config Type | Name | Key | Value |
|---|---|---|---|
| **Variable** | Host proc | `NEXTDASH_HOST_PROC` | `/host/proc` |

**For the Containers widget** (required for it, and the one row worth thinking
about — read-only still exposes every container, its image, its environment
variables and its mounts):

| Config Type | Name | Container Path | Host Path | Access Mode |
|---|---|---|---|---|
| **Path** | Docker socket | `/var/run/docker.sock` | `/var/run/docker.sock` | **Read Only** |

| Config Type | Name | Key | Value |
|---|---|---|---|
| **Variable** | Docker socket | `NEXTDASH_DOCKER_SOCKET` | `/var/run/docker.sock` |

**Then press Apply.** Unraid recreates the container; your data in `/app/data` is
untouched.

**Afterwards, in nextDash:** add the widget under **Config → Widgets**, and for
Disks open its **Settings** and name the disks — `/mnt/user` and `/mnt/cache` are
the usual pair. Type them as **Unraid** knows them, not as the container sees
them; whatever is mounted and readable is offered under the field, so you can
click instead of typing. If a tile says it cannot read the machine, the mount or
the variable for that widget is missing — it names which.

Two Unraid specifics worth knowing: mount `/` to `/host/root` instead of `/mnt`
if you want disks outside the array (the boot device, an unassigned disk), and a
**user share reports the pool total** — the same figure Unraid's own dashboard
shows — while individual `/mnt/diskN` paths report per disk.

*[Manual → System widgets](MANUAL.md#system-widgets-what-they-need)*

### Build from source

```sh
go build -o nextDash && ./nextDash
```

By default, data is stored in `./data`. Override with `NEXTDASH_DATA_DIR` (absolute or relative path) when you need a separate data location.

---

## Security

nextDash is built to run on your own machine, for **personal or small-team use on a trusted network**. There are no user accounts: anyone who can reach the URL can read and change data unless you put something in front of it.

**Do not expose nextDash directly to the public internet.** Recommended setups:

- **Private overlay network** — [Tailscale](https://tailscale.com/) or another mesh VPN, so nextDash never gets a public listener.
- **Reverse proxy with auth** — Traefik, Caddy, or nginx inside your home, lab or VPC, with HTTP basic auth, OAuth2 Proxy, or SSO in front.
- **Local-only** — bind to `127.0.0.1` and reach it over an SSH tunnel or from a browser on the same machine.

Everything below is the short version. **[MANUAL § 21 — Security and self-hosting](MANUAL.md#21-security-and-self-hosting)** explains each of these properly, along with the full list of protected endpoints, outgoing webhooks, and the MCP endpoint.

### Write token

Set `NEXTDASH_WRITE_TOKEN` to a long random string and every destructive API call — resets, imports, deletes, uploads, saves — requires the header `X-NextDash-Token` with that value. The dashboard supplies it automatically when you open it in a browser, so normal use is unaffected. Leave it unset and nothing requires a token, which is what you want for local development.

The two capture routes, `GET /share` and `GET /add`, cannot send a header, so on a token-protected install they take a token in the address instead — set `NEXTDASH_CAPTURE_TOKEN` to a second random string, which opens capture and nothing else. See *MANUAL § 21*.

### CORS

Only an installed browser extension's origin receives `Access-Control-Allow-Origin`; any other web page gets no CORS header and cannot read the API. Set `NEXTDASH_CORS_ORIGINS` to a comma-separated allowlist to permit a page of your own, or to `*` to answer every origin. See *MANUAL § 21*.

### Activity log (bookmark events)

A machine-readable JSON trail of bookmark changes and status checks, written alongside the readable server log. Twelve channels; changes and check results are on by default. Choose them under **Config → Data & backups → Server log → Activity trail**, or with `NEXTDASH_ACTIVITY_LOG`. URLs appear in the trail, so treat the log files as sensitive on a shared host. See *MANUAL § 21*.

### Production Docker example

`docker-compose.prod.yml` serves CSS and JS from the embedded binary, mounts only `./data`, and sets a 256 MB memory cap. The entrypoint starts as root so host Docker hooks can run, then drops to the `nextdash` user (`NEXTDASH_RUN_AS_ROOT=1` keeps root when you need it). For TLS and long-cache static serving, run `docker compose -f docker-compose.proxy.yml up -d` with `deploy/Caddyfile`.

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

`GET /version` returns build metadata (version, commit). `GET /api/data-revision` returns a hash, so open dashboard tabs detect bookmark and settings changes without a full reload.

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
| `NEXTDASH_HOST_ROOT` | *(unset)* | Prefix the host's disks are mounted under, for the **Disks** widget. Paths typed in the widget resolve against it. Unset = no disks readable |
| `NEXTDASH_HOST_PROC` | `/proc` | Where the host's `/proc` is readable, for **Processor** and **Memory**. A container's own `/proc` already reports the host on Linux |
| `NEXTDASH_DOCKER_SOCKET` | *(unset)* | Path to the Docker socket, for the **Containers** widget. Unset = the widget is not offered. Read-only access still exposes the daemon's whole read API |

---

## Features

Every line below is one paragraph in the [manual](MANUAL.md), which explains how
each thing works and why it behaves the way it does.

**Bookmarks and pages**

- Unlimited pages and categories, each with its own icon, colour and sort — drag to reorder anywhere. *[Manual §11](MANUAL.md#11-organising-pages-and-categories)*
- Add a link four ways: a one-key quick add, the full form, a paste on the dashboard, or the browser extension. *[Manual §7](MANUAL.md#7-adding-bookmarks)*
- Tags, notes, shortcuts and pins on any bookmark, with a preview card that says what a page is without opening it. *[Manual §8](MANUAL.md#8-opening-and-using-bookmarks), [§12](MANUAL.md#12-tags-notes-and-metadata)*
- An **Inbox** for links worth keeping before you know where they belong — snooze them, triage them, promote them. *[Manual §7.9](MANUAL.md#79-inbox-capture-links-for-later)*
- **Smart collections** gather bookmarks by what you do with them; collections of your own take rules you write. *[Manual §13](MANUAL.md#13-smart-collections-and-custom-collections)*

**Search and keyboard**

- Everything is reachable from the keyboard: one rule for the shortcuts, a cheat sheet on `!`, and no action that needs the mouse. *[Manual §9](MANUAL.md#9-keyboard-navigation)*
- Four ways to find something — search, fuzzy search, a command palette, and finders that search other sites. *[Manual §10](MANUAL.md#10-search-commands-and-finders)*
- Filters for category, tag, page, status, when you added it and when you last opened it, each of which also works in the negative. *[Manual §10.1](MANUAL.md#101-search)*

**Health monitoring**

- A **health view** that triages the whole collection: what is broken, stale, duplicated, unchecked or drifting. *[Manual §15](MANUAL.md#15-status-monitoring-and-health)*
- **Uptime monitoring** per bookmark with 30 days of history, response-time charts, outage lists and certificate expiry. *[Manual §15](MANUAL.md#15-status-monitoring-and-health)*
- Downtime alerts to Slack, Discord, Telegram, Gotify, ntfy, Pushover or your browser, with maintenance windows and per-bookmark muting. *[Manual §15](MANUAL.md#15-status-monitoring-and-health)*
- Keep your own copy of a page, on this disk or in the Web Archive, so a dead link is still readable. *[Manual §15](MANUAL.md#keeping-a-copy-of-a-page-v140)*

**Widgets**

- Blocks that show something other than links, drawn among the categories: health, uptime, inbox, backups, certificates and more. *[Manual §11](MANUAL.md#widgets-v140)*
- A custom widget reads any service that answers with JSON, with 28 self-hosted services already filled in. *[Manual §11](MANUAL.md#widgets-v140)*

**Appearance**

- 107 theme families in light and dark, browsable as a grid with a live preview, plus an editor for your own. *[Manual §14](MANUAL.md#14-layouts-themes-and-appearance)*
- Layout presets, column counts, density, fonts, backdrops and a button bar you can put where you want it. *[Manual §14](MANUAL.md#14-layouts-themes-and-appearance)*
- Four languages: English, Dutch, German and French. *[Manual §16](MANUAL.md#16-config-complete-walkthrough)*

**Import and export**

- Read the browser bookmark file every browser exports — and that Pocket, Pinboard, Raindrop, linkding and Karakeep all speak — plus CSV and JSON. *[Manual §17](MANUAL.md#17-import-export-and-backup)*
- **Sources** keep bringing bookmarks in: GitHub stars, Raindrop.io, Hacker News, YouTube and Mastodon. *[Manual §17](MANUAL.md#sources-where-bookmarks-keep-coming-from-v140)*
- A ZIP backup carries the whole data directory, automatically and on a schedule if you want. *[Manual §17](MANUAL.md#17-import-export-and-backup)*

**Self-hosting**

- One Go binary and a data directory of plain JSON. No database, no account, privacy focussed telemetry only if you want. *[Manual §21](MANUAL.md#21-security-and-self-hosting)*
- A write token, a CORS allowlist, rate limits, SSRF protection and an activity log, for when it faces a network. *[Security](#security)*
- It talks to other things: a browser extension, a route for scripts, outgoing webhooks, an MCP endpoint. *[What nextDash talks to](#what-nextdash-talks-to)*

---

## What nextDash talks to

- **Browser extension** (`extension/`) — saves the current tab to a page or to the inbox. Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and pick the `extension/` folder. *[Manual §18](MANUAL.md#18-browser-extension)*
- **A capture route for everything else** — `GET /add?url=…&title=…` saves to the Inbox and answers with a readable page, so anything that can open a URL or run `curl` can save to it. *[Manual §21](MANUAL.md#the-capture-route-for-scripts-and-launchers)*
- **[`integrations/`](integrations/)** — a shell one-liner, two Raycast commands, a **Dropzone 5** action, a Ulauncher extension for Linux, and recipes for Alfred and Apple Shortcuts, all built on that one route. The [Dropzone 5 action](https://github.com/jordibrouwer/dropzone-script-for-nextdash-on-macos) also has a repository of its own. *[`integrations/README.md`](integrations/README.md)*
- **A bookmarklet, and the phone share sheet** — **Config → Help → Inbox** builds a bookmarklet carrying this install's own address; installed as an app, nextDash joins the system share sheet. *[Manual §15](MANUAL.md#15-status-monitoring-and-health), [§19](MANUAL.md#19-mobile-pwa-and-touch)*
- **Outgoing webhooks** — five events, signed with the [Standard Webhooks](https://www.standardwebhooks.com/) scheme, so nothing has to poll nextDash to learn that something changed. *[Manual §21](MANUAL.md#outgoing-webhooks-v140)*
- **An MCP endpoint** for an AI assistant — four tools, off until you switch it on. *[Manual §21](MANUAL.md#an-mcp-endpoint-for-an-ai-assistant-v140)*
- **The machine it runs on** — the system widgets read `/proc`, the disks you name, and optionally the Docker socket, all read-only and all off until you mount them. Nothing leaves the machine. *[Quick Start](#system-widgets--reading-the-machine-v148), [Manual](MANUAL.md#system-widgets-what-they-need)*

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
