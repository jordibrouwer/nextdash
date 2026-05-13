# 🚀 nextDash

**A lightweight, self-hosted bookmark dashboard for power users.**
Featuring a minimalist, keyboard-first interface with extensive customization options. Based on ThinkDashboard by MatiasDesuu.

---

## ✨ Core Features

### ⌨️ Power User Workflow
- **Keyboard-Driven**: Navigate, switch pages, and open bookmarks entirely from the keyboard.
- **Fuzzy Search**: Press `/` to quickly search all bookmarks with fuzzy matching.
- **External Finders**: Use `?` followed by a shortcut (e.g., `?g`) to run searches on external engines.
- **Finder Intelligence**: Finders now support tags, usage stats (count + last used), and top-finder suggestions directly in search.
- **Command System**: Manage settings via the command bar with commands like `:theme`, `:layout`, or `:density`.

### 🎨 Customization & Design
- **Layout Presets**: Choose from multiple styles such as Default, Compact, Cards, Terminal-ish, Masonry, or Detailed List.
- **Theme Engine**: 32+ built-in theme families, automatic Dark Mode, and an editor for custom themes.
- **Font Presets**: Switch between Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans, and System UI.
- **UI Tweaks**: Customize everything from column widths (1–6) and fonts to background transparency and animations.
- **Responsive & PWA**: Works on desktop, tablet and mobile. Installable as a PWA with optional HyprMode support.

### 📊 Intelligence & Monitoring
- **Smart Collections**: Dynamic sections for Recently Opened, Most Used and Stale Bookmarks (links you haven't used recently).
- **Status Monitoring**: Real-time online/offline detection for services, including basic ping timings.
- **Dead Link Auto-Healer**: Health view now suggests archive/redirect/title fixes and supports one-click apply.
- **Metadata Extraction**: Automatically fetches page titles, descriptions and previews for added URLs.
- **Bookmark Notes**: Add plain-text notes to bookmarks; they show on the dashboard, in hover previews, and can be edited from the `Ctrl+Shift+A` modal, inline edit, or the config detail panel.
- **Organization**: Manage unlimited pages and organize bookmarks into collapsible categories.
- **Usage Insights**: Config stats now highlights top usage patterns with direct jump/fix actions.

### ⌨️ Keyboard Shortcuts

#### Dashboard navigation and actions
- `1-9` - Open the matching page tab.
- `Shift + Left/Right` - Move between page tabs.
- `Arrow Up/Down` - Move through bookmarks with keyboard focus.
- `Arrow Left/Right` - Move horizontally through the bookmark grid.
- `Enter` or `Space` - Open the selected bookmark.
- `;` - Open inline edit for the highlighted bookmark row (or a Tab-focused bookmark link).
- `Esc` - Clear keyboard selection (and undo the latest drag reorder when available).

#### Search, finders, and help
- `>` - Open search.
- `:` - Open command mode.
- `?` - Open finder mode.
- `!` - Open the keyboard cheat sheet.
- `*` - Open/close recent bookmarks.
- `Ctrl + /` or `F1` - Open the keyboard cheat sheet.
- Search supports live filter autocomplete for `category:`, `status:`, and `page:`.
- `status:` values: `online`, `offline`, `checked`, `unchecked`, `pinned`, `unpinned`, `broken`, `ok`.
- `page:` values: `current`, `all`, or a page number like `page:2`.

#### Quick actions
- `Ctrl + Shift + A` - Open the "new bookmark" modal.

#### Config page shortcuts
- `1-8` - Jump between config tabs.
- `S` - Save changes.
- `Alt + Up/Down` - Move selected bookmark in the config list.
- `Ctrl + K` / `Cmd + K` - Open the config command palette.

### 🖱️ Mouse gestures
- **Drag handle (left strip)**: Drag a bookmark to reorder it inside the same category, or drop it into another category column to change category directly.
- **Long press on bookmark row**: Press and hold for about 500ms (not on the drag strip) to open inline edit immediately.
- **Hover preview cards**: Optional rich link previews on bookmark hover with configurable delay (100/150/250ms).

---

## 🖼️ Screenshots

| ![1](screenshots/nextdash-1.png) | ![2](screenshots/nextdash-2.png) |
|:---:|:---:|
| ![3](screenshots/nextdash-3.png) | ![4](screenshots/nextdash-4.png) |
|:---:|:---:|
| ![5](screenshots/nextdash-5.png) | ![6](screenshots/nextdash-6.png) |
|:---:|:---:|
| ![7](screenshots/nextdash-7.png) | 
---

## Security and network exposure

nextDash is built as a **personal or small-team dashboard on a trusted network**. It does **not** provide built-in user accounts, API keys, or other application-level access control. Data is stored on disk as configured by the instance; the HTTP API and UI assume that anyone who can open the URL is allowed to use the app.

**Do not** publish the service directly on the public internet without additional protection. If the port is reachable from untrusted clients, they can read, change, or delete your bookmarks and settings like any local user of the app.

**Preferred setups:**

- **Private overlay network** — e.g. [Tailscale](https://tailscale.com/) or another mesh/VPN so your server and browsers share a private IP range and nextDash never gets a world-routable listener.
- **Reverse proxy on a trusted edge** — Traefik, Caddy, nginx, or similar **inside** your home/lab/VPC, terminating TLS and adding **authentication** (HTTP basic auth, OAuth2 Proxy, SSO, etc.) before traffic reaches nextDash.
- **Local-only** — bind to `127.0.0.1` and use SSH port forwarding or the same-machine browser when that fits your workflow.

---

## 🚀 Quick Start

### Using Docker Compose (Recommended)
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

Run with:

```sh
docker-compose up -d
```

Or build and run locally with Go:

```sh
go build -o nextDash && ./nextDash
```

---

## 🧩 Browser Extension

This repository also includes the **nextDash Bookmark Saver** browser extension (`extension/`), which lets you save the current tab directly to a nextDash page.

### Install (Chrome / Chromium)
1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension` folder from this repository

### First-time setup
1. Click the extension icon
2. Open the **Settings** tab
3. Set your nextDash server URL (for example `http://localhost:8080`)
4. Choose a default page and save settings

For full extension usage and development notes, see `extension/README.md`.

---

## Contributing

Contributions are welcome. Please open issues or pull requests for bugs, features or translations.

---

## License

This project is released under the MIT License.
