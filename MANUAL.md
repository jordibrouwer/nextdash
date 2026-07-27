# nextDash — User Manual

**A complete, step-by-step guide to the keyboard-first bookmark dashboard.**

This manual is written for new users and for anyone who wants a structured reference. It complements the shorter [README](README.md) (install, security, changelog) and the in-app help at **Config → Help** (same topics, translated, including a **What's new** recap through **v2026.07.20**).

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
Install → Open URL in browser → Quick-start card (optional)
    → Dashboard (may be empty) → Config to add pages/bookmarks
    → Optional: What's new; browser extension
```

1. **Quick-start card** — A compact three-step card in the corner: language & auto dark mode, column layout, and weather. Skip it whenever you like — nothing is locked in, and every setting it touches stays reachable in **Config → Behavior** afterwards. It then becomes a short checklist (add a bookmark, tag one, open config, see the keyboard cheat sheet) that dismisses itself once every item is done, or any time you close it (see [Quick-start card](#quick-start-card)).
2. **Empty dashboard** — Normal on first run. Use **+** (full add form) or **&** (quick-add) to add your first bookmark, or import from a browser HTML file (see [Import](#17-import-export-and-backup)).
3. **Config** — Click **config** in the header, press **`Shift+S`**, or open `/#config`. Config is a view inside the dashboard, not a separate page. Its **Help** section mirrors much of this manual in shorter form, plus a **Tips & tricks** section and a **What's new** recap.

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

- Collapse/expand per category on the dashboard; press **`.`** to collapse or expand **all** categories at once.  
- Drag the **`//` prefix** in a category title to reorder sections.  
- Add a new category (or page) straight from the **new-bookmark modal** — the **Category** and **Page** dropdowns each carry a **+ New…** option that creates and saves it inline, no bookmark required.  
- Press and hold a category header (~500 ms, not on sort buttons) to rename — double-click still works. **Esc** cancels rename.
- In **config → pages & tags → categories**, edits auto-save when you switch to another config tab or change the page selector (blocked if validation fails). Category lists are protected from accidental empty saves when bookmarks still reference those categories.

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
| **Availability check** (**v2026.07.20**) | One choice of three: **Off** (never tested), **Periodic** (checked about once a day, flags a broken link), or **Monitor** (checked on its own interval with 30 days of history — uptime, heartbeat, outages). Monitor includes everything Periodic does. Set it in the editor, from the dashboard right-click menu, with `Shift + C`, or from a health-view row (`c`) |
| **Open count / last opened** | Usage tracking |

Pinned bookmarks stay at the top of their category (manual, A–Z, or recent sort). Notes remain searchable in fuzzy search and editable via `:note` or inline edit. Pin and note row icons were removed from the dashboard and from config; there are no pin/note badges on bookmark rows.

### 4.4 Inbox

**Inbox** is a separate capture list for links you want to read or sort later — not bookmark pages. Items live in `data/inbox.json` on the server.

- Open with the **Inbox** header tab, **`Shift+I`**, **`0`** (when search is closed), or **`:inbox`**.  
- Add links by pasting a URL on the dashboard (`Ctrl+V`) and choosing **Save to Inbox**, via the browser extension, or through the API.  
- Filter **All** / **Unread** / **Snoozed**, search, and browse date groups. **Snooze** parks a link for later (`z`) — four presets, plus a date field (**v2026.07.22**) for anything further out than *next week*, waking at 09:00 local like the presets do; **Promote** turns a link into a full bookmark (and health-checks it when status checks are on); **Triage** walks unread items one by one.  
- **Sort** (**v2026.07.22**) — next to the search field: **newest first** (default), **oldest first**, **title**, or **site**. *Oldest first* is how a backlog gets worked: the items you have been avoiding are at the bottom. Title and site sorts drop the date headings so the ordering runs unbroken from top to bottom.  
- **Linkable and remembered** (**v2026.07.22**) — filter, sort and search appear in the address bar (`?ib_filter=`, `?ib_sort=`, `?ib_q=`), so a view can be bookmarked or shared. Filter and sort also return on your next visit; a shared link overrides what was stored. The search box is deliberately not remembered.  
- **Select several** (**v2026.07.22**) — tick rows (click the box, or `x` on the selected row) and a bar offers **Mark read**, **Snooze** and **Delete** for just those items, instead of the toolbar's all-or-nothing bulk. `Esc` clears the selection, switching filter clears it too (so a bulk action cannot reach rows you can no longer see), and deleting names the count and asks first.  
- Keyboard: `j`/`k` move, `g`/`G` first/last, `Enter` open, `p` promote, `r` mark read, `n` note, `z` snooze, `x` select (**v2026.07.22**), `d` delete. Toolbar bulk actions: **Mark all read** and **Clear read**.  
- Toggle under **Config → Behavior → Search & inbox → Enable Inbox**; set the paste destination there too, to skip the choice dialog.

### 4.5 Config vs dashboard

Config is a **view inside the dashboard**, not a separate page — same tab, same session, no page load. Open it with **`Shift+S`**, the **config** header link, or the `/#config` address; **`<`** takes you back.

| Dashboard view | Config view |
|-----------------|------------------|
| Daily use: open, search, quick-add | Structure: pages, categories, bulk edit |
| Keyboard-first | Bookmark editor, stats, backups |
| Live layout and themes | Every setting, grouped by topic |

It has eight sections — **Overview**, **Pages & tags**, **Bookmarks**, **Appearance**, **Behavior**, **Data & backups**, **Statistics**, and **Help** — each deep-linkable as `/#config/<section>` (for example `/#config/appearance`).

Most controls **save the moment you change them**, and a short *Saving…* / *Saved* confirmation appears. The bookmark editor is the exception: it collects your edits and writes them when you press **Save**. Config only writes data that actually changed — a small settings edit does not re-upload every page of bookmarks.

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
│  [ + ] [ > ] [ : ] [ ? ] [ * ] [ ! ]   ← button bar         │
└─────────────────────────────────────────────────────────────┘
```

Side rail layout (optional — **Config → Behavior → Display → Button bar position → Side rail**):

```
┌──┬────────────────────────────────────────────────────────┐
│+ │  [header: date · health · config · pages]              │
│──│                                                         │
│> │  [Smart collections]  [Tag collections]  [Categories…] │
│? │    └─ bookmark rows                                     │
│: │                                                         │
│* │                                                         │
│──│                                                         │
│/ │                                                         │
│! │                                                         │
│★ │                                                         │
└──┴────────────────────────────────────────────────────────┘
```

### Header

- **Date/time** — Click for a **week overview** popover (today highlighted; optional **Open calendar** link when configured in General). Optional weather line below.  
- **health** — A **heartbeat icon** linking to `/#health`, with an inline pill counter (e.g. `3`) when there is something to report — **red** for a monitored bookmark that is down right now or an ordinary broken link, **amber** for warnings, hidden when healthy (**v2026.07.09**, styled like the inbox tab). The most severe state wins the badge: a **down monitor** takes priority over a broken link, which takes priority over warnings. A down monitor is counted apart from a broken link (**v2026.07.22.2**) — clicking opens `/?hv_filter=monitored#health` for an outage, `/?hv_filter=broken#health` for a broken link. When the number of down monitors **rises**, the icon **pulses once** to catch your eye; it stays quiet on a reload that merely finds an existing outage, on a recovery, and — via a 10-minute cooldown — on a monitor that flaps up and down. The pulse shares the broken red and is told apart by the movement, and it honours reduced-motion and the no-animations setting. Always shown (**v2026.07.16** — the Header & buttons hide toggle was removed). Open the same view from the keyboard with **`Shift+H`**.  
- **config** — Settings and bookmark management.  
- **pages** — Overview of all pages with counts (`,`).

### Button bar / side rail

The button bar can appear as a **floating bottom bar** (default) or as a **44 px left side rail** — set via **Config → Behavior → Display → Button bar position** or the `:buttonbar` command.

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
| 1 | Complete or skip the quick-start card | First visit |
| 2 | Open **config → pages & tags → pages** — add or rename pages | `/#config/pages-tags` |
| 3 | Open **config → pages & tags → categories** — create sections per page | `/#config/pages-tags` |
| 4 | Add 3–5 bookmarks with **&** quick-add | Dashboard |
| 5 | Press **>** and search by name | Dashboard |
| 6 | Press **!** and skim the cheat sheet | Dashboard |
| 7 | Enable a theme you like | **config → appearance** |
| 7b | (Optional) Skim **Config → Help → Tips & tricks** for more shortcuts | `/#config/help` |
| 8 | Create a ZIP backup | **config → data & backups** |
| 9 | (Optional) Install browser extension | `extension/` folder |
| 10 | (Optional) Import old browser bookmarks | **config → data & backups → Import browser bookmarks** |

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

The modal includes page, category, preview, tags, and note.

**Availability, Shortcut and Pinned sit above the *More options* fold** (**v2026.07.22.1**). Availability is the same **Off / Periodic / Monitor** choice as the bookmark editor in Config — with the interval picker for Monitor and the same explanation behind the **(i)** — so a bookmark can be set up for monitoring at the moment you add it. Before this the modal offered only a *Status check* box, which could not express the three-way choice: Monitor is a superset of Periodic, so *monitored* was unreachable here. **Pinned** uses the same pin pill as the inline editor and Config rather than a bare checkbox.

### 7.3 Paste a URL (`Ctrl+V`)

With the dashboard focused and no text field active, paste a URL. A choice dialog offers **Save to Inbox** or **Add bookmark** (full modal pre-filled). Set a default under **Config → Behavior → Search & inbox** (*Ask each time*, *Always add bookmark*, or *Always save to Inbox*). Paste is ignored while **inline edit** or the **tag word cloud** is open. If paste cannot open the form (no active page, Inbox disabled, or the feature is blocked), a notification explains what to do.

### 7.4 Inline edit after long-press

Long-press a bookmark row (~500 ms, not on the drag strip) to edit in place on the dashboard — including rows shown in **smart collections** (Today, Recently opened, etc.). The editor opens in a **nearly opaque panel** (~96% background) with a **full-page blur** behind it — including in the **launcher** preset, where other tiles blur but the form stays sharp and readable. The form shows field-level validation errors while you type. Success and error toasts use your UI language. **Save** or **Ctrl+Enter** writes changes to disk immediately (no separate dashboard Save button); **note** and **tags** sync to the bookmark on its category column and in the global store. Press **ESC** or click outside to dismiss; both use an in-app confirm dialog if you have unsaved changes. **Page switches**, **tag-filter** changes, and **config sync** from another tab also confirm before discarding unsaved edits. Background dashboard re-renders are skipped while unsaved inline edits are open. Keyboard grid navigation, **swipe page change**, and **Ctrl+V** paste are paused or blocked while the editor is open. Delete confirms first (modal above the editor), then persists right away; undo in the toast restores the bookmark on the server and in smart-collection views too.

### 7.5 Right-click menu (v2026.07.19)

Right-click any bookmark on the dashboard for its actions in one place:

| Item | What it does |
|------|--------------|
| **Open in new tab** | Opens the bookmark in a background tab and counts the open, like a normal click |
| **Copy URL** | Copies the URL to the clipboard; the row flashes green |
| **Edit** | Opens the same inline editor as long-press |
| **Tags…** | The quick-tag popover (also `Shift + T`) |
| **Move to…** | The move popover — another category or page (also `Shift + M`) |
| **Checking** (**v2026.07.20**) | Names the bookmark's current availability mode and opens the three-way choice — **Off** / **Periodic** / **Monitor** (also `Shift + C`) |
| **Delete** | Asks for confirmation first, then deletes with undo in the toast |

Nothing here is exclusive to the menu — all of it is reachable from the [command palette](#93-bookmark-actions) and config. The menu just puts it where most people look first.

Arrow keys move through the items and `Enter` activates one; `Esc` or a click outside closes it. It works on **smart collection** rows too. The menu deliberately stays out of the way where the browser's own menu matters: it does not open while the inline editor is active or over a modal, and **`Shift` + right-click** always gives you the browser menu instead. Not available on touch, which has no right-click — use long-press for inline edit there.

### 7.6 Config → bookmarks (bulk and detail)

**config → bookmarks** is the place for many edits at once: a searchable list with a page filter, an editor that expands the row you are working on, and a bulk toolbar for whole selections.

**Edit** on a row opens it in place. It carries every field a bookmark has — name, URL, page, category, tags, shortcut, note, pinned, icon, and availability checking (Off / Periodic / Monitor, with an interval for Monitor). Unlike the rest of config, the editor does not save as you type: it collects your changes and writes them when you press **Save**, so a half-finished row is never persisted. It warns you before discarding unsaved edits.

**+ Bookmark** opens the same add form the dashboard uses. Tick several rows to get the **bulk toolbar** — move to another page or category, pin, refresh favicons, add / replace / remove tags across the whole selection, or delete. **Select all** ticks the rows your filters are currently showing, not every bookmark you own.

The bookmark editor is comfortable on a wide window; on a narrow one the fields stack.

All bookmark lists in config (per-page editor, tags tab, stats) read from one **central bookmark store**, so tags and edits stay in sync across tabs.

### 7.7 Browser extension

Save the current tab to a chosen page or to **Inbox** (see [Browser extension](#18-browser-extension)).

### 7.8 Import

HTML export from Chrome/Firefox/Edge (see [Import, export, and backup](#17-import-export-and-backup)).

### 7.9 Inbox — capture links for later

**Inbox** is for links you have not sorted into pages yet.

1. Open **Inbox** — header tab, **`Shift+I`**, **`0`**, or **`:inbox`**.  
2. **Add** — paste `Ctrl+V` on the dashboard and choose *Save to Inbox*, use the extension **Save to Inbox**, or rely on *Always save to Inbox* in General settings. Fresh items show a preview placeholder until the server fills it in.  
3. **Browse** — filter *All* / *Unread* / *Snoozed*, search, and scroll date groups. Unread items show a badge on the Inbox tab.  
4. **Act on a row** — *Open* in a new tab, *Promote* to open the new-bookmark form pre-filled — with every page and category available in its dropdowns, so the bookmark can be filed anywhere (status-checked bookmarks are health-checked right away), *Mark read*, *Snooze* (`z`: 3h / tomorrow / weekend / next week), add a *Note* (`n`), or *Delete* (undo in the toast). Use the toolbar to **Mark all read** or **Clear read**.  
5. **Keyboard** — `j`/`k` move, `g`/`G` first/last, `Enter` open, `p` promote, `r` mark read, `n` note, `z` snooze, `d` delete (legend under the list).  
6. **Triage** — click **Triage** or run **`:inbox triage`** to walk unread items one by one: `J`/`K` move, `O` open, `P` promote, `R` keep (mark read), `D` delete, `Esc` close.

The first visit may show a short intro modal. Replay it from **Config → Behavior → General**.

### Duplicate URLs

nextDash warns when a URL already exists on the same page (canonical match: trailing slash, hash, host letter-case, and default ports are ignored — e.g. `https://x` ≡ `https://x:443`). You can still save anyway in the extension or modal when needed. Use **`:duplicate`** in search or the Health view to find duplicates across all pages. Imports **skip** duplicates and show a preview: e.g. **12 new, 3 conflicts (skipped)**.

---

## 8. Opening and using bookmarks

### Mouse

- Click the bookmark name (or icon area) to open the URL.
- Bookmarks **without a display name** show the site **hostname** in the grid (e.g. `docs.example.com`); hover or keyboard focus shows the **full URL** in the tooltip.
- Respect **open in new tab** setting from config.  
- **Launcher layout**: large tiles; click plays a short pulse animation.
- **Right-click** a bookmark for its actions — open in new tab, copy URL, edit, tags, move, delete (**v2026.07.19**). See [Right-click menu](#75-right-click-menu-v20260719). **`Shift` + right-click** gives the browser's own menu.
- **Long-press** (~500 ms, not on the drag strip) opens the [inline editor](#74-inline-edit-after-long-press).

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
| `Shift + I` | Open **Inbox** view (recommended; `0` still works when search is closed) |
| `Shift + H` | Open **Health** view |
| `0` | Open **Inbox** (when search is closed; legacy — prefer `Shift + I`) |
| `1`–`9` | Jump to bookmark page tab by position (tabs use `tablist` / `aria-selected` for screen readers) |
| `←` / `→` / `Home` / `End` | Move focus between page tabs when a tab is focused; `Enter` / `Space` activates the tab |
| `Shift + ←` / `Shift + →` | Previous / next page (plain arrows move bookmarks, not pages) |
| `,` | Page overview modal — `↑`/`↓` or `Tab`/`Shift+Tab` move between pages; `Enter` or `Space` switches page; focus stays trapped inside the panel; closing restores focus to the trigger |
| `<` | Open **config** (`<` is `Shift+,`). In config, `<` returns to the dashboard — asking to confirm first if there are unsaved changes (**v2026.07.17.2**) |
| `.` | Collapse or expand **all** categories at once (smart toggle — any open → all collapse; state remembered per page) |

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
| `Shift + C` (**v2026.07.20**) | Availability checking for the selected row — **Off** / **Periodic** / **Monitor**. The popover anchors below the row and opens on the current mode; pick with `o` / `p` / `m`, or arrow and `Enter` |
| `Ctrl + C` | Copy URL (row flashes green) |
| `[` | Toggle hover preview card on selection |
| `Delete` | Delete selected bookmark (confirmation dialog; `Shift+D` uses the quick-delete popover instead) |
| `Enter` / `Space` on **+ N more** | Expand or collapse a long category; selection returns to the last bookmark above the toggle so you can keep arrowing down |

### 9.4 Cheat sheet

Press **`!`** or **`F1`**. Focus lands in the filter box automatically. Type to narrow the list. When the **side rail** is active, a **Layout (side rail)** section lists tab order and `:buttonbar` hints. The cheat sheet does not open while the **page overview** (`,`), **tag cloud**, or another blocking overlay is open. On first open (desktop), a one-time **Got it** balloon may appear beside the modal — dismissing it does not close the cheat sheet.

**Rebinding shortcuts** — not available at the moment. The old configuration page had a **Keyboard** tab for remapping keys; it has not been rebuilt in the config view, and the setting behind it never took effect (it was stored but never read back), so it was retired rather than carried over half-working. **Custom key bindings are still in development.** Every shortcut keeps its default in the meantime (**v2026.07.23**).

**Occasional tips** (**v2026.07.19**) — now and then the dashboard shows one keyboard tip as a small toast with a **Cheat sheet** button beside it. It draws from the built-in tips catalogue, appears at most once every few days, never repeats a tip you have already seen, and stays away during first-run setup, on touch, and while a dialog or the inline editor is open. Turn it off under **Config → Behavior → General**.

### 9.5 Blocking overlays & focus

While any of these are open, the bookmark grid behind them is **inert** (not clickable) and keyboard focus stays inside the overlay until you close it:

| Overlay | Shortcut / trigger |
|---------|-------------------|
| Shortcut search | `>` (also `:` / `?` modes in the same panel) |
| Cheat sheet / recent | `!` / `F1`, `*` |
| Tag word cloud | `/` (desktop, when enabled) |
| Page overview | `,` |
| Quick-add omnibox | `&` |
| Quick move / quick tag / quick delete / checking | `Shift+M` / `Shift+T` / `Shift+D` / `Shift+C` |
| Inline edit | `;` |
| App modal | e.g. new bookmark `+`, confirmations, recent bookmarks `*` |

**Tab** / **Shift+Tab** cycle within the open overlay. **Escape** closes it and restores focus to the control that opened it (or the bookmark grid). One-time **Got it** discoverability balloons dismiss with **Esc** without trapping the overlay open. A `MutationObserver` re-syncs dashboard `inert` when overlays are added or removed so the grid is not left stuck non-interactive. With an **active tag filter**, only the bookmark list is `inert` — the filter banner and bulk toolbar stay interactive while the tag cloud is open. Grid shortcuts **`;`**, **`Shift+M`**, **`Shift+T`**, **`Shift+D`**, and **`Shift+C`** work on the keyboard-selected row when no overlay is open.

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

When **Tag cloud (/)** is enabled (config → behavior → display, on by default on desktop):

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
| `:inbox` / `:inbox triage` | Open Inbox (`Shift+I`, or `0`) or triage unread items one by one |
| `:config [section]` | Open config or tab (`bookmarks`, `backups`, `stats`, …) |
| `:stale [days]` | List stale bookmarks |
| `:health [filter]` | Open health view (`Shift+H`) — `broken`, `duplicate`, `stale`, `refresh`, … |
| `:health page [n]` | Open health with a specific page context |
| `:monitor` (**v2026.07.20**) | Shows how many bookmarks are checked (monitored and periodic). `:monitor off` turns checking off for all of them at once; `:monitor on` opens the health view filtered to never-checked bookmarks, where the bulk button confirms before enabling — there is deliberately no "monitor everything" |
| `:duplicate` / `:duplicates` | Scan for duplicate URLs across all pages (opens Health duplicates view) |
| `:find <text>` / `:find clear` | Hide non-matching tiles on page / clear filter |
| `:goto <url>` | Navigate to URL or domain |
| `:goto config` / `stats` / `health` | Quick navigation to config, stats, or health |
| `:dark` / `:title` / `:lang` / `:animations` / `:status` / `:opacity` | Display and theme toggles |
| `:telemetry` / `:telemetry on` / `:telemetry off` | Turn [privacy-friendly analytics](#analytics-and-privacy) on or off — opt-in, off by default (reloads the page) |
| `:collections` | Toggle smart collections (today, recent, stale, most used) |
| `:backup` / `:export` | Open config backups or download ZIP backup |
| `:favicons fetch` | Re-download every bookmark icon on every page (replaces existing icons) |
| `:metadata` | Health missing previews or config bookmarks |
| `:layout …` | default, compact, cards, masonry, list, launcher, … (presets — not layout version) |
| `:layoutversion` | List classic / modern |
| `:layoutversion modern` / `classic` / `toggle` | Switch layout version (`toggle` switches between classic and modern) |
| `:theme <name>` | Switch theme |
| `:density comfortable\|compact\|dense` | Row density |
| `:columns <1-6>` | Column count |
| `:buttonbar bottom\|bottom-left\|bottom-right\|side-left` | Button bar position (`side-left` = vertical rail on the left edge) |
| `:save` / `:saved` | Save / list saved searches |
| `:history` / `:history clear` | Search history |

### 10.6 Finders (`?`)

Format: `?shortcut query` — e.g. `?g nextdash` if `g` is configured to `https://www.google.com/search?q=%s`.

Configure finders in **config → pages & tags → finders** (desktop):

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

- Drag a bookmark from **anywhere on its row** to reorder within a category or drop it on another category (**v2026.07.14**). A single **click** still opens the bookmark, and a stationary **long-press** still opens the inline editor — only a drag gesture reorders.
- Dragging **across columns** shows a drop marker without the column flicker earlier versions had; the row settles into place when you release (**v2026.07.14**).
- Manual drag only works while a category is on **manual order**. If it is sorted **A–Z** or **Recent**, bookmarks there can't be dragged (the sort would undo it) — the category shows a hover tooltip, a not-allowed cursor, and a brief note when you try, reminding you to switch it back to manual order first (**v2026.07.14.1**). A plain click still opens the bookmark.
- Reorder saves **debounce 1 second** (like category order) and show a localized success toast.
- **Esc** undoes the last reorder if the debounced save has not completed yet.

### Reorder categories

- Drag the **`//` prefix** in the category title on the dashboard, or drag rows in **config → pages & tags → categories** (or focus a row and press **↑** / **↓**). The `//` acts as the drag handle — a plain click on it still toggles collapse.
- Order in **config → pages & tags → categories** saves automatically after a short debounce (~600 ms) with a localized sync toast.

### Reorder pages

- Drag the **grip** on a row in **config → pages & tags → pages**, or focus a row and press **↑** / **↓**.
- Order saves automatically after a short debounce (~600 ms) and shows a localized sync toast.
- **Archive** hides a page from the dashboard and page picker without deleting its bookmarks (restore from **config → pages & tags → pages**, the **Context** panel on Bookmarks when expanded, or the archived list there).

### Move between pages

- **Shift+M** on dashboard, or detail panel in config, or bulk move in config.

### Page customisation

Double-click a page tab **on desktop or tablet landscape** (not on mobile — avoids accidental renames on touch):

- Set **emoji** icon  
- Choose **colour dot** (8 accents)

Use **config → pages & tags → pages** to rename a page on any device.

### Sorting

- Each category header has **A–Z** and **Recent** toggles at full visibility (including **Other** and unknown-category blocks); click an active toggle again to return to manual drag order. Sort buttons are keyboard-focusable; **←** / **→** move between them without collapsing the category.
- Sort is view-only: bookmark order in data is unchanged until you drag (manual mode only).
- **`:sort`** applies to the category you are focused in (keyboard selection or first category as fallback) and shows the category name in the command palette.

### Collapse

Click category header or chevron, or focus the header and press **Enter** / **Space**. Press **`.`** anywhere on the dashboard to collapse or expand **every** category at once (smart toggle — if any category is open, they all collapse; otherwise they all expand); state is remembered per page. **Always collapse categories** can be set in general settings.

---

## 12. Tags, notes, and metadata

### Tags

- Comma-separated in modal, inline edit, or config detail.  
- Stored lowercase, trimmed, deduplicated.  
- **Search (`>`):** `tag:work` filters results in the search overlay (partial match); dashboard layout unchanged.  
- **Dashboard tag cloud (desktop):** `/` or / FAB — toggle one or more tags while the modal stays open; **OR match** (bookmarks with any selected tag); per-tag filter chips in the header; **Escape** on the dashboard clears all filters.  
- **Command palette (`:`):** `:tag work` lists bookmarks in the palette only; `:tag +work` / `:tag -work` mutate tags on the selected bookmark.  
- **config → pages & tags → tags** (desktop): global tag management across all pages.  
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
- **Show favicons** — **Config → Appearance** or `:favicons on/off` on the dashboard.
- **Refresh every icon** — `:favicons fetch` re-downloads the favicon of every bookmark on every page, replacing the ones already stored, so icons that changed at the source are updated too. A progress bar shows how far along it is. The same run happens automatically once on a new install, right after you finish or skip the first-run setup card while keeping the example bookmarks. Individual icons can also be refreshed from the health view (`f` on the selected row), and **Config → Bookmarks** has a bulk **Refresh favicons** button for a selection.  
- **Fetch favicon** in config detail or health actions.

### Shortcuts

- Single character per bookmark; must be unique across **all pages** when set.  
- Shown in the shortcut column; included in screen reader labels.

---

## 13. Smart collections and custom collections

### Smart collections (built-in)

Enabled in **config → pages & tags → collections**:

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

**config → pages & tags → collections**: name, icon, AND/OR rules on tag, category, or shortcut. Each rule's value field autocompletes from the tags, categories, and shortcuts already in use, so you rarely type a full value (shortcut suggestions keep their original casing). Appear as dashboard groups above regular categories.

### Tag collections

When enabled, one auto-group per tag that meets minimum count.

---

## 14. Layouts, themes, and appearance

### Layout version (Classic / Modern)

nextDash has two **layout versions** — same bookmark grid and categories, different visual polish:

| Version | What it does |
|---------|----------------|
| **Classic** | Original dashboard styling and spacing (default). |
| **Modern** | Refreshed visuals — updated row highlights, tooltips, and chrome — same structure underneath. |

**Glass was removed in v2026.07.14.2.** It was a third parallel layout that needed its own styling for every visual change. Dashboards set to Glass switch to **Classic** automatically — nothing to do, and a one-time note tells you it happened. Your theme and presets are unaffected.

**Themes control all colors** in every version; switching layout version does not change your theme.

**Where to switch**

- **Config → Behavior → Layout** — layout preset and density, each with a live description under the control.  
- **Quick-start card** — the layout step covers packed columns and columns per row (see [Quick-start card](#quick-start-card)).  
- **Dashboard command mode** — `:layoutversion` lists options; `:layoutversion modern` / `:layoutversion classic` applies one; `:layoutversion toggle` switches between them.  
  (This is **not** the same as `:layout`, which switches **presets** like launcher or compact — see below.)

**Post-onboarding prompts** — On desktop, an unread **What's new** release may open automatically on dashboard load. Last-seen release syncs via **`settings.discoverabilityState`** in `settings.json` across browsers (**v2026.07.01.1**). The quick-start card and its checklist are the only other first-run prompts (see [Quick-start card](#quick-start-card)) — the tours, spotlights, and discoverability promo balloons this section used to describe were all removed in **v2026.07.17**.

### Layout presets

| Preset | Character |
|--------|-----------|
| **Default** | Classic multi-column grid |
| **Compact / Cards / Masonry / List** | Density and visual style |
| **Launcher** | Large favicon tiles; enable via **Config → Behavior → Layout** or `:layout launcher` in search |

### Themes

- 37+ built-in families (dark/light pairs).  
- **config → appearance → custom themes** — build, edit, and delete your own palettes. A contrast check warns when text against background is too weak to read. Changes preview live on the dashboard behind the config view; leaving the tab drops an unsaved preview rather than leaving the dashboard half-edited.
- **config → appearance → general** — pick the active theme for the whole app (built-in or one of your own).
- **Auto dark mode** follows system light/dark for built-in theme pairs; your saved theme id stays stable (the app applies the matching dark/light variant without overwriting the palette name). Disabled with a fully custom theme.
- **Favicon harmonisation** — recolours site favicons that clash with your theme (styles: **Muted**, **Tinted**, **Overlay**, with an intensity slider). Set per theme under **config → appearance → theme**, so the dark and light variant of a pair are configured separately. **New installs start with it on** (Muted, intensity 0.5) for both Moss & Stone variants; existing dashboards keep whatever they had.

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

**Release notes never open by themselves.** A new version does not pop a modal in front of you on load — you open it with **★** or from **Config → Overview → Show what's new**. If a release seems not to have arrived at all, it is usually the browser cache: an already-open tab keeps the files it loaded, so a hard refresh (`Cmd/Ctrl+Shift+R`) settles it (**v2026.07.23.1**).

**★** opens release notes from a **corner FAB** below the `/` tag cloud on desktop (bottom-left by default; mirrored when the button bar is docked left/right; pinned at the bottom of the side rail). It is **not** in the centre dock toolbar. **Config → Help** also has **Show what's new** at the top. The latest release loads first; scroll to load up to the **25 most recent** versions (each fetches its own JSON on demand, with a loading skeleton). The same recap — including **v2026.07.23.2** the add-bookmark modal offering every page again (promoting from the inbox, pasting a URL, the search hint, the toolbar and the empty state all opened the form with a single hardcoded page in its dropdown); **v2026.07.23.1** a cache-busting hotfix, after v2026.07.23 shipped without moving the tokens in its asset URLs and browsers that had visited within the previous day kept serving cached copies of the release notes and the config view; **v2026.07.23** configuration becoming a view inside the dashboard (eight sections instead of fourteen tabs, deep links to any section or sub-tab, settings that save as you change them with the bookmark editor as the exception, a new Overview screen, Reset on its own sub-tab with a typed confirmation, arrow-key navigation on the sub-tab strips, and the old page removed in full — 34,255 lines and roughly 1.2 MB of JavaScript no longer loaded; custom key bindings are still in development); **v2026.07.22.6** the inbox reading as one system with the health view (site icons a 3rem square in the same spot with the same padding, the multi-select checkbox overlaying the icon corner instead of a leading column, real favicons fetched and stored like bookmarks so the inbox shows the actual site icon, summary tiles above the feed, and an added date per row; a stored inbox favicon is cleaned up on delete/promote unless still referenced); **v2026.07.22.5** bookmark icons showing in the health view again (they load from `/data/icons/` like the dashboard instead of the site root, so the favicons appear and the console 404s are gone; a missing icon falls back to a 🔗 glyph); **v2026.07.22.4** Health Edit opening a clickable inline form on the bookmark's page (neighbouring rows still blur; drag paused while editing); **v2026.07.22.3** a **Create + New** button in the add-bookmark modal that saves the bookmark and keeps the form open (page and category preserved) so several can be added in a row; **v2026.07.22.2** deleting a bookmark in the health view clearing it from the dashboard at once and the header flagging a monitor that is down apart from a broken link; **v2026.07.22.1** availability checking in the add-bookmark modal and a **Monitored** tile that turns red when something stops responding; **v2026.07.22** the inbox gaining sorting, shareable links and per-row selection, the health view's CSV **Export** and always-visible **Monitored** filter, a monitoring chart you can read point by point, and uptime history travelling with your backups; **v2026.07.21.1** enlarging a monitored bookmark's statistics from the health view (a large response-time chart, 24h/7d/30d uptime side by side, interval and outage history, opened with **⤢** or `i`) and the fix for outage lengths always reading *0s*; **v2026.07.21** usage analytics becoming **opt-in** (off until you turn it on, with a first-run card that asks rather than announces, and browser-storage fixes that stop config reporting saves it never made); **v2026.07.20** uptime monitoring for bookmarks; **v2026.07.19** privacy-friendly anonymous analytics (since v2026.07.21 opt-in, under **Config → General → Advanced → Privacy**), a **right-click menu** on dashboard bookmarks, and keyboard access to the **+ N more** toggle on long categories; **v2026.07.18** tidier long categories (a per-category **Items per category** limit, default 15, hiding the rest behind a **+ N more** / **show less** toggle so one big category no longer towers over the others; smart collections are never capped and expanding is remembered), the **Configuration** page aligned with the dashboard/inbox/health top bar and title size (no more jump when switching, save row and tabs as one seamless bar), and new-install defaults (**Midnight Ink** dark theme following the system, and starter bookmarks without the Tech category / Unraid / Phoronix); **v2026.07.17** removal of every tour, spotlight, and promo balloon in favor of the quick-start card and a **Tips & tricks** section in Help; **v2026.07.16** Inbox snooze / keyboard triage / notes / bulk mark-read & clear-read, Health always-on with optional background rechecks, Edit → dashboard inline editor, and corrected deep-link filters; **v2026.07.15** health as an in-dashboard view (opened from the heartbeat icon without leaving the dashboard; legacy `/health` links redirect to this view), new mnemonic view shortcuts (**Shift+H** for Health, **Shift+I** for Inbox, with legacy `0` kept), a cleaner config header that now keeps only **back to dashboard**, and health-view wording/localized cheat-sheet additions aligned across **EN/NL/DE/FR**; **v2026.07.14.1** clearer feedback when a category sorted A–Z or Recent can't have its bookmarks dragged (hover tooltip, not-allowed cursor, and a one-off note pointing you to switch back to manual order); **v2026.07.14** dashboard organising (drag a bookmark from anywhere on its row to reorder or move it between categories, no column flicker across columns, `.` to collapse or expand every category at once, the `//` category-title drag handle for reordering sections, and a **+ New…** option in the add-bookmark form's Page/Category dropdowns to create a page or category inline); **v2026.07.13.1** automatic-backup refinements (restore a stored backup in one click, a totals line, a Back Up Now last-backup-date fix, and same-second filename uniqueness); **v2026.07.13** automatic weekly local backups (a rolling set of 3 ZIPs under Config → Backup with download/delete/Back Up Now and a countdown, toggleable, restart-robust) plus two health fixes (bulk delete and unusual favicon filenames); **v2026.07.12** fresh defaults for new installs (Kelp Drift dark theme with auto dark mode on, and starter bookmarks seeding a *Tech* category with Unraid/Phoronix and a *Social* category with Bluesky instead of Facebook/Instagram) plus dashboard polish (the `&` quick-add omnibox restyled to match the search/commands/finders overlays, *Config → Bookmarks* opening on the first page each fresh load while remembering the session's page, and reliable loading of icons with unusual filenames); **v2026.07.11.4** smoother dialogs (keyboard and screen-reader focus handed back cleanly when a dialog closes, no console warnings); **v2026.07.11.3** bulk tags in the config bookmarks bulk toolbar (add, replace, or remove tags across every selected bookmark at once, with tag autocomplete); **v2026.07.11.2** tags moved above the fold in the bookmark forms (out of *More options*, right under Page/Category), the dashboard inline editor reordered to match (Page → Category → Tags → Note), autocomplete on custom-collection rule values, and a back/forward-cache fix; **v2026.07.11** clearer General settings (busiest sections split into labelled sub-groups: Localization → language / date & time, Appearance & Style → theme / text / extras, Layout → grid / spacing / extras), the Stats/Pages/Tags/Theme config tours no longer auto-starting (run them from Config → General → Tours & onboarding), plus accessibility polish (config spinner labels, health skip-to-content link, lazy category icons, and a no-JavaScript fallback message on the dashboard); **v2026.07.10.2** gzip-compressed responses (HTML/JS/CSS/JSON transfer 70-90% smaller), deferred config tour scripts (~374 KB) and peripheral dashboard scripts (~107 KB) off first paint, a line-style dashboard inbox icon matching the health icon, and quieter health borders (same cleanup as config: softer tile/panel borders, intro frame dropped, sections by spacing and headings); **v2026.07.10.1** quieter config borders (fewer nested frames; sections separated by spacing and headings, classic layout); **v2026.07.10** self-hosted default font (no Google Fonts request, works offline), deferred promo scripts for faster first paint, correct per-theme browser/PWA `theme-color`, centralized CSS cache-busting, and this 25-release modal history; **v2026.07.09** header health icon with counter (on by default), roomier dashboard side margins with exact config/health alignment at every width (including above 1600px), rounded status-row highlights with extra left inset for favicon clearance, config header health icon parity (dashboard-style icon + counter, inbox pill removed), and Stats inbox insights plus expand/collapse-all with remembered state; **v2026.07.08.1** General quick-link scroll offset hotfix; **v2026.07.08** Help section rework, sticky accordion, animated Ko-fi CTA, and split-shell divider/border fixes; **v2026.07.07** General split-shell (sticky quick links, section accordion), Advanced split into smaller cards, and number-input styling; **v2026.07.05.1** hotfixes (★ FAB placement, Config Help modal chrome, status-row highlight, save-indicator and merge fixes); **v2026.07.05** config shell polish (Help split-shell B5, flattened Tags/Backups/Theme cards, B10/C15), dashboard chrome (unified chips, toolbar modals for recent/help, D8 recent usage, D12 status-row tokens, fresh-install footer defaults, Classic early-beta notice); **v2026.07.04** config surface polish (General layer toolbar, active tab styling, Stats split-layout, Bookmarks master/detail, Theme colors divided list); **v2026.07.03** activity log, security hardening, extension shortcuts, hash-based data revision, 7-release modal history, General layer scroll preservation, and Playwright E2E suite green; **v2026.07.02** bookmark category and tag sync and data revision; **v2026.07.02** config polish (Stats tour, B6–B11, A8/A10, C15); **v2026.07.01.8** inline edit focus (opaque panel + tour blur) and config C14/C15 (Extras unsaved dot, broader reduced motion); **v2026.07.01.5** config surface polish; **v2026.07.01.4** config polish; **v2026.07.01.1** config surface parity; **v2026.07.01** config tab bar v5; and **v2026.06.31** config tab consistency — is summarized under **What's new** in **Config → Help**.

---

## 15. Status monitoring and health

### Per-bookmark status (dashboard)

When enabled, bookmarks can show online/offline from ping checks. Per-bookmark options live in the **Bookmarks** editor; the global settings are under **Config → Behavior → Status & health**. Client re-check interval is configurable (1–30 minutes, default 5). Optionally enable **background health rechecks** under **Config → Behavior → Status & health** so the server periodically re-pings status-checked bookmarks (off by default; 6h–weekly, default 24h) without a manual Retest all.

### Health view (`/#health`)

Central place to triage issues inside the dashboard UI. Open it with the header **heartbeat** icon, **`Shift+H`**, **`:health`**, or a `/#health` deep link:

```
Summary tiles (click to filter) → Compact controls (filters, search, sort, retest)
                                              ↓
                         Bookmark list (score, actions, row menu)
```

| Feature | Use |
|---------|-----|
| **Score 0–100** | Combines broken, duplicate, shortcut conflict, stale, missing preview, unused |
| **Score breakdown** (**v2026.07.14.2**) | Click the score badge — or press `s` — to unfold how the score was reached: every bookmark starts at 100, each issue lists what it costs (broken −60, duplicate −15, shortcut conflict −15, never checked −10, not opened in 30 days −10, never opened −10, stale check −5, no preview −5), down to the total |
| **Summary tiles** | Compact stat tiles; click a tile to jump to that filter. **Monitored** (**v2026.07.22.1**) sits directly after **Healthy** and colours itself from live state: the whole tile turns **red** while any monitored bookmark is unreachable, **green** while they all answer, and stays neutral at zero. Its tooltip names the split (*1 of 3 not responding*); clicking opens the monitored list and is remembered. A monitor awaiting its first check counts as neither, since unknown is not the same as failing |
| **Filters** | broken, duplicate, shortcut-conflict, stale, unchecked, unused, missing preview, healthy, **monitored** — default **broken** on first visit, and your last filter and sort come back on the next one (**v2026.07.22**); a `?hv_filter=` deep link still overrides what was stored |
| **Monitored filter** (**v2026.07.22**) | Offered as soon as there are bookmarks, not only once something is already monitored — it used to be invisible to anyone who had not already found the feature. An empty Monitored list explains what monitoring does and how to switch it on (`c` on a row) rather than reporting "no issues found" |
| **Export** (**v2026.07.22**) | Downloads the **current filter and search** as CSV — name, URL, status, score, page, category, last checked, and the same issue wording the score panel shows. For working through findings beside a spreadsheet, or handing someone the list. Values starting `=` `+` `-` `@` are prefixed so a spreadsheet treats them as text instead of formulas; a UTF-8 BOM keeps accented titles intact in Excel |
| **Controls panel** | Search, status pills, sort, export, and retest action in one compact block |
| **Search** | Name, URL, category, page |
| **Edit** (**v2026.07.16**) | Row Edit (or `Enter`) leaves the Health view, opens the bookmark’s page, and launches the dashboard **inline editor** (falls back to Config when unavailable) |
| **Favicon** | Shows stored bookmark icon; refresh per row |
| **Action toolbar** | Config-style buttons per row: open URL, dashboard deep link, re-check status, favicon, overflow (**Status** → re-check status; **detect redirect**, **refresh title**, **archive**, delete) |
| **Action runtime** | Row actions are guarded against overlap and refresh the health report after changes |
| **Detect redirect** | Overflow **detect redirect** uses a fast redirect-only suggest (`redirectOnly=1`, skips title fetch); confirm shows the proposed URL; errors and timeouts appear in the status bar |
| **Keyboard** (**v2026.07.14.2**) | `j`/`k` or arrows move focus; `Tab` steps one row at a time (not through every control) and releases at either end; `g`/`G` (or `Home`/`End`) first/last; `Enter` → inline editor; `o` → open URL; `s` → score breakdown; `p` → re-check; `f` → favicon; `x` → select; `m` → more actions (arrows inside the menu, `Esc` back to the row); `c` → availability checking (**v2026.07.20**); `i` → enlarged monitoring statistics on a monitored row (**v2026.07.21.1**). The shortcut legend under the feed lists them (**v2026.07.16** — the duplicate legend under the toolbar was removed) |
| **Background rechecks** | Optional server-side schedule under **Config → Behavior → Status & health**; keeps the Health view current without opening Retest all |
| **Check mode per row** (**v2026.07.20**) | Each row shows its current mode (**Off** / **Periodic** / **Monitor**) as a button. Click it, or press `c`, to change it — the list keeps its scroll position and filter, so a filtered list does not reshuffle while you work down it. Options carry their own letters: `o`, `p`, `m` |
| **Bulk enable** (**v2026.07.20**) | On a **filtered** list, a button offers to switch the visible rows to Periodic or Monitor at once, confirming the exact count first. Never offered on the unfiltered **All** list, where it would point the scheduler at every bookmark you own |
| **Monitoring** (**v2026.07.20**) | A monitored row shows a **heartbeat bar** of recent checks, **uptime** over 24h / 7d / 30d, and a response-time **sparkline**; the expanded panel adds **outage history** (start, duration, cause), or *down since* while it is still down. A **Monitored** filter narrows the list to these rows. Interval is 5 minutes to 24 hours (default 15); history is kept 30 days in `data/health-history.json` |
| **Enlarge statistics** (**v2026.07.21.1**) | The row strip only has room for a 24h figure and one ping. The **⤢** button at the end of it — or `i` — opens the same monitoring data at full size: a large response-time chart with min / average / max marked and a tooltip per point, **uptime side by side for 24h / 7d / 30d** with the number of checks behind each, a taller heartbeat, the check interval and last check, and the full outage list. A window with no samples yet reads *no data* rather than 0%, so a monitor enabled an hour ago does not look like a day of downtime. Nothing is re-fetched — it is the report already on screen — so it opens instantly. `Esc` closes it and leaves your place in the list. The button only appears once there is something to show: a monitored bookmark still awaiting its first check does not get one |
| **Reading values off the chart** (**v2026.07.22**) | The chart is interactive: click or hover anywhere in a measurement's slice of the plot — a full-height column, not just the dot — and the **readout under the chart** names that measurement: response time, the time it was measured, how many checks the point folds together, and whether it was up, down or degraded. It opens on the most recent measurement rather than empty. `←` / `→` walk point to point and update the readout as they go, skipping buckets with no measurement so you never land on an empty reading. The chart is a single `Tab` stop, so **Close** stays one `Tab` away, and tabbing back in returns to the point you were reading |
| **Downtime alerts** | Optional webhook under **Config → Behavior → Status & health**, posted when a monitored bookmark goes down and again when it recovers. Fires only after N consecutive failures (default 3, range 1–10) so a single hiccup stays quiet. Works with ntfy, Discord, Slack, and similar. Local addresses are refused unless **Allow local bookmarks** is on — the same SSRF rules as pings |
| **Layout parity** | Uses the same **Classic / Modern** layout version and visual settings as the dashboard (preset, density, custom background, opacity, font weight, animations, auto dark mode); updates when you save in config |
| **Row action styling** | Per-row toolbar buttons and overflow menu match the active layout (rounded chips) |
| **dashboard link** | Jump to bookmark on correct page/category |
| **Re-check status** | Re-test a URL; failures show specific errors (e.g. HTTP 404, Timeout, DNS). The row updates immediately (**v2026.07.14.2** — a cleared error used to stay on screen for up to three minutes, which made the fix look like it had failed) |
| **Bulk** | **Retest statuses** from the toolbar |
| **Retest scope** (**v2026.07.14.2**) | Bookmarks only get status checks when **Check status** is on for them (off by default, set per bookmark in **Config → Bookmarks**). Retest used to skip everything else — including rows flagged **broken**, which this page can't switch on — so those could never be cleared here. Retest now also tests any bookmark with a recorded error, tells you plainly when there is nothing to test, and stops after 250 checks per run (each takes up to 3s; run it again to continue) |
| **Detect redirect result** (**v2026.07.14.2**) | An applied redirect is checked against the new address before the row counts as healthy. If the replacement fails too, the row stays red with the reason instead of reporting a fix that was never verified |

Filter, sort, and search state persist in the session across refreshes and sync to the URL (`hv_filter`, `hv_sort`, `hv_q`).

**URL deep links** — Open health view with query parameters:

| Parameter | Example | Effect |
|-----------|---------|--------|
| `hv_filter` | `/?hv_filter=broken#health` | Pre-select a filter pill |
| `page` | `/?page=2#health` | Open health with a specific page context |
| `hv_sort` | `/?hv_sort=name#health` | Set sort order |
| `hv_q` | `/?hv_q=github#health` | Pre-fill search |
| `hv_refresh` | `/?hv_refresh=1#health` | Run retest-all on load |

From the dashboard, **`Shift+H`** opens the Health view directly. **`:health`** (command mode) opens it with optional filters (`broken`, `duplicate`, `stale`, …) or `refresh` to re-scan. **`:stale`** overflow rows link to `/?hv_filter=stale#health`.

The dashboard **health** icon (**v2026.07.09**, a heartbeat glyph styled like the inbox tab) shows a compact counter pill for broken links and warnings (including shortcut conflicts) — broken count takes priority over warnings, red for broken and amber for warnings, hidden when healthy (**v2026.07.01.1**). When broken issues exist, the link opens `/?hv_filter=broken#health`. Keyboard entry is **`Shift+H`**. The config view's **Overview** links to the same place when something needs attention.

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

Configuration is a **view inside the dashboard**, not a separate page. It opens in place — same tab, same session, no page load.

| To open | To leave |
|---------|----------|
| **`Shift+S`**, **`<`** (`Shift+,`), the **config** link in the header, or the `/#config` address | **`Escape`** (unless you are typing in a field), or the back link |

Pick a section from the rail on the left, or link straight to one with `/#config/<section>`. Sections that have sub-tabs extend that: `/#config/behavior/privacy` opens Behavior on its Privacy tab, and the address bar keeps up as you click, so whatever you are looking at can be copied and shared.

### The eight sections

| Section | What lives there |
|---------|------------------|
| **Overview** | At-a-glance health, headline counts, anything needing attention, and the latest release notes |
| **Pages & tags** | Pages, categories, tags, finders, and custom collections — five sub-tabs |
| **Bookmarks** | The bookmark list and its editor, with bulk actions |
| **Appearance** | Theme, background, fonts, icon size, and custom themes |
| **Behavior** | Every setting, grouped into seven sub-tabs |
| **Data & backups** | Backup, restore, import, export — plus **Reset** on its own tab |
| **Statistics** | Usage insights across five sub-tabs |
| **Help** | In-app documentation (EN/NL/DE/FR) across seven sub-tabs |

### Saving

**Most settings save the moment you change them.** Tick a checkbox, pick from a dropdown, drag a slider — it is written and confirmed with a short *Saved* message. There is no save button to hunt for and nothing to lose by navigating away.

The **bookmark editor is the exception**: it collects your edits and writes them when you press **Save**, so a half-finished row is never persisted. It tells you when it has unsaved changes and asks before you discard them.

Config only writes what actually changed — editing one setting does not re-upload every page of bookmarks.

### Sub-tabs

Five sections divide their content further. Every strip is a proper tab widget: **`←`/`→`** move between tabs and wrap around at the ends, **`Home`**/**`End`** jump to first and last, and the strip is a single stop in the page's tab order rather than one stop per tab.

| Section | Sub-tabs |
|---------|----------|
| **Pages & tags** | Finders · Tags · Collections · Pages · Categories |
| **Appearance** | General · Custom themes |
| **Behavior** | General · Date & weather · Layout · Display · Search & inbox · Status & health · Privacy |
| **Data & backups** | Backups & data · Reset |
| **Statistics** | Overview · Activity · Content · Inbox · Health |
| **Help** | Getting started · Configuring · Pages & bookmarks · Search & keyboard · Health & inbox · Data & hosting · About |

### Working with bookmarks

**Bookmarks** lists every bookmark with a search field and a page filter. **Edit** expands a row in place rather than opening a separate panel, carrying name, URL, page, category, tags, shortcut, note, pinned, icon, and availability checking (Off / Periodic / Monitor, with an interval for Monitor).

**+ Bookmark** opens the same add form the dashboard uses. Tick several rows for the bulk toolbar — move to another page or category, pin, refresh favicons, edit tags across the selection, or delete. **Select all** applies to the rows your filters are currently showing, not the whole library.

### Appearance

**General** covers theme, background (none / gradient / image, with opacity), fonts, icon size, and the display toggles. **Custom themes** is a full editor: build a palette, check its contrast, and apply it. Changes preview live on the dashboard behind the config view; leaving the tab drops an unsaved preview rather than leaving the dashboard in a half-edited state.

Many controls carry an **ℹ** button explaining what the setting does, and a **↺** to put it back to its default.

### Reset (Data & backups → Reset)

The destructive actions sit on their own sub-tab so they are not something you scroll past while changing backup settings.

- **Delete all bookmarks only** — removes every bookmark, keeps pages, categories, and settings. Asks once.
- **Reset all data** — removes everything. Asks twice: a confirmation, then you type **RESET** (or the word in your language) before the button becomes clickable.

Back up first — neither can be undone.

### Keyboard

| Keys | Action |
|------|--------|
| `Shift+S` or `<` | Open config from the dashboard |
| `Escape` | Close config and return to the dashboard |
| `←` / `→` | Previous / next sub-tab (wraps at the ends) |
| `Home` / `End` | First / last sub-tab |

Shortcuts do not fire while focus is in an input, textarea, select, contenteditable field, or a modal.

---

## 17. Import, export, and backup

### ZIP backup (full instance)

**config → data & backups → Backup** — ZIP, settings export, and CSV sections appear as divided rows inside one fused surface card on all layout versions (**v2026.07.01.1**).

Includes pages, bookmarks (with tags), categories, **finders** (`finders.json`), settings, custom themes (`colors.json`), **uptime monitoring history** (`health-history.json`, **v2026.07.22**), uploaded dashboard favicon/font, and bookmark icon files under `data/icons/`. Legacy icon files that lived directly in `data/` are exported as `icons/<filename>` so bookmark references survive a full round-trip.

Monitoring history is the one piece of health data that is **measured** rather than derived, so it is the one that is archived: without it a restore resets every monitored bookmark to *waiting for its first check* — no response-time chart, no uptime windows, no outage list — and a 30-day figure takes 30 days to earn back. The **preview cache** and **health cache** are deliberately left out and cleared on import: a scan rebuilds those in minutes.

The panel shows **Last backup: …** after you create a ZIP (stored locally in the browser).

**Import ZIP** replaces **all** current data. **Always backup first.**

Do not rename files inside the ZIP.

Import is **atomic**: files are staged, orphan icons and stale JSON are removed, then everything is committed in one step. If the ZIP **omits** `finders.json`, your **existing finders are preserved** (not deleted as orphans). The same applies to `health-history.json` (**v2026.07.22**): every ZIP written before monitoring history was archived omits it, and treating that absence as a deletion would throw away measurements the archive never carried.

History for bookmarks that the imported data no longer monitors is **not** removed by the import itself; the monitor scheduler sweeps those orphans on its next tick (within a minute), so the file settles on its own.

Bookmark URL validation during import uses **`allowLocalBookmarks` from the imported `settings.json`** when that file is in the ZIP (read **before** bookmarks — not the server’s current setting).

Bookmarks with **invalid URLs** (wrong scheme, or private/loopback hosts when localhost bookmarks are disabled) are **skipped** during import; the UI shows how many were skipped alongside new and conflict counts. Icon filenames in imported JSON are sanitized.

### Automatic backups (v2026.07.13)

**config → data & backups → Automatic backups** — nextDash automatically creates a full ZIP backup (the same contents as a manual ZIP backup) **once a week** and stores it **on the server**, under `data/auto-backups/`. This is separate from the browser download above: automatic backups live with your instance so they survive even if you never click *Create backup*.

- **Rotation** — the latest **3** automatic backups are kept. When a new one is written, the **oldest is removed** automatically, so the folder never grows without bound.
- **Download / Restore / Delete** — each stored backup lists its **date** and **size** with three actions: **Download** (saves the ZIP to your computer), **Restore** (replaces **all** current data with that backup after a confirmation, then reloads — the same effect as importing the ZIP, without the download/upload round-trip), and **Delete** (removes it from the server after a confirmation).
- **Back Up Now** — creates an automatic backup on demand at any time, without waiting for the weekly run. It works even when the weekly toggle is off, and refreshes the **Last backup** date shown in the ZIP section (v2026.07.13.1).
- **Totals** — a small summary line shows how many automatic backups you have and their combined size (v2026.07.13.1).
- **Countdown** — the section shows how long until the next scheduled backup.
- **Enable / disable** — a toggle (on by default) controls the **weekly** run. Turning it off stops new automatic backups but never touches **Back Up Now** or your existing files.

Filenames carry a UTC timestamp; if you create several backups within the same second, later ones get a `-2`, `-3`, … suffix so none overwrite each other (v2026.07.13.1). Like a manual **Import ZIP**, a restore is atomic and replaces everything — bookmark URL validation and skipped-URL handling work the same way.

Scheduling is **restart-robust**: rather than a fixed weekly timer, nextDash runs a backup whenever the newest one is older than **7 days**, so an instance that restarts often still gets its weekly copy. The `data/auto-backups/` folder is **excluded** from regular ZIP backups (no backup-in-backup).

> **Persistence note:** automatic backups are stored under the data directory. If you run in Docker, keep `data/` on a **mounted volume** (as the sample compose files do) so backups survive container rebuilds — an anonymous/ephemeral data directory would lose them.

### Settings export / import

**config → data & backups** — export or import **`settings.json` only** (without touching bookmarks or pages). Useful for migrating appearance, search, and status settings between instances. Import validates file size and strips migration markers so server-side migrations run correctly on next save.

### Factory reset

**config → data & backups → Reset → Reset all data**

Permanently deletes pages, categories, bookmarks, finders, settings, custom themes, uploaded favicon/font, all files under `data/icons/`, and health/preview caches. Recreates the **default sample bookmarks** (favicons prefetched in the **background** after startup), built-in settings, and default colour palette. Not a partial wipe — use ZIP backup first if you need to keep anything.

### Browser HTML import

1. Export bookmarks from Chrome, Firefox, or Edge as **HTML**.  
2. **config → data & backups → Import browser bookmarks**.  
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

Every config section is reachable on a phone — the sections stack and the controls reflow to the narrower width. Bulk bookmark editing is still most comfortable on a wide window.

**Tablets** — Portrait tablets and other touch layouts get the same config as desktop; the sections stack and controls reflow to the width available.

### Phone vs desktop

nextDash uses **phone layout** (≤768px width) for the reduced dashboard footer and config tabs. **Touch layout** (portrait tablets, coarse pointers) still skips hover previews but keeps the **full desktop dashboard toolbar** on tablets wider than 768px. A dismissible banner on dashboard and config summarizes the limits.

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
| **Config** | All eight sections; content stacks to the narrower width | All eight sections side by side |
| **Link preview on hover** | Off | When enabled in settings |
| **Quick-start card** | Skipped / hidden | Optional on first visit |

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

In **Config → Behavior → General**, the panel under **HyprMode** shows platform-specific install steps and an **Add to home screen** button when your browser supports it. HyprMode (launcher behaviour: open bookmark in a new tab and close the dashboard) pairs well with an installed PWA.

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

**Config → Behavior → General → Allow localhost & private-network bookmarks** is **on by default** for dev workflows. Turn it **off** if nextDash is reachable on a shared network (reduces SSRF via status/preview fetches).

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

### Analytics and privacy

nextDash can record **anonymous, privacy-friendly usage statistics** through a self-hosted [Umami](https://umami.is) instance at `stats.nextdash.cc`. Since **v2026.07.21** it is **opt-in**: off until you turn it on, and nothing is measured before then.

#### Being asked, once

On a fresh install a card appears on the dashboard offering **Turn on**, **What is recorded?**, and **No thanks**. Reading the explanation is still a one-click yes — the confirm button inside it turns analytics on directly.

Not answering is not counted as a no. Closing the card with **×**, or opening the explanation and closing it without deciding, puts the question away for a few days and then longer each time you do it. Simply having seen the card also quiets it for a day, so reloading the dashboard does not put the same card straight back in front of you. It never returns once you have actually answered — either way.

If you **already had analytics on** before upgrading, it stays on and you are not asked. An explicit *off* also stays off.

#### How to turn it on or off

Go to **Config → Behavior → Privacy** and tick or clear the **Privacy-friendly analytics** checkbox. The change applies after the page reloads. Setting it here counts as your answer, so the dashboard card will not ask again.

**Or from the keyboard.** Press <kbd>:</kbd> and run **`:telemetry on`** — or `:telemetry off` to switch it back. Typing `:telemetry` on its own lists both options and marks which one is current. The command writes the same setting as the checkbox and reloads the page for you, because the tracker script is emitted server-side: only a fresh page can actually load or unload it.

**For the whole server (self-hosting).** If you run nextDash for others, or simply do not want the choice to depend on anyone leaving a toggle alone, set the environment variable **`DISABLE_TELEMETRY=true`** (also accepts `1`, `yes`, `on`). Analytics is then off for every user: the tracker is never emitted, the setting cannot be re-enabled through the API or the `:telemetry` command, and the **Privacy** checkbox appears greyed out with a note explaining that the server operator switched it off. Running `:telemetry` in that situation lists one row stating it is disabled for this server, so the command never pretends to offer a choice it cannot honour. Each user's stored preference is left as it is, so it comes back unchanged if you later unset the variable.

When it is off, the tracker script is **not emitted into the page at all**. It is never downloaded, and **no request leaves your machine** — not even to fetch the script. This is not a client-side switch that quietly drops events; the analytics code simply is not loaded. Your choice is stored per user in `settings.json` as `analyticsOptIn`, so it follows you to every device you use nextDash on.

#### Why nextDash measures anything at all

Until now the project had no picture of how nextDash is actually used. Which views do people open? Does anyone use finders, the tag cloud, or the inbox? Do people find the cheat sheet? Where do they give up halfway through adding a bookmark? Without answers, deciding what to build next, what to fix, or what to remove is guesswork.

These statistics exist to answer exactly those questions — **which features get used, and what can be made better** — and nothing else. They are explicitly **not** meant to follow you around or build a picture of who you are. The measurement is abstract and technical: how people move through the app and which features they reach for, aggregated across everyone using nextDash.

#### What is measured

| Area | Recorded |
| --- | --- |
| Page views | dashboard, config, health, colors |
| Views | opening health and inbox |
| Navigation | switching dashboard pages (by position), which config tab you land on, the `<` dashboard↔config shortcut |
| Overlays | search, commands, finders, cheat sheet, tag cloud, what's-new, add-bookmark form |
| Bookmark opens | that one was opened, and whether from the dashboard, search, or recent |
| Commands | which command palette command was run, by name (`theme`, `config`, `density`, …) — only names from the built-in list; anything else you typed is discarded |
| Bookmark maintenance | starting an edit and saving it (and whether that was on the dashboard or in config), deleting, moving to another category (bucketed count, so a bulk move counts once), reordering by drag |
| Outcomes | whether adding a bookmark succeeded, or hit a duplicate, shortcut conflict, validation error, or failure |
| Inbox | snooze, mark-read, wake, promote, delete, mark-all-read, clear-read |
| Health | recheck, retest-all, detect-redirect, refresh-title, delete |
| Settings snapshot | once per page load: which features you have switched on, as plain yes/no values and small enums |

The settings snapshot is what makes it possible to see, for example, that a given option is used by almost nobody and could be simplified away — or that one is popular and deserves more attention.

#### What is never measured

No bookmark names, no URLs, no search queries, no page or category names, no notes, and no tags. No cookies are set, no personal profile is built, and you are not tracked across other websites. Where an exact number could be revealing it is rounded into a bucket (for example `2-5 items` rather than a precise count). The Umami instance is self-hosted by the project, so nothing is shared with an advertising network. The tracker host is allow-listed in the CSP (`script-src` and `connect-src`).

This is separate from the local **open count / last opened** [usage tracking](#usage-tracking), which stays entirely on your own server and is never sent anywhere.

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

Normal. Add bookmarks via **&**, **+**, import, or config. Walk through the quick-start card if it's offered — it covers language, layout, and weather before becoming a checklist that includes adding your first bookmark.

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

Most settings save the moment you change them, and confirm with a short *Saved* message. The bookmark editor is the exception: press **Save** there to write your edits.

### Config Save fails on local/private URLs

A bookmark may use a `192.168.x.x`, `localhost`, or other private host while **Allow localhost & private-network bookmarks** is off. Enable it under **Config → Behavior → General**, change the URL, or let nextDash suggest enabling the flag when private URLs are detected. Save posts settings before bookmarks so the flag applies during validation.

### Quick-start card doesn't appear

- It only shows once: if you already finished or dismissed it, `settings.quickStart.dismissed` is `true` and it will not come back on this account.  
- It is skipped on mobile — use a **wider browser window** or turn off mobile device emulation.  
- Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) after an update if you still run cached JavaScript.

### Settings search promo does not appear

- Use a **desktop-width** window (>768px; not portrait tablet or mobile emulation).  
- The promo shows once until dismissed, focused, or you start typing in the field — there is no reset control in Config for it.  
- Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) after an update if you still run cached JavaScript.  
- Wait a few seconds after the config page finishes loading.

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

### Config

```
Shift+S  or  <      open config from the dashboard
Escape              close config, back to the dashboard
← / →               previous / next sub-tab (wraps)
Home / End          first / last sub-tab
```

### Important URLs

| URL | Page |
|-----|------|
| `/` | Dashboard |
| `/#config` | Settings |
| `/#config/bookmarks` | Bookmark editor |
| `/#config/data-backups` | Backup / import |
| `/health` | Legacy redirect to `/#health` |
| `/colors` | Theme editor |

### Data location

Docker: mounted volume (e.g. `./data`). Binary: `./data` next to the executable.

---

## Further reading

- [README.md](README.md) — Install, security, and feature overview  
- [CHANGELOG.md](CHANGELOG.md) — Complete release history (new / fix)  
- **Config → Help** — Same topics as this manual, translated (EN/NL/DE/FR), with quick anchor links, **Browser extension**, **Security & self-hosting**, and a **What's new** recap  
- **In-app What's new (★)** — Latest release highlights first; scroll for up to **25 recent** versions (each loads on demand with a skeleton while fetching)  

---

*This manual describes nextDash as shipped in this repository. Minor details may vary by version; when in doubt, trust the in-app Help and What's new modal.*
