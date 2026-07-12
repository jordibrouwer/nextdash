# nextDash — User Manual

**A complete, step-by-step guide to the keyboard-first bookmark dashboard.**

This manual is written for new users and for anyone who wants a structured reference. It complements the shorter [README](README.md) (install, security, changelog) and the in-app help at **Config → Help** (same topics, translated, including a **What's new** recap through **v2026.07.11.4**).

---

## Table of contents

1. [What is nextDash?](#1-what-is-nextdash)
2. [Before you begin](#2-before-you-begin)
3. [Installation and first launch](#3-installation-and-first-launch)
4. [Core concepts](#4-core-concepts)
5. [The dashboard at a glance](#5-the-dashboard-at-a-glance)
6. [Your first 30 minutes](#6-your-first-30-minutes)
7. [Adding bookmarks](#7-adding-bookmarks)
8. [Opening and using bookmarks](#8-opening-and-using-bookmarks)
9. [Keyboard navigation](#9-keyboard-navigation)
10. [Search, commands, and finders](#10-search-commands-and-finders)
11. [Organising pages and categories](#11-organising-pages-and-categories)
12. [Tags, notes, and metadata](#12-tags-notes-and-metadata)
13. [Smart collections and custom collections](#13-smart-collections-and-custom-collections)
14. [Layouts, themes, and appearance](#14-layouts-themes-and-appearance)
15. [Status monitoring and health](#15-status-monitoring-and-health)
16. [Config — complete walkthrough](#16-config--complete-walkthrough)
17. [Import, export, and backup](#17-import-export-and-backup)
18. [Browser extension](#18-browser-extension)
19. [Mobile, PWA, and touch](#19-mobile-pwa-and-touch)
20. [Efficient workflows](#20-efficient-workflows)
21. [Security and self-hosting](#21-security-and-self-hosting)
22. [Troubleshooting and FAQ](#22-troubleshooting-and-faq)
23. [Quick reference](#23-quick-reference)

---

## 1. What is nextDash?

nextDash is a **self-hosted bookmark dashboard** you open in your browser. There are:

- **No user accounts** — one installation, one dataset on disk.
- **No cloud sync** — your bookmarks live in files you control (typically a `data/` folder).
- **A keyboard-first design** — search, jump between pages, add bookmarks, and run commands without reaching for the mouse.

Think of it as a personal start page: bookmarks grouped by **page** (e.g. Work, Personal) and **category** (e.g. Dev, News), with powerful search and optional link-health tools.

### What you can do

| Area | Examples |
|------|----------|
| **Organise** | Multiple pages, categories, drag-and-drop reorder, pins, tags, notes |
| **Navigate** | Number keys for pages, arrow keys for bookmarks, search and command palette |
| **Add** | Quick-add line, full modal, paste URL, browser extension, HTML import |
| **Monitor** | Online/offline status, health scores, duplicate detection, stale bookmarks |
| **Customise** | 37+ themes, layouts (including launcher tiles), fonts, density, button bar position |
| **Preserve** | ZIP backup/restore, CSV export, browser bookmark import |

---

## 2. Before you begin

### What you need

- A machine or container to run nextDash (Docker or a single Go binary).
- A modern browser (Chrome, Firefox, Edge, Safari).
- For the extension: a reachable nextDash URL (e.g. `http://localhost:8080` or your Tailscale hostname).

### What nextDash is not

- Not a full browser bookmark sync replacement for every device (unless you self-host and expose it safely).
- Not multi-user SaaS — protect the URL if others can reach your network.

See [Security and self-hosting](#21-security-and-self-hosting) before exposing nextDash on the internet.

---

## 3. Installation and first launch

### Option A — Docker Compose (recommended)

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
    restart: unless-stopped
```

```sh
docker-compose up -d
```

Open `http://localhost:8080` in your browser.

### Option B — Build from source

```sh
go build -o nextDash && ./nextDash
```

Data is stored under `./data` by default.

### Cloning from GitHub

If you pull the source from GitHub instead of using the published container image:

| Branch | Use when |
|--------|----------|
| **`main`** (default) | **Self-hosting and Docker builds** — stable release tree with the app, extension folder, and docs |
| **`dev`** | Contributing code, running tests, or following active development |

```sh
git clone https://github.com/jordibrouwer/nextdash.git
cd nextdash
# already on main — build or use docker compose here
```

For day-to-day use you do **not** need to switch branches: clone the default **`main`** branch, run Docker Compose or `docker build`, and mount `./data` as usual. Choose **`dev`** only if you develop nextDash itself (see the **Contributing** section in the README).

### First launch flow

```
Install → Open URL in browser → Onboarding wizard (optional)
    → Dashboard (may be empty) → Config to add pages/bookmarks
    → Optional: What's new, layout tip, paste spotlight (desktop); config guided tours; feature tour; browser extension
```

1. **Onboarding** — Language, links, weather/date, classic, modern, or glass layout, search mode, smart collections, optional status monitoring, and a combined keyboard & mouse bookmark step. The finish step covers pages and first bookmarks when you start empty. You can skip and change everything later in **Config → General**.
2. **Empty dashboard** — Normal on first run. Use **+** (full add form) or **&** (quick-add) to add your first bookmark, or import from a browser HTML file (see [Import](#17-import-export-and-backup)).
3. **Config** — Click **config** in the header (or open `/config`). The **Help** tab mirrors much of this manual in shorter form.
4. **Guided config tours** — The first time you open **General**, **Bookmarks**, **Theme**, **Finders**, or other config tabs on a desktop-width window, an optional step-by-step spotlight tour may start automatically (see [Guided config tours](#guided-config-tours)).

---

## 4. Core concepts

Understanding five ideas makes everything else click.

### 4.1 Pages

A **page** is a separate tab on the dashboard (e.g. `main`, `Work`, `Home lab`). Each page has its own:

- Bookmark list  
- Category list  
- Optional page emoji and colour dot (double-click the tab to edit)

Switch pages with `0` (Inbox), `1`–`9`, `Shift + ←/→`, or the **pages** overview (`,`). Recently visited pages are kept in memory (and prefetched when you hover a tab), so switching back is usually instant without reloading every bookmark from the server.

### 4.2 Categories

**Categories** are sections within a page (e.g. `dev`, `news`, `tools`). In config they have an ID and display name. Bookmarks belong to one category (or uncategorised).

- Collapse/expand per category on the dashboard.  
- Drag the **grip** on a category title to reorder sections.  
- Press and hold a category header (~500 ms, not on sort buttons) to rename — double-click still works. The first rename may show a one-time **Got it** promo beside the header; **Esc** dismisses the promo and cancels rename.
- In **config → categories**, edits auto-save when you switch to another config tab or change the page selector (blocked if validation fails). Category lists are protected from accidental empty saves when bookmarks still reference those categories.

### 4.3 Bookmarks

Each bookmark has:

| Field | Purpose |
|-------|---------|
| **Name** | Label on the dashboard |
| **URL** | Link (http/https) |
| **Category** | Section on the page |
| **Shortcut** | Optional single key to open from dashboard (when not in an input) |
| **Tags** | Comma-separated, normalised to lowercase |
| **Note** | Plain text; searchable |
| **Pinned** | Stays at top of its category |
| **Icon / preview** | Favicon and optional title/description/image |
| **Status check** | Optional ping for online/offline |
| **Open count / last opened** | Usage tracking |

Pinned bookmarks stay at the top of their category (manual, A–Z, or recent sort). Notes remain searchable in fuzzy search and editable via `:note` or inline edit. Pin and note row icons were removed from the dashboard and from **Config → General**; there are no pin/note badges on bookmark rows.

### 4.4 Inbox

**Inbox** is a separate capture list for links you want to read or sort later — not bookmark pages. Items live in `data/inbox.json` on the server.

- Open with the **Inbox** header tab, **`0`** (when search is closed), or **`:inbox`**.  
- Add links by pasting a URL on the dashboard (`Ctrl+V`) and choosing **Save to Inbox**, via the browser extension, or through the API.  
- Filter **All** / **Unread**, search, and browse date groups. **Promote** turns a link into a full bookmark; **Triage** walks unread items one by one.  
- Toggle under **Config → General → Enable Inbox page**; set **Paste URL default** to skip the choice dialog.

### 4.5 Config vs dashboard

| Dashboard `/` | Config `/config` |
|-----------------|------------------|
| Daily use: open, search, quick-add | Structure: pages, categories, bulk edit |
| Keyboard-first | Split-view bookmark editor, stats, backups |
| Live layout and themes | Save bar for many settings |

Changes in config often apply to the dashboard after **Save** (some toggles autosave). Config only writes data that actually changed — a small settings edit does not re-upload every page of bookmarks — and you get a short *Saving…* / *Saved* toast on the right when save completes.

---

## 5. The dashboard at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  Date/time · mini status          pages · health · config   │
├─────────────────────────────────────────────────────────────┤
│  Title (optional)                                             │
├─────────────────────────────────────────────────────────────┤
│  [Smart collections]  [Tag collections]  [Categories…]      │
│    └─ bookmark rows (icon · name · shortcut)                │
├─────────────────────────────────────────────────────────────┤
│  Rotating tips (optional)                                     │
│  [ + ] [ > ] [ : ] [ ? ] [ * ] [ ! ]   ← button bar         │
└─────────────────────────────────────────────────────────────┘
```

Side rail layout (optional — **Config → General → Layout → Button bar position → Side rail**):

```
┌──┬────────────────────────────────────────────────────────┐
│+ │  [header: date · health · config · pages]              │
│──│                                                         │
│> │  [Smart collections]  [Tag collections]  [Categories…] │
│? │    └─ bookmark rows                                     │
│: │                                                         │
│* │  Rotating tips (optional)                               │
│──│                                                         │
│/ │                                                         │
│! │                                                         │
│★ │                                                         │
└──┴────────────────────────────────────────────────────────┘
```

### Header

- **Date/time** — Click for a **week overview** popover (today highlighted; optional **Open calendar** link when configured in General). Optional weather line below.  
- **health** — A **heartbeat icon** linking to `/health`, with an inline pill counter (e.g. `3`) when broken or warning bookmarks exist — red for broken, amber for warnings, hidden when healthy (**v2026.07.09**, styled like the inbox tab). When broken links are counted, the link opens `/health?filter=broken`. On by default (toggle under **Config → General → Advanced → Header & buttons**).  
- **config** — Settings and bookmark management.  
- **pages** — Overview of all pages with counts (`,`).

### Button bar / side rail

The button bar can appear as a **floating bottom bar** (default) or as a **44 px left side rail** — set via **Config → General → Layout → Button bar position** or the `:buttonbar` command.

**Bottom bar** — buttons float centred at the bottom of the viewport.

| Button | Key | Role |
|--------|-----|------|
| `+` | `+` | Full new-bookmark modal |
| `>` | `>` | Search |
| `:` | `:` | Command palette |
| `?` | `?` | Finders (external search shortcuts) |
| `*` | `*` | Recent bookmarks on this page |
| `!` | `!` / `F1` | Keyboard cheat sheet |

**Side rail (left)** — 44×44 px square cells stacked vertically on the left edge; the dashboard grid shifts right by 44 px to clear the rail. On mobile (≤768 px) the rail automatically reverts to a centred bottom bar.

| Position | Button | Key | Role |
|----------|--------|-----|------|
| Top | `+` | `+` | Full new-bookmark modal |
| *(spacer)* | — | — | — |
| | `>` | `>` | Search |
| | `?` | `?` | Finders |
| | `:` | `:` | Command palette |
| | `*` | `*` | Recent bookmarks |
| | `/` | `/` | Tag cloud (directly under recent in the rail flow) |
| *(separator)* | — | — | — |
| | `!` | `!` / `F1` | Keyboard cheat sheet |
| Bottom | `★` | — | What's new |

Hover a button on desktop for a tooltip with shortcuts. In side-rail mode, tooltips appear to the **right** of the rail.

### Deep links from Health

Health can open a bookmark on the dashboard with:

`/?page=<pageId>&bookmark=<index>&category=<categoryId>`

The dashboard switches page, expands the category, scrolls to the row, and highlights it briefly.

---

## 6. Your first 30 minutes

Follow this path once; later you will mix steps freely.

| Step | Action | Where |
|------|--------|--------|
| 1 | Complete or skip onboarding | First visit |
| 2 | Open **config → pages** — add or rename pages | `/config#pages` |
| 3 | Open **config → categories** — create sections per page | `/config#categories` |
| 4 | Add 3–5 bookmarks with **&** quick-add | Dashboard |
| 5 | Press **>** and search by name | Dashboard |
| 6 | Press **!** and skim the cheat sheet | Dashboard |
| 7 | Enable a theme you like | **config → general → appearance** |
| 7b | (Optional) Let the **General**, **Bookmarks**, and **Theme** guided tours run when you open those tabs | `/config#general`, `/config#bookmarks`, `/config#colors` |
| 8 | Create a ZIP backup | **config → backups** |
| 9 | (Optional) Install browser extension | `extension/` folder |
| 10 | (Optional) Import old browser bookmarks | **config → backups → Import from Browser** |

**Goal:** One page with categories, a handful of bookmarks, search working, and a backup file saved.

---

## 7. Adding bookmarks

### 7.1 Quick-add (`&`) — fastest for simple links

1. Focus the dashboard (click empty space; no input focused).  
2. Press **`&`**.  
3. Type one line: `name | url | shortcut` (shortcut optional).  
4. Press **Enter**.

Example: `GitHub | https://github.com | g`

Favicon is fetched automatically when possible.

### 7.2 Full modal (`+` or `Ctrl+Shift+A`)

- **`+`** on the dashboard (toolbar **+** button uses the same shortcut).  
- **`Ctrl+Shift+A`** from anywhere on the dashboard when not typing in a field.  
- **`:new`** from command mode.

The modal includes page, category, preview, tags, note, pin, and status options.

### 7.3 Paste a URL (`Ctrl+V`)

With the dashboard focused and no text field active, paste a URL. A choice dialog offers **Save to Inbox** or **Add bookmark** (full modal pre-filled). Set a default under **Config → General → Paste URL default** (*Ask each time*, *Always add bookmark*, or *Always save to Inbox*). Paste is ignored while **inline edit** or the **tag word cloud** is open. If paste cannot open the form (no active page, Inbox disabled, or the feature is blocked), a notification explains what to do.

### 7.4 Inline edit after long-press

Long-press a bookmark row (~500 ms, not on the drag strip) to edit in place on the dashboard — including rows shown in **smart collections** (Today, Recently opened, etc.). The editor opens in a **nearly opaque panel** (~96% background) with a **tour-like full-page blur** behind it — including in **glass** and **launcher** layouts, where other tiles blur but the form stays sharp and readable. The form shows field-level validation errors while you type. Success and error toasts use your UI language. **Save** or **Ctrl+Enter** writes changes to disk immediately (no separate dashboard Save button); **note** and **tags** sync to the bookmark on its category column and in the global store. Press **ESC** or click outside to dismiss; both use an in-app confirm dialog if you have unsaved changes — **Esc** also works while the inline-edit discoverability promo is open (dismissing the promo cancels the form). **Page switches**, **tag-filter** changes, and **config sync** from another tab also confirm before discarding unsaved edits. Background dashboard re-renders are skipped while unsaved inline edits are open. Keyboard grid navigation, **swipe page change**, and **Ctrl+V** paste are paused or blocked while the editor is open. Delete confirms first (modal above the editor), then persists right away; undo in the toast restores the bookmark on the server and in smart-collection views too.

### 7.5 Config → bookmarks (bulk and detail)

**config → bookmarks**: master/detail split inside one fused surface (**v2026.07.04**) — filters and bulk actions above the split; bookmark list on the left (master pane), detail editor on the right (detail pane). Best for many edits, tags, notes, favicon upload, and bulk actions.

The **Context** panel (page and category switcher for the list below) starts **collapsed** — expand it when you need to change page or category without leaving Bookmarks. Reorder pages, archive, templates, icons, and merge categories on the dedicated **Pages** and **Categories** tabs (links in the Context footnote). Open/closed state is remembered across visits. Below that you pick the active page, filter by category, and sort the list. **+ Bookmark** opens a small menu: **Add & edit** creates a blank row in the detail panel (Save when ready); **Quick add (⚡)** opens the full new-bookmark form and saves to disk immediately — the new row appears in the list right away (search/category filters adjust so you can see it). In the detail panel, **category** and **tags** stay visible (tags sit directly below Category); shortcut, icon, previews, and status sit under **More options**. Select multiple rows for the **bulk toolbar** — **Move to** (page + category + Apply), pin, status, favicon refresh, **tags** (a comma-separated input with Add/Replace/Remove mode, applied to every selected bookmark), and delete. Bookmark changes apply to the dashboard only after **Save** in the config header.

The breadcrumb row shows your current location (e.g. `bookmarks › Work › dev`). Save mode (**Requires save**, **Auto-save**, **Read-only**, **Save colors**) and the save status line sit in the **save row** beside **Save**, not in the breadcrumb.

On a **phone** (≤768px), opening `/config#bookmarks` shows a clear *desktop only* card with a link back to the dashboard — use a wider window for the split-view editor.

All bookmark lists in config (per-page editor, tags tab, stats) read from one **central bookmark store**, so tags and edits stay in sync across tabs and after guided tours.

The first time you open this tab on a desktop-width window, a **10-step guided tour** walks through these areas (see [Guided config tours](#guided-config-tours)).

### 7.6 Browser extension

Save the current tab to a chosen page or to **Inbox** (see [Browser extension](#18-browser-extension)).

### 7.7 Import

HTML export from Chrome/Firefox/Edge (see [Import, export, and backup](#17-import-export-and-backup)).

### 7.8 Inbox — capture links for later

**Inbox** is for links you have not sorted into pages yet.

1. Open **Inbox** — header tab, **`0`**, or **`:inbox`**.  
2. **Add** — paste `Ctrl+V` on the dashboard and choose *Save to Inbox*, use the extension **Save to Inbox**, or rely on *Always save to Inbox* in General settings.  
3. **Browse** — filter *All* / *Unread*, search, and scroll date groups. Unread items show a badge on the Inbox tab.  
4. **Act on a row** — *Open* in a new tab, *Promote* to open the new-bookmark form pre-filled, or *Delete* (undo in the toast).  
5. **Triage** — click **Triage** or run **`:inbox triage`** to walk unread items one by one: `J`/`K` move, `O` open, `P` promote, `R` keep (mark read), `D` delete, `Esc` close.

The first visit may show a short intro modal. Replay it from **Config → Advanced → System → Reset Inbox intro modal**.

### Duplicate URLs

nextDash warns when a URL already exists on the same page (canonical match: trailing slash, hash, host letter-case, and default ports are ignored — e.g. `https://x` ≡ `https://x:443`). You can still save anyway in the extension or modal when needed. Use **`:duplicate`** in search or the Health view to find duplicates across all pages. Imports **skip** duplicates and show a preview: e.g. **12 new, 3 conflicts (skipped)**.

---

## 8. Opening and using bookmarks

### Mouse

- Click the bookmark name (or icon area) to open the URL.
- Bookmarks **without a display name** show the site **hostname** in the grid (e.g. `docs.example.com`); hover or keyboard focus shows the **full URL** in the tooltip.
- Respect **open in new tab** setting from config.  
- **Launcher layout**: large tiles; click plays a short pulse animation.

### Keyboard

- Start grid navigation with **Tab**, a click on a bookmark, **hold `G` then `1–9`** / **`GG`**, or the **first arrow key**; then use **plain arrow keys** to move the selection (`Shift+←/→` changes pages only).  
- After switching pages with **1–9**, the **first visible bookmark** on the new page is selected automatically.  
- **Collapsed categories** and **launcher tiles dimmed by search** are skipped by keyboard navigation.  
- **Category headers** are keyboard-focusable: **Enter** or **Space** toggles collapse (`aria-expanded` updates).  
- When you move the **mouse over bookmarks**, the stale keyboard highlight **softens** until your next keyboard move.  
- **Enter** or **Space** opens the selected row.  
- If the bookmark has a **shortcut** letter and you are not in an input, press that key to open. For shortcuts starting with **`G`**, use a **quick tap** (press and release); **hold `G`** (~300 ms) or **`G` then a digit / `P` / second `G`** activates category jump instead.

### Hyprland / special setups

If **Hypr mode** is enabled in settings, bookmark clicks may be routed to your window manager instead of the browser default.

### Usage tracking

Each open increments **open count** and updates **last opened**. This powers smart collections (“Recently opened”, “Most used”, “Stale”) and stats.

### Recent panel (`*`)

Shows bookmarks you opened recently **on the current page** (not global). Each row shows rank, a recency badge, and open count (**v2026.07.05**). Use **`↑`/`↓`/`Home`/`End`** to move between items and bulk-open buttons. From the panel you can open one or use bulk actions aligned with **`:open last`**.

---

## 9. Keyboard navigation

### 9.1 Page navigation

| Keys | Action |
|------|--------|
| `0` | Open **Inbox** (when search is closed) |
| `1`–`9` | Jump to bookmark page tab by position (tabs use `tablist` / `aria-selected` for screen readers) |
| `←` / `→` / `Home` / `End` | Move focus between page tabs when a tab is focused; `Enter` / `Space` activates the tab |
| `Shift + ←` / `Shift + →` | Previous / next page (plain arrows move bookmarks, not pages) |
| `,` | Page overview modal — `↑`/`↓` or `Tab`/`Shift+Tab` move between pages; `Enter` or `Space` switches page; focus stays trapped inside the panel; closing restores focus to the trigger |

### 9.2 Bookmark grid

| Keys | Action |
|------|--------|
| `↑` `↓` `←` `→` | Move selection (first arrow key starts navigation if none selected) |
| `1`–`9` (page switch) | Also selects the first visible bookmark on the new page |
| `Tab` / `Shift+Tab` | Linear next/previous bookmark when a row is selected; at the first/last bookmark, Tab exits to the header/FAB |
| `G` then `1`–`9` | Jump to nth visible category or smart collection, select first bookmark (also: hold `G` ~300 ms, then digit — first hold may show a one-time **Got it** hint) |
| `G` then `P` | Jump to first pinned bookmark on the page |
| `GG` | Jump to very first bookmark (second `G` while chord pending) |
| Quick tap `G` | Open bookmark shortcuts starting with `G` (`g`, `ga`, `g1`, …) — not category jump |
| `Ctrl + Home` / `Ctrl + End` | First / last bookmark on the page (`Cmd` on Mac) |
| `Enter` / `Space` | Open selected |
| `Esc` | Clear selection and move focus to the first bookmark; may undo last drag reorder |

### 9.3 Bookmark actions

| Keys | Action |
|------|--------|
| `;` | Inline-edit selected row (page switches confirm before discarding unsaved edits) |
| `Shift + M` | Move to… (category or another page); popover receives focus — use arrows and `Enter` inside it |
| `Shift + T` | Quick-tag selected row (popover receives focus — `↑`/`↓` navigate; `Enter`/`Space` toggle tag and advance to next; `✓` on tags already applied) |
| `Shift + D` | Quick-delete selected row (popover receives focus; undo in toast) |
| `Ctrl + C` | Copy URL (row flashes green) |
| `[` | Toggle hover preview card on selection |
| `Delete` | Delete selected bookmark (confirmation dialog; `Shift+D` uses the quick-delete popover instead) |

### 9.4 Cheat sheet

Press **`!`** or **`F1`**. Focus lands in the filter box automatically. Type to narrow the list. When the **side rail** is active, a **Layout (side rail)** section lists tab order and `:buttonbar` hints. The cheat sheet does not open while the **page overview** (`,`), **tag cloud**, or another blocking overlay is open. On first open (desktop), a one-time **Got it** balloon may appear beside the modal — dismissing it does not close the cheat sheet.

Rebind shortcuts in **config → keyboard** (open from Help or the keyboard link). **Export** / **import** rebindable keys as JSON; fixed cheat-sheet defaults cannot be changed. Rebind checks for conflicts with fixed or existing bindings before save.

### 9.5 Blocking overlays & focus

While any of these are open, the bookmark grid behind them is **inert** (not clickable) and keyboard focus stays inside the overlay until you close it:

| Overlay | Shortcut / trigger |
|---------|-------------------|
| Shortcut search | `>` (also `:` / `?` modes in the same panel) |
| Cheat sheet / recent | `!` / `F1`, `*` |
| Tag word cloud | `/` (desktop, when enabled) |
| Page overview | `,` |
| Quick-add omnibox | `&` |
| Quick move / quick tag / quick delete | `Shift+M` / `Shift+T` / `Shift+D` |
| Inline edit | `;` |
| App modal | e.g. new bookmark `+`, confirmations, recent bookmarks `*` |

**Tab** / **Shift+Tab** cycle within the open overlay. **Escape** closes it and restores focus to the control that opened it (or the bookmark grid). One-time **Got it** discoverability balloons dismiss with **Esc** without trapping the overlay open. A `MutationObserver` re-syncs dashboard `inert` when overlays are added or removed so the grid is not left stuck non-interactive. With an **active tag filter**, only the bookmark list is `inert` — the filter banner and bulk toolbar stay interactive while the tag cloud is open. Grid shortcuts **`;`**, **`Shift+M`**, **`Shift+T`**, and **`Shift+D`** work on the keyboard-selected row when no overlay is open.

---

## 10. Search, commands, and finders

Three input modes share one overlay; switch with keys or footer chips.

```
>  search     — find bookmarks, filters, history
:  commands   — :layout, :theme, :open last, …
?  finders    — ?g query → Google, etc.
/  fuzzy      — when search mode is fuzzy (config)
@  global     — search all pages at once
```

### 10.1 Search (`>`)

- Type to filter bookmarks on the current page (or configured scope).  
- On desktop, the highlighted match receives keyboard focus (not only a visual highlight). Opening search moves focus into the panel; closing search restores focus to the opener and clears grid `inert`.  
- First use of `>`, `:`, or `?` may show a one-time **Got it** balloon beside the search field (desktop).  
- Empty state: recent queries and saved searches as chips; **`←`/`→`** select a chip, **`Enter`** applies it; filter hints and finders below.  
- **Colon behaviour** — a lone **`:`** from the dashboard opens command mode. With search already open and text in the bar, **`:`** inserts filter syntax (`category:`, `tag:`, …) instead of switching modes.  
- **Filters** (type or pick from autocomplete — one expandable **Filters** group in the panel):

| Filter | Example |
|--------|---------|
| `category:` | `category:dev` |
| `tag:` | `tag:work` |
| `page:` | `page:2`, `page:all`, `page:current` |
| `status:` | `status:online`, `status:broken`, `status:pinned`, … |

While typing a partial value (e.g. `status:on`), autocomplete stays visible until the token is complete. `status:online` / `status:offline` use persisted reachability on monitored bookmarks.

**Bookmark shortcuts starting with `G`** — a quick tap on `G` opens the shortcut search bar (`g`, `ga`, `g1`, …). Hold `G` (~300 ms) or press `G` then a digit / `P` / second `G` activates category jump instead (see §9.2).

### 10.2 Tag word cloud (`/`, desktop)

When **Tag cloud (/)** is enabled (config → general → Header & Buttons, on by default on desktop):

- Press **`/`** on the dashboard (search closed) or click the **/** button to open a word cloud of all tags (size = usage). With the **side rail**, the button sits under **\*** recent and the modal opens to the **right** of the rail, growing with tag count instead of using a fixed clipped height. With an **active tag filter**, the modal anchors **left below the filter banner** / **/** FAB (not centered over bookmarks).
- **Click** or **`Enter`** / **`Space`** on a tag **toggles** it in the filter; the modal **stays open** so you can combine several tags.
- **OR logic** — the dashboard shows bookmarks that have **any** of the selected tags (not all).
- **Filtered view** — matching bookmarks stack in a **vertical list** (all layout presets, including launcher); only visible rows are in the DOM.
- **Bulk toolbar** — when matches exist, a bar under the filter chips offers **Open all** / **Open first N**, **Copy links**, **Move**, and **Delete** for every filtered bookmark on the page. The toolbar stays **clickable while the tag cloud modal is open**. Bulk move/delete shows one grouped toast (e.g. *3 bookmarks moved*).
- Selected tags are highlighted in the cloud; active filters appear as **chips** under the page title (each chip has its own **×** to remove one tag) and on the **/** FAB (`#work` or `#work +1` when more than one — no duplicate *Filtering* tooltip).
- **Escape** in the cloud closes the modal (filter remains). **Escape** on the dashboard (cloud closed) clears all tag filters and returns focus to bookmarks.
- **Clear tag filter** in the cloud footer removes every selected tag (`Enter` / `Space` on **Close** or **Clear** works too).
- **Arrow keys** move between tags and **Clear tag filter**; `Tab` stays inside the modal.
- Hidden on mobile / narrow layouts.

With tag cloud off, or inside the search overlay, **`/`** follows your fuzzy/interleave search setting (see below).

### 10.3 Fuzzy search (`/`)

When tag cloud does not take precedence: ranked matching on name, URL domain, tags, and note. Best for “I know part of the name”.

### 10.4 Global search (`@`)

Search **all pages**; each result shows which page it belongs to.

### 10.5 Commands (`:`) — selected examples

Type lone **`:`** to open the palette. **Five collapsible groups** list commands (Bookmarks, Search & navigate, Look & layout, Smart collections, Settings & tools) — click a group header to expand completions. Your **recent commands** (up to five) appear at the top when you reopen lone **`:`**. After **`Enter`**, toggle and view commands **keep the palette open**; rows refresh with `(on)`/`(off)`, `✓`, or a brief flash instead of closing or showing toasts.

Use **`Enter`** or **`Space`** on a highlighted row to run it (including after autocomplete expands a group such as `:button`).

| Command | Description |
|---------|-------------|
| `:new` / `:add` | New-bookmark modal / quick-add omnibox (`&`) |
| `:note` | Edit note on selected bookmark |
| `:move` / `:edit` / `:copy` / `:quicktag` (`:qt`) | Move, inline-edit, copy URL, or open quick-tag popover (`Shift+T`) on keyboard-selected bookmark |
| `:pin` / `:unpin` | Toggle pin |
| `:tag` | List tags; browse by tag in palette (`:tag work`, `:tag:work`) without changing dashboard |
| `:tag +name` / `:tag -name` | Add/remove tag on keyboard-selected bookmark |
| `:category` / `:cat` | Jump to category or smart collection by number or name |
| `:filter <tag>` / `:filter clear` | Apply or clear dashboard tag filter (OR, same as tag cloud) |
| `:remove` | Delete selected |
| `:sort order\|az\|recent` | Sort mode for the focused category |
| `:open all` / `:open pinned` | Open all or pinned bookmarks on page (safe batch cap) |
| `:open tag <name>` / `:open category <name>` | Open bookmarks matching tag or category on current page |
| `:open last [n]` | Open N recently opened on page (default 5, max 50) |
| `:page` | Switch page by name or number (palette stays open, `✓` on current) |
| `:recent` / `:overview` / `:cheat` / `:whatsnew` / `:reload` | Recent modal (`*`), page overview (`,`), cheat sheet, what's new, reload |
| `:inbox` / `:inbox triage` | Open Inbox (`0`) or triage unread items one by one |
| `:config [section]` | Open config or tab (`bookmarks`, `backups`, `stats`, …) |
| `:stale [days]` | List stale bookmarks |
| `:health [filter]` | Open health page — `broken`, `duplicate`, `stale`, `refresh`, … |
| `:health page [n]` | Health filtered to a specific page |
| `:duplicate` / `:duplicates` | Scan for duplicate URLs across all pages (opens Health duplicates view) |
| `:find <text>` / `:find clear` | Hide non-matching tiles on page / clear filter |
| `:goto <url>` | Navigate to URL or domain |
| `:goto config` / `stats` / `health` | Quick navigation to config, stats, or health |
| `:dark` / `:title` / `:lang` / `:animations` / `:status` / `:opacity` | Display and theme toggles |
| `:collections` | Toggle smart collections (today, recent, stale, most used) |
| `:backup` / `:export` | Open config backups or download ZIP backup |
| `:metadata` | Health missing previews or config bookmarks |
| `:tour` / `:promo` | Start feature tour or reset discoverability promos |
| `:layout …` | default, compact, cards, masonry, list, launcher, … (presets — not layout version) |
| `:layoutversion` | List classic / modern / glass |
| `:layoutversion modern` / `classic` / `glass` / `toggle` | Switch layout version (`toggle` cycles classic → modern → glass) |
| `:theme <name>` | Switch theme |
| `:density comfortable\|compact\|dense` | Row density |
| `:columns <1-6>` | Column count |
| `:buttonbar bottom\|bottom-left\|bottom-right\|side-left` | Button bar position (`side-left` = vertical rail on the left edge) |
| `:save` / `:saved` | Save / list saved searches |
| `:history` / `:history clear` | Search history |

### 10.6 Finders (`?`)

Format: `?shortcut query` — e.g. `?g nextdash` if `g` is configured to `https://www.google.com/search?q=%s`.

Configure finders in **config → finders** (desktop):

- **+ Add finder** — appends a new row at the bottom of the table and focuses the name field; the existing list stays visible (no reload needed).
- **Filter** — narrow the list by name, shortcut, URL, or tags; **✕** or `Escape` clears.
- **Reorder** — drag the grip or press **↑** / **↓** on a focused row; order auto-saves after ~600 ms with a localized sync toast.
- **Usage stats** — each row shows use count and last-used date (refreshed when you open the tab).
- **Stable ids** — remove/reorder cannot target the wrong row; duplicate shortcuts are highlighted and block save until resolved.
- Use `%s` in the search URL where the query is inserted (e.g. `https://www.google.com/search?q=%s`).

### 10.7 In-page filter (`:find`)

Temporarily hides bookmark tiles that do not match. Clear with `:find clear` (or run `:find` alone).

---

## 11. Organising pages and categories

### Reorder bookmarks

- Drag the **left strip** of a row to reorder within a category or drop on another category.
- Reorder saves **debounce 1 second** (like category order) and show a localized success toast.
- **Esc** undoes the last reorder if the debounced save has not completed yet.

### Reorder categories

- Drag the **grip** on the category title on the dashboard, or drag rows in **config → categories** (or focus a row and press **↑** / **↓**).
- Order in **config → categories** saves automatically after a short debounce (~600 ms) with a localized sync toast.

### Reorder pages

- Drag the **grip** on a row in **config → pages**, or focus a row and press **↑** / **↓**.
- Order saves automatically after a short debounce (~600 ms) and shows a localized sync toast.
- **Archive** hides a page from the dashboard and page picker without deleting its bookmarks (restore from **config → pages**, the **Context** panel on Bookmarks when expanded, or the archived list there).

### Move between pages

- **Shift+M** on dashboard, or detail panel in config, or bulk move in config.

### Page customisation

Double-click a page tab **on desktop or tablet landscape** (not on mobile — avoids accidental renames on touch):

- Set **emoji** icon  
- Choose **colour dot** (8 accents)

Use **config → pages** to rename a page on any device.

### Sorting

- Each category header has **A–Z** and **Recent** toggles at full visibility (including **Other** and unknown-category blocks); click an active toggle again to return to manual drag order. Sort buttons are keyboard-focusable; **←** / **→** move between them without collapsing the category.
- Sort is view-only: bookmark order in data is unchanged until you drag (manual mode only).
- **`:sort`** applies to the category you are focused in (keyboard selection or first category as fallback) and shows the category name in the command palette.

### Collapse

Click category header or chevron, or focus the header and press **Enter** / **Space**. **Always collapse categories** can be set in general settings.

---

## 12. Tags, notes, and metadata

### Tags

- Comma-separated in modal, inline edit, or config detail.  
- Stored lowercase, trimmed, deduplicated.  
- **Search (`>`):** `tag:work` filters results in the search overlay (partial match); dashboard layout unchanged.  
- **Dashboard tag cloud (desktop):** `/` or / FAB — toggle one or more tags while the modal stays open; **OR match** (bookmarks with any selected tag); per-tag filter chips in the header; **Escape** on the dashboard clears all filters.  
- **Command palette (`:`):** `:tag work` lists bookmarks in the palette only; `:tag +work` / `:tag -work` mutate tags on the selected bookmark.  
- **config → tags** (desktop): global tag management across all pages.  
  - **Word cloud:** dashboard-style popularity scaling — larger tags mean more bookmarks; tier colours and light animations; click a chip to scroll to that tag in the list.  
  - **List:** column headers (Tag / Usage / Actions), usage bar per row, sorted by bookmark count; scrolls with the config page (no inner scroll panel).  
  - Expand a row for bookmarks with page name, category, **Open** (jumps to the bookmark in Config → Bookmarks), and **− tag** (remove from one bookmark).  
  - **Rename** merges into an existing tag when the new name already exists (with confirmation).  
  - **Search** opens Bookmarks with `tag:name` in the filter.  
  - **Filter** narrows the cloud and list; **✕** or **Escape** clears it; empty filter shows a short hint in the list.  
  - **↑/↓** on a focused tag row moves between rows. Changes **save automatically** (dashboard sync toast).  
  - **Undo** after rename/delete/remove-from-bookmark restores all pages and re-persists (cross-page safe).  
- **Tag collections**: optional dashboard group per tag (general settings).

### Notes

- Plain text; visible in row badge, hover preview, search.  
- Edit via **`:note`**, inline edit, or config.

### Previews and favicons

- Auto-fetch title/description/image when adding URLs (if enabled).  
- **`[`** toggles preview card on keyboard focus.  
- **Show favicons** — **Config → General → Bookmarks** or `:favicons on/off` on the dashboard.  
- **Fetch favicon** in config detail or health actions.

### Shortcuts

- Single character per bookmark; must be unique across **all pages** when set.  
- Shown in the shortcut column; included in screen reader labels.

---

## 13. Smart collections and custom collections

### Smart collections (built-in)

Enabled in **config → general → smart collections**:

| Collection | Shows |
|------------|--------|
| **Today** | Bookmarks matching time-of-day keyword sets |
| **Recently opened** | Latest activity on allowed pages |
| **Most used** | Highest open counts |
| **Stale** | Not opened within threshold days |

Each can be limited to certain pages and item limits (`0` = unlimited).

Cross-page bookmark data loads at startup only when smart collections, tag collections, or **Use shortcuts from all pages** need it — faster startup when those features are off.

You can **long-press** or press **`;`** on a smart-collection row to inline-edit or delete; changes apply to the real bookmark on its page and stay in sync across collection columns.

### Custom collections

**config → collections**: name, icon, AND/OR rules on tag, category, or shortcut. Each rule's value field autocompletes from the tags, categories, and shortcuts already in use, so you rarely type a full value (shortcut suggestions keep their original casing). Appear as dashboard groups above regular categories.

### Tag collections

When enabled, one auto-group per tag that meets minimum count.

---

## 14. Layouts, themes, and appearance

### Layout version (Classic / Modern / Glass)

nextDash has three **layout versions** — same bookmark grid and categories, different visual polish:

| Version | What it does |
|---------|----------------|
| **Classic** | Original dashboard styling and spacing (default). |
| **Modern** | Refreshed visuals — updated row highlights, tooltips, and chrome — same structure underneath. |
| **Glass** | Translucent iOS-style surfaces with backdrop blur on dashboard, config, and health chrome. |

**Themes control all colors** in every version; switching layout version does not change your theme.

**Where to switch**

- **Config → General → Layout → Layout version** — dropdown with a live description under the control.  
- **First-run onboarding** — dedicated layout step with classic, modern, and glass previews.  
- **Dashboard command mode** — `:layoutversion` lists options; `:layoutversion modern` / `:layoutversion classic` / `:layoutversion glass` applies one; `:layoutversion toggle` cycles classic → modern → glass.  
  (This is **not** the same as `:layout`, which switches **presets** like launcher or compact — see below.)

**Post-onboarding prompts** — On desktop, an unread **What's new** release may open automatically after onboarding or on dashboard load. Last-seen release and dismissed promos sync via **`settings.discoverabilityState`** in `settings.json` across browsers (**v2026.07.01.1**). **Rotating footer tips** above the action buttons wait **one minute** after you finish or skip first-run onboarding before they start (they also refresh on page change without resetting that delay). **One-time discoverability promos** (desktop only) show **Got it** balloons beside features the first time you use them — search modes (`>`, `:`, `?`, filters), grid arrow navigation, **G+jump** (hold `G` ~300 ms or `G` then `1`–`9`, `G+P`, or `GG` — quick tap `G` opens shortcuts starting with `G`; the G+jump hint may appear on hold and retries when blocked by What's new or another overlay), smart collections, inline edit, tag cloud, tag-filter bulk toolbar, recent bookmarks (`*`), preview (`[`), quick-add (`&`), week overview, category collapse, **category rename** (first long-press or double-click rename; **Esc** on the promo cancels rename), quick move (`Shift+M`), quick tag (`Shift+T`), quick delete (`Shift+D`), page overview (`,`), keyboard cheat sheet (`!` / `F1`), and **weather location** when geolocation is blocked. Dismiss with **Got it** or `Esc`; they do not repeat after confirmation. **Layout-versions** (classic layout), **paste URL**, and **preview cards** spotlights are separate one-time hints that may follow in the same session — there is no queue bar or **Later this session** coordinator. Reset layout/paste/preview, **Reset all dashboard promos**, or individual promo resets from **config → general → Advanced → System & tools → Tours & onboarding**. Resetting the layout prompt from config when no dashboard tab is open queues a replay for the next dashboard visit.

**Glass presets** — On glass layout, **terminal** tiles are transparent until hover; **masonry** uses subtle borders with glass on hover; **launcher** chips use lighter surfaces and a gentler hover lift.

### Layout presets

| Preset | Character |
|--------|-----------|
| **Default** | Classic multi-column grid |
| **Compact / Cards / Masonry / List** | Density and visual style |
| **Launcher** | Large favicon tiles; enable via **Config → General → Layout** or `:layout launcher` in search |

### Themes

- 37+ built-in families (dark/light pairs).  
- **config → theme** tab (`#colors`) — four subtabs: **Dark**, **Light** (default palettes), **Custom themes** (your saved palettes), and **Packaged themes** (edit built-in families such as Cherry Graphite). Live preview applies to palette cards only; a contrast hint warns when text vs background is too weak. **Export** / **import** JSON, **Undo**, and **↑/↓** reorder for custom themes. Press **S** or **Save colors** to persist. On mobile the tab is read-only (viewer banner).  
- **General → Appearance → Theme** — pick the active theme for the whole app (built-in or saved custom).  
- **Auto dark mode** follows system light/dark for built-in theme pairs; your saved theme id stays stable (the app applies the matching dark/light variant without overwriting the palette name). Disabled with a fully custom theme.

The first time you open the **Theme** tab on a desktop-width window, a **9-step guided tour** creates a temporary **Tour demo** palette, saves it, activates it on General, then removes it (see [Guided config tours](#guided-config-tours)).

### Config → pages & categories (list tabs)

Desktop list tabs (**pages**, **categories**, **tags**, **finders**, **collections**) share the same layout pattern introduced in **v2026.06.31**: a short intro paragraph, toolbar with **+ Add** and filters, then the list. On **Classic** layout, toolbar and list sit inside one elevated surface card. Empty states include a clear next step (e.g. Tags → open Bookmarks to add a tagged bookmark; Collections → start editing a new collection).

- **Pages** — add, rename, **archive** (hide without deleting bookmarks), remove, drag or **↑/↓** reorder; order auto-saves (~600 ms). **Usage** column shows a popularity bar and bookmark count (Tags-style). Page dropdowns skip archived pages. Desktop only (mobile shows a toast). On **Bookmarks**, the **Context** panel only switches the active page — full page editing stays here.
- **Categories** — per-page list with icon, name, **merge**, remove; drag or **↑/↓** reorder with auto-save; **Usage** column with popularity bar and bookmark count (Tags-style). Switching the page selector **or leaving the Categories tab** flushes pending edits first (blocked if validation fails). Delete asks what to do with in-use bookmarks (move, uncategorize, or delete). Breadcrumb shows the selected page. On **Bookmarks**, **Context** only switches the active category filter. Desktop only for full editing.

### Typography and density

- Font preset, size, weight.  
- **`:density`**, **`:columns`**, **`:fontsize`** from commands.

### Header and background

- Optional title, background dots, gradient/image.  
- **Button bar position** — centre bottom, corner dock, or **left side rail** (`:buttonbar side-left`). The side rail places navigation buttons in a 44 px vertical strip on the left edge (`/` tag cloud directly under `*` recent); the dashboard grid shifts right to clear it. On mobile it reverts to a centred bottom bar automatically.

### What’s new

**★** opens release notes from a **corner FAB** below the `/` tag cloud on desktop (bottom-left by default; mirrored when the button bar is docked left/right; pinned at the bottom of the side rail). It is **not** in the centre dock toolbar. **Config → Help** also has **Show what's new** at the top. The latest release loads first; scroll to load up to the **25 most recent** versions (each fetches its own JSON on demand, with a loading skeleton). The same recap — including **v2026.07.11.4** smoother dialogs (keyboard and screen-reader focus handed back cleanly when a dialog closes, no console warnings); **v2026.07.11.3** bulk tags in the config bookmarks bulk toolbar (add, replace, or remove tags across every selected bookmark at once, with tag autocomplete); **v2026.07.11.2** tags moved above the fold in the bookmark forms (out of *More options*, right under Page/Category), the dashboard inline editor reordered to match (Page → Category → Tags → Note), autocomplete on custom-collection rule values, and a back/forward-cache fix; **v2026.07.11** clearer General settings (busiest sections split into labelled sub-groups: Localization → language / date & time, Appearance & Style → theme / text / extras, Layout → grid / spacing / extras), the Stats/Pages/Tags/Theme config tours no longer auto-starting (run them from Config → General → Tours & onboarding), plus accessibility polish (config spinner labels, health skip-to-content link, lazy category icons, and a no-JavaScript fallback message on the dashboard); **v2026.07.10.2** gzip-compressed responses (HTML/JS/CSS/JSON transfer 70-90% smaller), deferred config tour scripts (~374 KB) and peripheral dashboard scripts (~107 KB) off first paint, a line-style dashboard inbox icon matching the health icon, and quieter health borders (same cleanup as config: softer tile/panel borders, intro frame dropped, sections by spacing and headings); **v2026.07.10.1** quieter config borders (fewer nested frames; sections separated by spacing and headings, classic layout); **v2026.07.10** self-hosted default font (no Google Fonts request, works offline), deferred promo scripts for faster first paint, correct per-theme browser/PWA `theme-color`, centralized CSS cache-busting, and this 25-release modal history; **v2026.07.09** header health icon with counter (on by default), roomier dashboard side margins with exact config/health alignment at every width (including above 1600px), rounded status-row highlights with extra left inset for favicon clearance, config header health icon parity (dashboard-style icon + counter, inbox pill removed), and Stats inbox insights plus expand/collapse-all with remembered state; **v2026.07.08.1** General quick-link scroll offset hotfix; **v2026.07.08** Help section rework, sticky accordion, animated Ko-fi CTA, and split-shell divider/border fixes; **v2026.07.07** General split-shell (sticky quick links, section accordion), Advanced split into smaller cards, and number-input styling; **v2026.07.05.1** hotfixes (★ FAB placement, Config Help modal chrome, status-row highlight, save-indicator and merge fixes); **v2026.07.05** config shell polish (Help split-shell B5, flattened Tags/Backups/Theme cards, B10/C15), dashboard chrome (unified chips, toolbar modals for recent/help, D8 recent usage, D12 status-row tokens, fresh-install footer defaults, Classic early-beta notice); **v2026.07.04** config surface polish (General layer toolbar, active tab styling, Stats split-layout, Bookmarks master/detail, Theme colors divided list); **v2026.07.03** activity log, security hardening, extension shortcuts, hash-based data revision, 7-release modal history, General layer scroll preservation, and Playwright E2E suite green; **v2026.07.02** bookmark category and tag sync and data revision; **v2026.07.02** config polish (Stats tour, B6–B11, A8/A10, C15); **v2026.07.01.8** inline edit focus (opaque panel + tour blur) and config C14/C15 (Extras unsaved dot, broader reduced motion); **v2026.07.01.5** config surface polish; **v2026.07.01.4** config polish; **v2026.07.01.1** config surface parity; **v2026.07.01** config tab bar v5; and **v2026.06.31** config tab consistency — is summarized under **What's new** in **Config → Help**.

---

## 15. Status monitoring and health

### Per-bookmark status (dashboard)

When enabled, bookmarks can show online/offline from ping checks. **Essentials** shows a compact overview (monitored count + toggle); per-bookmark options live under **Bookmarks**, full tuning under **Advanced → Status**. Re-check interval is configurable (1–30 minutes, default 5).

### Health page (`/health`)

Central place to triage issues (still labeled **health beta** in the UI):

```
Summary row (9 stats, click to filter) → Compact controls (search, page, pills, bulk)
                                              ↓
                         Bookmark list (multi-select, favicon, row actions)
                                              ↓
                         Duplicate groups → merge (keep best)
```

| Feature | Use |
|---------|-----|
| **Score 0–100** | Combines broken, duplicate, shortcut conflict, stale, missing preview, unused |
| **Summary row** | Nine compact stat cards on one row; click a card to jump to that filter |
| **Filters** | broken, duplicate, shortcut-conflict, stale, unchecked, unused, missing preview, healthy — default **broken** on first visit |
| **Controls panel** | Search, page filter, status pills, and bulk buttons in one compact block |
| **Page filter** | Limit the issue list to one dashboard page |
| **Search** | Name, URL, category, page |
| **Multi-select** | Checkboxes per row; **All visible**, **Clear**, bulk favicon refresh, bulk delete (partial failures reported in a summary toast) |
| **Open in Config** | Click the row main area or press `Enter` to open **Config → Bookmarks** for that bookmark |
| **Favicon** | Shows stored bookmark icon; refresh per row or in bulk |
| **Action toolbar** | Config-style buttons per row: open URL, dashboard deep link, re-check status, favicon, overflow (**Status** → re-check status; **detect redirect**, **refresh title**, **archive**, delete) |
| **Action runtime** | `health-runtime.js` coalesces re-renders, blocks concurrent row actions, and times out slow API calls so detect redirect and other repairs do not freeze the page |
| **Detect redirect** | Overflow **detect redirect** uses a fast redirect-only suggest (`redirectOnly=1`, skips title fetch); confirm shows the proposed URL; errors and timeouts appear in the status bar |
| **Keyboard** | `j`/`k` or arrows move focus; `Enter` → editor; `O` → open URL |
| **Layout parity** | Uses the same **Classic / Modern / Glass** layout version and visual settings as the dashboard (preset, density, custom background, opacity, font weight, animations, auto dark mode); updates when you save in config |
| **Row action styling** | Per-row toolbar buttons and overflow menu match the active layout (rounded chips; glass blur on glass layout) |
| **dashboard link** | Jump to bookmark on correct page/category |
| **Re-check status** | Re-test a URL; failures show specific errors (e.g. HTTP 404, Timeout, DNS) |
| **Bulk** | Retest all checked, open broken (with confirm/limit), merge duplicate groups |
| **Duplicate merge** | Keeps the “best” bookmark: most opens → pinned → oldest; merges tags, shortcut, opens, notes, and icons from removed rows into the keeper |

Filter, sort, search, and page-filter state persist in the session across refreshes and sync to the URL (`filter`, `page`, `sort`, `q`).

**URL deep links** — Open health with query parameters:

| Parameter | Example | Effect |
|-----------|---------|--------|
| `filter` | `/health?filter=broken` | Pre-select a filter pill |
| `page` | `/health?page=2` | Limit to one dashboard page |
| `sort` | `/health?sort=name` | Set sort order |
| `q` | `/health?q=github` | Pre-fill search |
| `refresh` | `/health?refresh=1` | Run retest-all on load |

From the dashboard, **`:health`** (command mode) opens health with optional filters (`broken`, `duplicate`, `stale`, …) or `refresh` to re-scan. **`:stale`** overflow rows link to `/health?filter=stale`.

The dashboard **health** icon (**v2026.07.09**, a heartbeat glyph styled like the inbox tab) shows a compact counter pill for broken links and warnings (including shortcut conflicts) — broken count takes priority over warnings, red for broken and amber for warnings, hidden when healthy (**v2026.07.01.1**). When broken issues exist, the link opens `/health?filter=broken`. On **config**, the header **→ health beta** link and **General → Essentials → Health →** use the same routing (Essentials link appears when status monitoring is on).

### Stats (`config#stats`)

Read-only analytics (desktop). Filter toolbar sits above a fused **split surface** (**v2026.07.04**): chip navigation and sidebar index share the left column; stats blocks fill the content pane — same split-shell pattern as Help. Sidebar index jumps to sections; on phone, horizontal **chip-nav** replaces the sidebar. Content stays on the Stats tab only — it does not overlay other config tabs.

- **Insights** — automated highlights (busiest page, top bookmark, never-opened share, status coverage, recent activity) with links to sections.
- **Overview & activity** — bookmark totals, period filters (7 / 30 / 90 days / all time), sparklines, and **week-over-week** active-bookmark comparison when the **week** period is selected. Open counts describe **lifetime** `openCount` for bookmarks active in the selected period (labels update when a period is active).
- **Top bookmarks, pages, categories, shortcuts** — sortable tables; click a bookmark row (or press `Enter`) to open it in **Config → Bookmarks**.
- **Finders** — finder totals and top-20 table by `useCount`.
- **Inbox** (**v2026.07.09**) — current inbox health (total / unread, oldest unread age, unread > 30d backlog, tags / notes / previews) plus **lifetime triage throughput**: items added, converted to bookmarks, discarded, average time to triage, a conversion coverage bar, an added-vs-triaged trend sparkline (7 / 30 / 90 days), and source / top-domain tables. Lifetime counters are kept in `data/inbox-stats.json` and start from when tracking began (older activity isn't included).
- **Tags** — coverage, most-used tag, untagged count, per-tag tables.
- **Rot & cleanup** — stale bookmarks, cleanup score (resets when the library is empty).
- **Conflicts** — duplicate URL detail list and shortcut conflicts with a link to **Health**.
- **Toolbar** — **Filter tables** search (narrows rows across all stats tables with a visible/total hint), **Expand all** / **Collapse all sections** (same as General; **v2026.07.09**), **Refresh** (reloads stats in-tab), and **Export CSV** (downloads multiple sections; respects active period filters) live in the in-surface toolbar (**v2026.07.01.1** moved Refresh/Export from the intro row).
- **Section state** (**v2026.07.09**) — Stats sections start collapsed and remember which ones you expand across visits.
- **Overview** — includes **Last backup** (formatted date from the backups tab when a ZIP was created in this browser).

---

## 16. Config — complete walkthrough

Open `/config`. The tab bar groups tabs as **System**, **Dashboard**, **Extras**, and **Help**. **`1`–`9`** jumps to the Nth visible tab; **`←`/`→`** moves tab-by-tab and crosses into the next group at group edges; **`Alt+←`/`Alt+→`** jumps to the first tab of the previous/next group (when focus is not in an input or modal). **`S`** saves (sticky bar).

| Tab | Purpose |
|-----|---------|
| **general** | Language, appearance, layout, bookmarks (display + behaviour merged), smart collections, status, branding, search — split **Essentials** / **Advanced** |
| **theme** | Built-in theme picker |
| **collections** | Custom collection rules |
| **pages** | Add, rename, archive, reorder pages (auto-save; ↑/↓ keyboard; desktop) |
| **categories** | Per-page categories — merge, counts, auto-save on reorder and when leaving the tab or changing page (desktop) |
| **bookmarks** | Split-view editor, bulk actions; **Context** panel for page/category; breadcrumb shows active page/category |
| **finders** | External search shortcuts |
| **backups** | ZIP backup/restore, CSV, browser HTML import |
| **help** | In-app documentation index (EN/NL/DE/FR); What's new recap; searchable via settings search — available on phone |
| **stats** | Usage insights (desktop) |
| **keyboard** | Rebind shortcuts — tab under **System** in the grouped tab bar (link from help) |
| **colors** | Theme editor (`#colors`) — dark/light, custom & packaged palettes, export/import, undo |
| **tags** | Tag management |

### Essentials vs Advanced (general)

- **Essentials** — Language, appearance (including favicon styling and a link to **Config → Theme**), layout, everyday bookmark options, smart collections (master toggle + enabled count), and a compact **status monitoring overview** (monitored count + toggle; **Health →** when status is on — opens `/health?filter=broken` when broken issues exist, otherwise `/health`). Language changes apply immediately; other changes need **Save**.
- **Advanced** — Full status tuning, branding, **Search & input**, **System & tools** (launcher mode, device settings), and a standalone **Tours & onboarding** card (tour replay, onboarding replay, spotlight resets, what's new) (**v2026.07.07**). Click a **section title** (+/−) to expand or collapse each panel.
- **Layer toolbar (v2026.07.04)** — **Essentials**, **Advanced**, and **Show all** switch in one row at the top of the fused General surface.
- **Sections index & accordion (v2026.07.07)** — a sticky **quick links** sidebar (same split-shell pattern as **Stats** and **Help**) lists every section next to the settings content and highlights whichever section is currently in view as you scroll. Opening a section — from the sidebar or by clicking its own title — collapses whichever other section was open, so only one stays expanded at a time. Clicking the link for an already-open section that's in view collapses it again; clicking the link for an open section that has scrolled out of view scrolls back to it instead of collapsing it invisibly off-screen. Hidden on phones (same panels as the mobile layout below). Sections have a dividing border between them, and the vertical divider next to the quick-links sidebar runs the full height of the page (**v2026.07.08**). Quick-link clicks land on the section title instead of scrolling a few lines past it (**v2026.07.08.1**).
- **Show all sections** — flat view with every panel on one page; **Expand all** / **Collapse all** bulk controls.
- **Save row chrome** — Save row and main tab bar use a solid background so scrolling content does not show through. Section panels share consistent row widths across classic, modern, and glass layout versions.
- **↺ Reset** — small reset buttons beside many controls restore that field to its saved default (marks the form dirty until you **Save**).
- **Hash links** — `config#general`, `#general/advanced/layout`, etc. open the right layer and panel; collapsed panels open when linked from search. Bare `#general` opens **Essentials** on your first visit; after you pick a layer explicitly, it restores your last Essentials / Advanced / All choice.
- **ℹ** next to labels — Short explanations in EN/NL/DE/FR.

### Find settings & quick actions (desktop config)

- **Breadcrumb row** — compact path `tab › context` (e.g. `bookmarks › Work › dev`, `tags › filter: work`, `stats › overview › 30d`, `collections › editing: Work`) with sub-context on Bookmarks (page + category), Categories (page), Tags (active filter), Stats (section + period), and Collections (edit selection) (**v2026.07.01.5**). **Search settings…** lives in the same row on the right.
- **Save row** — compact strip with **Save**, **Undo** / **Discard** (only when there are unsaved changes), **Requires save** / **Auto-save** / **Read-only** / **Save colors** pill, and one dirty/saved/syncing status line.
- **Tab groups (v2026.07.01)** — **System** (General, Theme, Backups, Stats, Keyboard), **Dashboard** (Pages, Categories, Bookmarks), **Extras** (Tags, Finders, Collections), **Help**. Group width follows tab count; phones show **System** + **Help** only. On **Modern** / **Glass**, the page header, save row, and tab bar appear as one connected card. On **Classic** (**v2026.07.01.3**), the configuration title and header links stay separate from the save row and grouped tabs — each in its own bordered card with spacing between them. When a tab in a group has unsaved changes, the group label shows a dot (e.g. **System ●**) (**v2026.07.01.4**). Active group and tab use stronger accent styling (**v2026.07.04**).
- **Search settings…** — in the breadcrumb row; **`Ctrl+Shift+K`** / **`Cmd+Shift+K`**. Finds tabs, General panels (including Advanced while Essentials is active), individual labels, stats sections, colors groups, keyboard bindings, and Help blocks. Select a result to switch tab/layer, expand collapsed panels, and scroll there.  
- **Settings search promo** — on the first desktop config visit (until dismissed), a pulsing search field, **New** badge, and speech balloon beside the search field explain settings search vs quick actions (left/right placement, repositions on scroll). Dismiss with **Got it**, focus, or typing. Replay from **Tours & onboarding → Reset settings search promo**. Skips mobile and active guided tours.  
- **Quick actions** — **`Ctrl+K`** / **`Cmd+K`**. Runs actions only (save, open dashboard, tour resets). Settings navigation is separate — use search settings, not the command palette.

#### Config tab bar (keyboard)

| Keys | Action |
|------|--------|
| `1`–`9` | Jump to the Nth visible config tab |
| `←` / `→` | Previous / next tab; crosses tab groups at the edges |
| `Alt` + `←` / `→` | Jump to first tab of previous / next group (**System**, **Dashboard**, **Extras**, **Help**) |
| `S` | Save (same as **Save** button / sticky bar) |
| `Alt` + `↑` / `↓` | Reorder selected bookmark on **Bookmarks** tab |

Guards: shortcuts do not fire while focus is in an input, textarea, select, contenteditable field, or app modal. The dashboard cheat sheet (`!` / `F1`) lists these under **Other**; **config → keyboard** lists them under **Config tab bar**.

#### Layout and structure

- **Tab groups (v2026.07.01)** — labelled groups **System**, **Dashboard**, **Extras**, **Help** with proportional width; active group highlighted; **Keyboard** under System. Tab bar may show a *more tabs →* hint when it overflows horizontally.
- **Tab shell (v2026.06.31 / v2026.07.01 / v2026.07.01.1 / v2026.07.01.4 / v2026.07.01.5 / v2026.07.01.8 / v2026.07.04 / v2026.07.05)** — list tabs (Pages, Categories, Tags, Finders, Collections) share the same intro paragraph, toolbar alignment, search/filter field, and empty-state layout (`config-list-tab`, **v2026.07.01.5** / **v2026.07.04**). **Pages** and **Categories** also show a **Usage** column (popularity bar + bookmark count, like Tags) (**v2026.07.01.4**). **Bookmarks** uses a master/detail split with toolbar above the panes (**v2026.07.04**); **Collections** editor sits inside its fused surface (**v2026.07.01.5**). **Stats** uses a Help-style split shell for chip-nav + sidebar (**v2026.07.04**). **Help** uses the same split-shell pattern with chip navigation (**v2026.07.05** / B5). **Theme** color rows use divided-list rhythm inside the fused surface (**v2026.07.04**); Colors subtabs match the General layer switcher (**v2026.07.05**). **Keyboard** and **Backups** use the fused `config-tab-surface` pattern. On **Classic**, **Modern**, and **Glass**, each tab fuses toolbar + content into one surface card with divided rows (Classic **header chrome** stays separate from save row and tabs — **v2026.07.01.3**, C10 reverted). Intro text keeps consistent spacing above toolbars on General, Bookmarks, and list tabs. Config chrome respects `prefers-reduced-motion` (**v2026.07.01.4** / **v2026.07.05** C15); tag cloud, keyboard pulse, health shimmer, settings-search promo, skeleton loaders, and spotlight tours also respect it (**v2026.07.01.8**). Unsaved group dots include **Extras ●** when only **Collections** changes (**v2026.07.01.8** / C14).
- **Save UX** — tabs that auto-save (Pages, Categories, Finders, …) show an **Auto-save** pill in the **save row**; General and Bookmarks show **Requires save** until you click **Save**. Stats is **Read-only**; Theme uses **Save colors**. One status line beside **Save** shows dirty / saved / syncing. **Undo** and **Discard** in the save row appear only when something changed.
- **Bookmarks** — Display and Behaviour are a **single merged section** with a visual divider between the two groups. Essentials still shows a lightweight subset (favicons, new-tab, quick-add, page tabs). Per-category **A–Z** / **Rec** sort lives on the dashboard category headers, not in Config.  
- **Tours & onboarding** — collapsible block inside **Advanced → System & tools**: onboarding wizard replay, feature tour link, **What's new**, **Reset all dashboard promos**, **Reset layout versions prompt**, **Reset paste spotlight**, **Reset preview cards spotlight**, **Reset settings search promo**, **Reset G+jump promo**, **Reset cheat sheet promo**, **Reset weather location promo**, and per-tab **Show … tour again** buttons (General, Bookmarks, Finders, Stats, Categories, Tags, Pages, Collections, Theme).

### Guided config tours

**One-time spotlight tours** explain config without reading every panel first. Each tour highlights one UI region at a time with a small card (Back, Next, Skip tour, step counter). The card stays near the bottom on large highlights so it does not cover the spotlight. Page scroll is locked per step so the highlight stays stable. While a tour runs, the **rest of the config page is dimmed and non-interactive** — tab buttons, Save, settings search, and other fields cannot be clicked; only the **spotlight region** for the current step and the **tour card** stay active, so you cannot switch tabs mid-tour. Tours need a **desktop-width** window (the mobile config layout does not run them).

| Tour | When it starts | What it covers |
|------|----------------|----------------|
| **General** (11 steps) | First visit to **config → general** | Overview-only welcome, Essentials vs Advanced layers, appearance, layout, bookmarks, dashboard toolbar, smart collections summary, Advanced section nav, other config tabs, **Search settings…** (`Ctrl+Shift+K`), **Save** |
| **Bookmarks** (extended) | First visit to **config → bookmarks** | Split layout, collapsed **Context** panel (page/category switcher — not full structure editing), **+ Bookmark** menu, filters, optional demo bookmarks (editor, detail panel, dashboard **+**), search, bulk toolbar, favicon policy, cleanup of demos, **Save** |
| **Pages** (8 steps) | First visit to **config → pages** | Page list, add page, optional demo page, naming, dashboard handoff, remove page, demo cleanup |
| **Categories** (8 steps) | First visit to **config → categories** | Per-page categories, add category, optional demo **news** category, name/icon, dashboard reorder, remove, cleanup |
| **Tags** (8 steps) | First visit to **config → tags** | Tag cloud, list actions, optional demo bookmark with tag (via Bookmarks tab), tags field, see result on Tags tab, cleanup |
| **Collections** (11 steps) | First visit to **config → collections** | List, new collection, optional demo rules (tag/category/shortcut, AND/OR), save to dashboard, preview on dashboard, cleanup |
| **Finders** (8 steps) | First visit to **config → finders** | Concept, fields, **+ Add finder**, optional **Google** example (`?g`), dashboard usage, reorder/remove, **Save** |
| **Stats** (12 steps) | First visit to **config → stats** — index, overview, cleanup score, activity, top bookmarks, pages/categories, shortcuts, **tags**, rot & cleanup, conflicts (Health link), search/status settings (re-enabled **v2026.07.02**) |
| **Theme** (9 steps) | First visit to **config → theme** (`#colors`) | Editor, dark/light/custom subtabs, add custom theme, auto **Tour demo** palette, live preview, **Save colors**, **General → Appearance** to activate, confirm removal and restore previous theme |

**Completion** — Each tour runs automatically only until you finish or skip it. Completion is stored in your settings (`configGeneralTourCompleted`, `configBookmarksTourCompleted`, `configPagesTourCompleted`, `configCategoriesTourCompleted`, `configTagsTourCompleted`, `configCollectionsTourCompleted`, `configFindersTourCompleted`, `configStatsTourCompleted`, `configThemeTourCompleted`) and in browser `localStorage`.

**Replay** — Open **config → general → Advanced** → **System & tools** and expand the **Tours & onboarding** block. Each tab has a **Show … tour again** button (General, Bookmarks, Finders, Stats, Categories, Tags, Pages, Collections, Theme). Open the matching tab first if the tour does not start. If a tour leaves the page scroll-locked without a visible card, refresh once — stale tour state is cleared automatically on load.

**Mobile** — Tours do not auto-start on the phone config layout (≤768px). Portrait tablets and wider touch layouts keep full config and may run tours. Rotating footer tips, the settings search promo, and promo banners are also hidden on the broader mobile dashboard layout.

**Not the same as** — **First-run onboarding** (language, layout, status, finish step for pages/bookmarks) or the dashboard **feature tour** (search, finders, commands — start from **config → general → Advanced → System & tools → Start tour**, or `/?tour=1`; each step highlights the matching control with a focus ring). After onboarding, **What's new** may open first; classic-layout users may then see a **layout-versions** tip, a **paste URL** spotlight, and a **preview cards** spotlight in the same session — separate from config tab tours.

### Config → Help

Available on every screen width (including phone). The **Help** tab uses the shared config split shell: intro paragraph, filter toolbar, chip navigation (mobile), and a sticky **quick links** sidebar next to the help content (same split-shell pattern as **General** and **Stats**, **v2026.07.08**). Topics are consolidated into fewer, broader sections in this order: *Getting started, Configuring nextDash, Keyboard shortcuts, Search/commands/toolbar, Finders, Appearance & display, Organizing bookmarks, Pages/categories/bulk editing, Tags & collections, Inbox, Health & status, Data & backups, Self-hosting & troubleshooting*.

- **Quick links & accordion (v2026.07.08)** — the sidebar highlights whichever section is currently in view as you scroll. Opening a section — from the sidebar or by clicking its own title — collapses whichever other section was open, so only one stays expanded at a time, same behaviour as General's section accordion. Clicking a quick link always scrolls so the section's title lands below the sticky toolbar instead of partway down the section.
- **Support the project** — a **Support me on Ko-fi** button at the bottom of Help, centered on its own row with the same twinkling-star glow animation as the What's New modal's donate CTA (**v2026.07.08**); the **jordibrw.nl** signature link below it is larger and accent-themed.
- **What's new recap** — scrollable history of up to **7 recent** releases in the ★ modal; **v2026.07.08.1** documents the General quick-link scroll offset hotfix; **v2026.07.08** documents the Help section rework, sticky accordion, animated Ko-fi CTA, and split-shell divider/border fixes; **v2026.07.07** documents General's split-shell (sticky quick links, section accordion), Advanced further split into smaller cards, and number-input styling; **v2026.07.05.1** documents hotfixes (★ corner FAB below tag cloud, Config Help *Show what's new*, modal chrome parity, status-row highlight, save-indicator and merge fixes); **v2026.07.05** documents config shell polish (Help B5, flattened cards, B10/C15), dashboard chrome (toolbar modals for recent/help, D8/D12, fresh-install footer defaults, Classic beta notice); **v2026.07.04** documents config surface polish (General layer toolbar, active tab styling, Stats split-layout, Bookmarks master/detail, Theme colors divided list); **v2026.07.03** documents activity log, security hardening, extension shortcuts, hash-based data revision, modal history depth, General layer scroll preservation, and Playwright E2E suite green; **v2026.07.02** documents bookmark category and tag sync, server data revision, Stats tour re-enabled, and config B6–B11 / A8 / A10 / C15 polish; **v2026.07.01.8** documents inline edit focus (opaque panel + tour blur) and config C14/C15 (Extras unsaved dot, broader reduced motion); **v2026.07.01.5** documents fused Bookmarks/Collections surfaces, list-tab shell, breadcrumb context, tour skip persistence, and health fixes; **v2026.07.01.4** documents Pages/Categories usage columns, Help fused surface, tab group unsaved dots, reduced-motion chrome; **v2026.07.01.1** documents Keyboard/Bookmarks/Stats/Backups fused surfaces; **v2026.07.01** documents config tab bar v5; **v2026.06.31** documents config tab consistency.
- **Translated** — EN, NL, DE, FR (same keys as the rest of config).
- **Settings search** — `Ctrl/Cmd+Shift+K` finds Help section titles and scrolls to them.
- **Keyboard tab link** — opens `config#keyboard` under the **System** tab group for rebinding.

On phone, Help is the only config tab besides **General** that shows the full documentation index; structure tabs need a wider window.

### Config keyboard

| Keys | Action |
|------|--------|
| `1`–`9` | Jump to the Nth visible tab (order follows groups: System → Dashboard → Extras → Help) |
| `←` / `→` | Previous / next tab; crosses tab groups at the edges |
| `Alt` + `←` / `→` | Jump to first tab of previous / next group |
| `S` | Save |
| `Alt+↑` / `Alt+↓` | Reorder bookmark in list |
| `Ctrl/Cmd+K` | Quick actions palette (save, open dashboard, tour resets) |
| `Ctrl/Cmd+Shift+K` | Find settings (tabs, panels, labels, help sections) |

---

## 17. Import, export, and backup

### ZIP backup (full instance)

**config → backups → Create backup** — ZIP, settings export, and CSV sections appear as divided rows inside one fused surface card on all layout versions (**v2026.07.01.1**).

Includes pages, bookmarks (with tags), categories, **finders** (`finders.json`), settings, custom themes (`colors.json`), uploaded dashboard favicon/font, and bookmark icon files under `data/icons/`. Legacy icon files that lived directly in `data/` are exported as `icons/<filename>` so bookmark references survive a full round-trip.

The panel shows **Last backup: …** after you create a ZIP (stored locally in the browser).

**Import ZIP** replaces **all** current data. **Always backup first.**

Do not rename files inside the ZIP.

Import is **atomic**: files are staged, orphan icons and stale JSON are removed, then everything is committed in one step. If the ZIP **omits** `finders.json`, your **existing finders are preserved** (not deleted as orphans).

Bookmark URL validation during import uses **`allowLocalBookmarks` from the imported `settings.json`** when that file is in the ZIP (read **before** bookmarks — not the server’s current setting).

Bookmarks with **invalid URLs** (wrong scheme, or private/loopback hosts when localhost bookmarks are disabled) are **skipped** during import; the UI shows how many were skipped alongside new and conflict counts. Icon filenames in imported JSON are sanitized.

### Settings export / import

**config → backups** — export or import **`settings.json` only** (without touching bookmarks or pages). Useful for migrating appearance, search, and status settings between instances. Import validates file size and strips migration markers so server-side migrations run correctly on next save.

### Factory reset

**config → backups → Reset all data**

Permanently deletes pages, categories, bookmarks, finders, settings, custom themes, uploaded favicon/font, all files under `data/icons/`, and health/preview caches. Recreates the **default sample bookmarks** (favicons prefetched in the **background** after startup), built-in settings, and default colour palette. Not a partial wipe — use ZIP backup first if you need to keep anything.

### Browser HTML import

1. Export bookmarks from Chrome, Firefox, or Edge as **HTML**.  
2. **config → backups → Import from Browser**.  
3. Review preview: **X new, Y conflicts (skipped)**.  
4. Choose target **page**.  
5. Confirm import.

- After import, nextDash batch-fetches missing bookmark icons and shows a progress bar.

- Folders in the HTML become **categories**.  
- Duplicate URLs (same page + within file) are skipped using the same rules as the server.

### CSV export

All bookmarks: localized column headers — Name, URL, Category (display name), Page, Shortcut, **Tags**, **Notes** — for Excel/Sheets.

### When to use which

| Scenario | Tool |
|----------|------|
| Disaster recovery / migration | ZIP |
| Share list with spreadsheet users | CSV |
| One-time migration from browser | HTML import |
| Daily new links | Quick-add, extension, modal |

---

## 18. Browser extension

Folder: `extension/` (Chrome “Load unpacked”).

### Setup

1. Extension icon → **Settings**.  
2. Enter nextDash URL (e.g. `http://localhost:8080`).  
3. Default page (and category if shown).  
4. Save.

### Save tab

- Pre-filled title and URL.  
- Optional **shortcut** — leave empty for an auto-suggested key from the bookmark name (first free letter on the chosen page), or type your own single-character shortcut.  
- **Save to Inbox** — quick capture without choosing a page or category.  
- Pick page/category, optional tags and note (bookmark save).  
- Duplicate URL warning; **Save anyway** optional.  
- **409** when the shortcut is already used on that page.  
- After save: **Open in nextDash** or **Open Inbox in nextDash**.

If a dashboard tab is open on the same server, it may toast and refresh.

### Write token & CORS

- If the server sets `NEXTDASH_WRITE_TOKEN`, paste the same value in extension **Settings → Write token**.  
- If you set `NEXTDASH_CORS_ORIGINS` on the server, add your extension ID (`chrome-extension://…`) to the allowlist or cross-origin saves will fail.

See `extension/README.md` for development notes.

---

## 19. Mobile, PWA, and touch

### Mobile config

On phones (≤768px width), config limits to **General** and **Help**; use a wider window for full bookmark editing and for **guided config tours** (General and Bookmarks). If you open `/config#bookmarks` on a phone, a **desktop only** card explains the limit and links back to the dashboard.

Within **General** on phone you get **language**, **theme**, and **layout** in that order, plus a compact **Search settings…** for those panels — not the full Essentials/Advanced layers or guided General tour.

**Tablets** — Portrait tablets and other touch layouts above 768px keep the full config (all tabs, Essentials/Advanced layers, settings search in the breadcrumb, guided tours). Only true phone widths use the reduced layout.

### Phone vs desktop

nextDash uses **phone layout** (≤768px width) for the reduced dashboard footer and config tabs. **Touch layout** (portrait tablets, coarse pointers) still skips hover previews and discoverability promos but keeps the **full desktop dashboard toolbar** on tablets wider than 768px. A dismissible banner on dashboard and config summarizes the limits.

| Feature | Phone (≤768px) | Tablet / desktop |
|---------|----------------|------------------|
| **Dashboard footer** | **Search** + **+ Bookmark** only | Configurable under **Header & buttons** — fresh installs: Search, Commands, Finders, What's new (★), + Add bookmark; Recent and cheat sheet off until enabled |
| **Date/time** | Compact date badge in header (tap to open popover) | Full date/weather line in footer |
| **Commands (`:`) & finders (`?`)** | Open Search → overlay tabs `>` / `:` / `?` | Footer buttons or keys |
| **Recent bookmarks (`*`)** | `:open recent …` in command mode (or `*` with a keyboard) | Recent footer button or `*` |
| **Cheat sheet (`!`)** | — | Footer Help or `!` / `F1` |
| **Tag word cloud (`/`)** | Use `:tag` or `tag:` in the search overlay | `/` FAB + word cloud (when enabled) |
| **Page tabs in header** | Scrollable tab strip with scroll-snap; active tab auto-scrolls into view; `← →` swipe hint on multi-page dashboards | Tab strip + keys `1`–`9` |
| **Health badge** | Hidden — fix links in config on desktop | Header link |
| **Config tabs** | **General** (language, theme, layout) + **Help**; `#bookmarks` shows desktop-only card | Bookmarks, pages, backup, stats, health, theme editor, tours, all settings |
| **Link preview on hover** | Off | When enabled in settings |
| **Guided tours & footer tips** | Skipped / hidden | Optional on first visit |

### Touch gestures

| Gesture | Action |
|---------|--------|
| Long-press row | Inline edit |
| Long-press category header (~500 ms) | Rename category (not on sort buttons) |
| Swipe (if enabled) | Change page |
| Tap **Search** | Open search overlay (with mode tabs on phone) |
| Tap **+ Bookmark** | Full add-bookmark modal |

Keyboard hints in empty states are hidden on touch.

### Install as app

**Add to Home Screen** uses `/manifest.webmanifest` — custom title/favicon from **branding** settings apply to the installed name/icon.

In **Config → General → Advanced**, the panel under **HyprMode** shows platform-specific install steps and an **Add to home screen** button when your browser supports it. HyprMode (launcher behaviour: open bookmark in a new tab and close the dashboard) pairs well with an installed PWA.

---

## 20. Efficient workflows

### Daily driver

1. Open dashboard on your main page tab.  
2. **`>`** to jump to any bookmark.  
3. **`&`** to capture a link someone sent you.  
4. **`1`–`9`** for context switches (work vs personal).  
5. Glance at **health** badge; fix broken links weekly.

### After importing hundreds of bookmarks

1. Import to a dedicated **staging** page.  
2. Use health **duplicate** groups to merge.  
3. **`Shift+M`** or config bulk move to split into real pages.  
4. Enable **stale** smart collection; archive or delete dead links.  
5. ZIP backup when stable.

### Research session

1. **`:open last 10`** to reopen today’s trail on one page.  
2. **`*`** panel for the same list visually.  
3. **`:save`** a search query you reuse.  
4. Tag bookmarks with **` :tag `** as you go.

### Keyboard-only day

Keep hands on home row: **`>`** search → **Enter** open → **Esc** → **`&`** add → **`:`** change layout/theme → **`,`** switch page.

---

## 21. Security and self-hosting

nextDash has **no user accounts**. Anyone who can reach the URL can read data and change bookmarks/settings unless you add network or token protection.

**Recommended:**

| Setup | When |
|-------|------|
| **Tailscale / private VPN** | Access from your devices only |
| **Reverse proxy + auth** | Caddy, Traefik, nginx + basic auth or SSO |
| **localhost + SSH tunnel** | Local dev only |

**Do not** port-forward plain HTTP to the public internet without auth.

### Optional `NEXTDASH_WRITE_TOKEN`

For Docker or bare-metal on a **LAN or VPS**, set:

```yaml
environment:
  - NEXTDASH_WRITE_TOKEN=your-long-random-secret
```

When set, protected API calls require header `X-NextDash-Token: your-long-random-secret`. Opening **Dashboard**, **Config**, or **Health** in the browser supplies this header automatically via a meta tag (same origin only). When the variable is **unset**, nothing requires the token.

| Protected action | Endpoint |
|------------------|----------|
| Reset all data | `POST /api/reset` (+ JSON `{"confirm":true}`) |
| Import ZIP backup | `POST /api/import` |
| Download ZIP backup | `GET /api/backup` |
| Delete page | `DELETE /api/pages/{id}` |
| Health: delete bookmark | `POST /api/health/delete-bookmark` |
| Health: retest all | `POST /api/health/retest-all` |
| Health: merge duplicates | `POST /api/health/merge-duplicates` |
| Health: auto-heal suggest | `GET /api/health/auto-heal-suggest` |
| Health: auto-heal apply | `POST /api/health/auto-heal-apply` |
| Health: open broken links | `POST /api/health/open-broken` |
| Health: cache scan result | `POST /api/health/cache-scan` |
| Health: update bookmark status | `POST /api/health/update-status` |
| Bookmark link preview | `GET /api/bookmark-preview` |
| Build search index | `POST /api/search-index` |
| Clear all preview metadata | `POST /api/previews/clear` |
| Refresh all preview metadata | `POST /api/previews/refresh` |
| Reset theme colours | `POST /api/colors/reset` |
| Upload favicon / font / icon | `POST /api/favicon`, `/api/font`, `/api/icon`, `/api/icon/from-url` |
| Save bookmarks / add / import | `POST /api/bookmarks`, `/api/bookmarks/add`, `/api/bookmarks/import-browser` |
| Save pages / categories / finders / settings / colours | `POST /api/pages`, `/api/categories`, `/api/finders`, `/api/settings`, `/api/colors` |

Read-only endpoints (`GET` bookmarks, settings, health list, ping, etc.) stay open. The browser extension can store the same token under **Settings → Write token**.

### Optional `NEXTDASH_DATA_DIR`

By default nextDash stores pages, bookmarks, settings, and uploads under `./data` next to the binary (or `/app/data` in Docker). Set `NEXTDASH_DATA_DIR` to use another directory — useful for multiple instances, tests, or keeping data on a separate volume without changing the mount path inside the container.

### Localhost bookmarks

**Config → General → Advanced → Allow localhost & private-network bookmarks** is **on by default** for dev workflows. Turn it **off** if nextDash is reachable on a shared network (reduces SSRF via status/preview fetches).

Server-side **pings**, **link previews**, **icon downloads**, and **auto-heal** only follow HTTP redirects to hosts that pass the same rules as the original URL (public hosts when localhost bookmarks are off). Outbound connections also validate **resolved IP addresses at dial time** (DNS-rebinding protection). Resolved public IPs are **pinned for ~2 minutes** so a hostname cannot switch to a private address between the check and the TCP dial.

Duplicate URL detection (`:duplicate` in search, Health view, and `GET /api/duplicates`) treats URLs as the same when they differ only by trailing slash, hash, or host letter-case (`https://Example.com` ≡ `https://example.com/`).

### Optional `NEXTDASH_CORS_ORIGINS`

Default API responses use `Access-Control-Allow-Origin: *` so the browser extension works without extra config. On a shared LAN/VPS, set a comma-separated allowlist:

```bash
NEXTDASH_CORS_ORIGINS=https://dash.example.com,chrome-extension://your-extension-id
```

Only matching `Origin` headers receive CORS headers. Include your extension origin when restricting CORS.

### Activity log

Structured JSON lines for bookmark mutations and status checks (opens optional). See [README.md → Activity log](README.md#activity-log-bookmark-events) for `NEXTDASH_ACTIVITY_LOG`, `NEXTDASH_ACTIVITY_LOG_PERSIST`, and example lines. Treat logs as sensitive — URLs are included.

### Rate limits

Per-client limits on outbound fetches and SSRF-sensitive APIs (`NEXTDASH_OUTBOUND_REQUESTS_PER_MIN`, default 120; `NEXTDASH_SSRF_API_RATE_PER_MIN`, default 60). Returns **429** when exceeded.

### Content-Security-Policy

HTML pages send a restrictive CSP by default. Set `NEXTDASH_CSP=off` only when required by your proxy or integration.

### Startup validation

Before listening, the server checks `PORT` (1–65535) and that `NEXTDASH_DATA_DIR` is creatable and writable. Misconfiguration exits with a clear error.

### Production Docker

Use `docker-compose.prod.yml` for deployments: assets ship inside the image; only `./data` is mounted. See commented environment examples in that file and [README.md → Production Docker example](README.md#production-docker-example).

### Build metadata & cross-tab sync

- `GET /version` — version and commit string for ops/monitoring.  
- `GET /api/data-revision` — hash of bookmark data; open dashboard tabs poll this to refresh after saves in config, the extension, or another tab (name, URL, shortcut, tags, and category placement).

Preview metadata is cached in memory and flushed periodically (~30 s) and on shutdown so restarts do not serve stale OG tags indefinitely.

---

## 22. Troubleshooting and FAQ

### Dashboard empty after install

Normal. Add bookmarks via **&**, **+**, import, or config. Run onboarding if offered — the finish step covers pages and first bookmarks.

### Dashboard failed to load

If bootstrap data cannot be fetched, you get an error toast with **Reload** and the loading skeleton clears. Check that the server is running and `/api/pages`, `/api/settings`, and `/api/bookmarks` respond. Corrupt device settings in `localStorage` fall back to server settings automatically.

### Config sync from another tab

When you save in config while the dashboard stays open, changes apply live. The dashboard polls `GET /api/data-revision` and refreshes when bookmarks change (including name, URL, shortcut, tags, and category). Settings-only updates refresh dashboard row chrome in place when possible (icons, shortcuts, status badges) without rebuilding the whole grid. If sync fails, use **Retry** on the error toast instead of a full page reload — unsaved inline edits are less likely to be lost.

### Shortcut does not open bookmark

- Another bookmark or finder may use the same key.  
- Focus must not be in an input.  
- Check **Use shortcuts from all pages** in general settings if you expect global keys.

### Import shows “0 new”

All URLs already exist on the chosen page, or the HTML had no http(s) links. Try another page or remove duplicates first.

### Health deep link does not scroll

Bookmark index may have changed after reorder/delete. Link still opens the right page; use search or `?url=` fallback if added manually.

### Settings not applying

Click **Save** in config (sticky bar) when the save row shows **Requires save**. Auto-save tabs (Pages, Categories, Finders, …) persist after a short debounce — watch the status line beside **Save** and the **Auto-save** pill in the save row.

### Config Save fails on local/private URLs

A bookmark may use a `192.168.x.x`, `localhost`, or other private host while **Allow localhost & private-network bookmarks** is off. Enable it under **Config → General → Advanced**, change the URL, or let nextDash suggest enabling the flag when private URLs are detected. Save posts settings before bookmarks so the flag applies during validation.

### Config guided tour does not start

- Use a **wider browser window** or turn off mobile device emulation.  
- Open the correct tab (**general**, **bookmarks**, **theme** / `#colors`, **finders**, **stats**, …) before replaying from **System & tools**.  
- If you already completed the tour, expand the **Tours & onboarding** block in **config → general → Advanced → System & tools** and use the matching **Show … tour again** button (e.g. **Show Theme tour again**).  
- Refresh the page if the editor is still loading, then try again.

### Settings search promo does not appear

- Use a **desktop-width** window (>768px; not portrait tablet or mobile emulation).  
- The promo shows once until dismissed — use **Tours & onboarding → Reset settings search promo** to replay it.  
- Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) after an update if you still run cached JavaScript.  
- Wait a few seconds after the config page finishes loading; the promo waits until guided tours finish.

### Weather not showing

Set manual city or browser location permission; save general settings; check refresh interval.

### Extension cannot save

- Verify server URL, network, and that nextDash is running.  
- If `NEXTDASH_WRITE_TOKEN` is set, paste it in extension **Settings → Write token**.  
- If `NEXTDASH_CORS_ORIGINS` is set, include `chrome-extension://your-extension-id` in the allowlist.  
- **401** = missing/wrong write token; **403** = CORS origin not allowed; **409** = duplicate shortcut on that page.  
- Check browser console and server logs (enable `NEXTDASH_ACTIVITY_LOG=security` for auth/rate-limit lines).

---

## 23. Quick reference

### Most-used keys (dashboard)

```
> search    : commands    ? finders    & quick-add    + new modal
1-9 pages   , overview    * recent     ! cheat sheet
arrows nav  Enter open    ; edit       Shift+M move  Shift+T tag  Shift+D delete
```

### Config (desktop)

```
Ctrl/Cmd+K          quick actions (save, open dashboard, tours)
Ctrl/Cmd+Shift+K    find any setting, tab, or help section
:layoutversion      switch Classic / Modern / Glass layout (dashboard)
```

### Important URLs

| URL | Page |
|-----|------|
| `/` | Dashboard |
| `/config` | Settings |
| `/config#bookmarks` | Bookmark editor |
| `/config#backups` | Backup / import |
| `/health` | Health monitor |
| `/colors` | Theme editor |

### Data location

Docker: mounted volume (e.g. `./data`). Binary: `./data` next to the executable.

---

## Further reading

- [README.md](README.md) — Install, security, and feature overview  
- [CHANGELOG.md](CHANGELOG.md) — Complete release history (new / fix)  
- **Config → Help** — Same topics as this manual, translated (EN/NL/DE/FR), with quick anchor links, **Browser extension**, **Security & self-hosting**, and a **What's new** recap  
- **In-app What's new (★)** — Latest release highlights first; scroll for up to **7 recent** versions (each loads on demand with a skeleton while fetching)  

---

*This manual describes nextDash as shipped in this repository. Minor details may vary by version; when in doubt, trust the in-app Help and What's new modal.*
