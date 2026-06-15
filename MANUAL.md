# nextDash — User Manual

**A complete, step-by-step guide to the keyboard-first bookmark dashboard.**

This manual is written for new users and for anyone who wants a structured reference. It complements the shorter [README](README.md) (install, security, changelog) and the in-app help at **Config → Help**.

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

Understanding four ideas makes everything else click.

### 4.1 Pages

A **page** is a separate tab on the dashboard (e.g. `main`, `Work`, `Home lab`). Each page has its own:

- Bookmark list  
- Category list  
- Optional page emoji and colour dot (double-click the tab to edit)

Switch pages with `1`–`9`, `Shift + ←/→`, or the **pages** overview (`,`).

### 4.2 Categories

**Categories** are sections within a page (e.g. `dev`, `news`, `tools`). In config they have an ID and display name. Bookmarks belong to one category (or uncategorised).

- Collapse/expand per category on the dashboard.  
- Drag the **grip** on a category title to reorder sections.  
- Double-click a category header to rename.

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

### 4.4 Config vs dashboard

| Dashboard `/` | Config `/config` |
|-----------------|------------------|
| Daily use: open, search, quick-add | Structure: pages, categories, bulk edit |
| Keyboard-first | Split-view bookmark editor, stats, backups |
| Live layout and themes | Save bar for many settings |

Changes in config often apply to the dashboard after **Save** (some toggles autosave).

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

### Header

- **Date/time** — Click for a **week overview** popover (today highlighted; optional **Open calendar** link when configured in General). Optional weather line below.  
- **health** — Link to `/health` with badge (e.g. `3 broken`) when issues exist; when broken links are counted, the link opens `/health?filter=broken`.  
- **config** — Settings and bookmark management.  
- **pages** — Overview of all pages with counts (`,`).

### Footer button bar

| Button | Key | Role |
|--------|-----|------|
| `:` | `:` | Command palette |
| `?` | `?` | Finders (external search shortcuts) |
| `>` | `>` | Search |
| `*` | `*` | Recent bookmarks on this page |
| `!` | `!` / `F1` | Keyboard cheat sheet |
| `+` | `+` | Full new-bookmark modal |

Hover a button on desktop for a tooltip with shortcuts.

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

With the dashboard focused and no text field active, paste a URL. The new-bookmark modal opens with the URL pre-filled. Paste is ignored while **inline edit** or the **tag word cloud** is open. If paste cannot open the form (no active page, or the feature is disabled in config), a notification explains what to do.

### 7.4 Inline edit after long-press

Long-press a bookmark row (~500 ms, not on the drag strip) to edit in place on the dashboard — including rows shown in **smart collections** (Today, Recently opened, etc.). The editor opens in a **visible panel** (solid background and border) — including in **glass** and **launcher** layouts, where other tiles blur but the form stays sharp. The form shows field-level validation errors while you type. Success and error toasts use your UI language. **Save** or **Ctrl+Enter** writes changes to disk immediately (no separate dashboard Save button); **note** and **tags** sync to the bookmark on its category column and in the global store. Press **ESC** or click outside to dismiss; both use an in-app confirm dialog if you have unsaved changes. **Page switches**, **tag-filter** changes, and **config sync** from another tab also confirm before discarding unsaved edits. Background dashboard re-renders are skipped while unsaved inline edits are open. Keyboard grid navigation, **swipe page change**, and **Ctrl+V** paste are paused or blocked while the editor is open. Delete confirms first (modal above the editor), then persists right away; undo in the toast restores the bookmark on the server and in smart-collection views too.

### 7.5 Config → bookmarks (bulk and detail)

**config → bookmarks**: list on the left, detail on the right. Best for many edits, tags, notes, favicon upload, and bulk actions.

At the top, the **Structure** workspace (pages, categories, archived pages, favicon policy) starts **collapsed** — expand it when you need structural edits. Below that you pick the active page, filter by category, and sort the list. **+ Bookmark** opens a small menu: **Add & edit** creates a blank row in the detail panel (Save when ready); **Quick add (⚡)** inserts a URL and saves immediately. In the detail panel, **category** stays visible; shortcut, icon, tags, previews, and status sit under **More options**. Select multiple rows for the **bulk toolbar** — **Move to** (page + category + Apply), pin, status, favicon refresh, delete. Bookmark changes apply to the dashboard only after **Save** in the config header.

All bookmark lists in config (per-page editor, tags tab, stats) read from one **central bookmark store**, so tags and edits stay in sync across tabs and after guided tours.

The first time you open this tab on a desktop-width window, a **10-step guided tour** walks through these areas (see [Guided config tours](#guided-config-tours)).

### 7.6 Browser extension

Save the current tab to a chosen page (see [Browser extension](#18-browser-extension)).

### 7.7 Import

HTML export from Chrome/Firefox/Edge (see [Import, export, and backup](#17-import-export-and-backup)).

### Duplicate URLs

nextDash warns when a URL already exists on the same page (canonical match: trailing slash, hash, host letter-case, and default ports are ignored — e.g. `https://x` ≡ `https://x:443`). You can still save anyway in the extension or modal when needed. Use **`:duplicate`** in search or the Health view to find duplicates across all pages. Imports **skip** duplicates and show a preview: e.g. **12 new, 3 conflicts (skipped)**.

---

## 8. Opening and using bookmarks

### Mouse

- Click the bookmark name (or icon area) to open the URL.  
- Respect **open in new tab** setting from config.  
- **Launcher layout**: large tiles; click plays a short pulse animation.

### Keyboard

- Start grid navigation with **Tab**, a click on a bookmark, **`G` then `1–9`** / **`GG`**, or the **first arrow key**; then use **plain arrow keys** to move the selection (`Shift+←/→` changes pages only).  
- After switching pages with **1–9**, the **first visible bookmark** on the new page is selected automatically.  
- **Collapsed categories** and **launcher tiles dimmed by search** are skipped by keyboard navigation.  
- **Category headers** are keyboard-focusable: **Enter** or **Space** toggles collapse (`aria-expanded` updates).  
- When you move the **mouse over bookmarks**, the stale keyboard highlight **softens** until your next keyboard move.  
- **Enter** or **Space** opens the selected row.  
- If the bookmark has a **shortcut** letter and you are not in an input, press that key to open.

### Hyprland / special setups

If **Hypr mode** is enabled in settings, bookmark clicks may be routed to your window manager instead of the browser default.

### Usage tracking

Each open increments **open count** and updates **last opened**. This powers smart collections (“Recently opened”, “Most used”, “Stale”) and stats.

### Recent panel (`*`)

Shows bookmarks you opened recently **on the current page** (not global). Use **`↑`/`↓`/`Home`/`End`** to move between items and bulk-open buttons. From the panel you can open one or use bulk actions aligned with **`:open last`**.

---

## 9. Keyboard navigation

### 9.1 Page navigation

| Keys | Action |
|------|--------|
| `1`–`9` | Jump to page tab by position (tabs use `tablist` / `aria-selected` for screen readers) |
| `←` / `→` / `Home` / `End` | Move focus between page tabs when a tab is focused; `Enter` / `Space` activates the tab |
| `Shift + ←` / `Shift + →` | Previous / next page (plain arrows move bookmarks, not pages) |
| `,` | Page overview modal — `↑`/`↓` or `Tab`/`Shift+Tab` move between pages; `Enter` or `Space` switches page; focus stays trapped inside the panel; closing restores focus to the trigger |

### 9.2 Bookmark grid

| Keys | Action |
|------|--------|
| `↑` `↓` `←` `→` | Move selection (first arrow key starts navigation if none selected) |
| `1`–`9` (page switch) | Also selects the first visible bookmark on the new page |
| `Tab` / `Shift+Tab` | Linear next/previous bookmark when a row is selected; at the first/last bookmark, Tab exits to the header/FAB |
| `G` then `1`–`9` | Jump to nth visible category or smart collection, select first bookmark |
| `GG` | Jump to very first bookmark |
| `Ctrl + Home` / `Ctrl + End` | First / last bookmark on the page (`Cmd` on Mac) |
| `Enter` / `Space` | Open selected |
| `Esc` | Clear selection and move focus to the first bookmark; may undo last drag reorder |

### 9.3 Bookmark actions

| Keys | Action |
|------|--------|
| `;` | Inline-edit selected row (page switches confirm before discarding unsaved edits) |
| `Shift + M` | Move to… (category or another page) |
| `Shift + D` | Quick-delete selected row (popover; undo in toast) |
| `Ctrl + C` | Copy URL (row flashes green) |
| `[` | Toggle hover preview card on selection |
| `Delete` | Delete selected bookmark (confirmation dialog; `Shift+D` uses the quick-delete popover instead) |

### 9.4 Cheat sheet

Press **`!`** or **`F1`**. Focus lands in the filter box automatically. Type to narrow the list. The cheat sheet does not open while the **page overview** (`,`), **tag cloud**, or another blocking overlay is open.

Rebind shortcuts in **config → keyboard** (open from Help or the keyboard link).

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
- On desktop, the highlighted match receives keyboard focus (not only a visual highlight). Closing search restores focus to the control that opened it.  
- Empty state: recent queries and saved searches as chips; **`←`/`→`** select a chip, **`Enter`** applies it; filter hints and finders below.  
- **Filters** (type or pick from autocomplete):

| Filter | Example |
|--------|---------|
| `category:` | `category:dev` |
| `tag:` | `tag:work` |
| `page:` | `page:2`, `page:all`, `page:current` |
| `status:` | `status:online`, `status:broken`, `status:pinned`, … |

### 10.2 Tag word cloud (`/`, desktop)

When **Tag cloud (/)** is enabled (config → general → Header & Buttons, on by default on desktop):

- Press **`/`** on the dashboard (search closed) or click the **/** FAB to open a word cloud of all tags (size = usage).
- **Click** or **`Enter`** / **`Space`** on a tag **toggles** it in the filter; the modal **stays open** so you can combine several tags.
- **OR logic** — the dashboard shows bookmarks that have **any** of the selected tags (not all).
- **Bulk toolbar** — when matches exist, a bar under the filter chips offers **Open all** / **Open first N**, **Copy links**, **Move**, and **Delete** for every filtered bookmark on the page.
- Selected tags are highlighted in the cloud; active filters appear as **chips** under the page title (each chip has its own **×** to remove one tag) and on the **/** FAB (`#work` or `#work +1` when more than one).
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

| Command | Description |
|---------|-------------|
| `:new` | New-bookmark modal |
| `:note` | Edit note on selected bookmark |
| `:pin` / `:unpin` | Toggle pin |
| `:tag` | List tags; browse by tag in palette (`:tag work`, `:tag:work`) without changing dashboard |
| `:tag +name` / `:tag -name` | Add/remove tag on keyboard-selected bookmark |
| `:remove` | Delete selected |
| `:sort order\|az\|recent\|custom` | Sort mode |
| `:open all` | Open all on page (safe batch cap) |
| `:open last [n]` | Open N recently opened on page (default 5, max 50) |
| `:stale [days]` | List stale bookmarks |
| `:health [filter]` | Open health page — `broken`, `duplicate`, `stale`, `refresh`, … |
| `:duplicate` / `:duplicates` | Scan for duplicate URLs across all pages (opens Health duplicates view) |
| `:find <text>` | Hide non-matching tiles on page |
| `:goto <url>` | Navigate to URL or domain |
| `:layout …` | default, compact, cards, masonry, list, launcher, … (presets — not layout version) |
| `:layoutversion` | List classic / modern / glass |
| `:layoutversion modern` / `classic` / `glass` / `toggle` | Switch layout version (`toggle` cycles classic → modern → glass) |
| `:theme <name>` | Switch theme |
| `:density comfortable\|compact\|dense` | Row density |
| `:columns <1-6>` | Column count |
| `:buttonbar bottom\|bottom-left\|bottom-right` | Button bar position |
| `:save` / `:saved` | Save / list saved searches |
| `:history` / `:history clear` | Search history |

### 10.6 Finders (`?`)

Format: `?shortcut query` — e.g. `?g nextdash` if `g` is configured to `https://www.google.com/search?q=%s`.

Configure finders in **config → finders** (desktop):

- **Filter** — narrow the list by name, shortcut, URL, or tags; **✕** or `Escape` clears.
- **Reorder** — drag the grip or press **↑** / **↓** on a focused row; order auto-saves after ~600 ms with a localized sync toast.
- **Usage stats** — each row shows use count and last-used date (refreshed when you open the tab).
- **Stable ids** — remove/reorder cannot target the wrong row; duplicate shortcuts are highlighted and block save until resolved.
- Use `%s` in the search URL where the query is inserted (e.g. `https://www.google.com/search?q=%s`).

### 10.7 In-page filter (`:find`)

Temporarily hides bookmark tiles that do not match. Run `:find` alone to clear.

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
- **Archive** hides a page from the dashboard and page picker without deleting its bookmarks (restore from the Structure workspace or the archived list).

### Move between pages

- **Shift+M** on dashboard, or detail panel in config, or bulk move in config.

### Page customisation

Double-click a page tab **on desktop or tablet landscape** (not on mobile — avoids accidental renames on touch):

- Set **emoji** icon  
- Choose **colour dot** (8 accents)

Use **config → pages** to rename a page on any device.

### Sorting

- Pinned bookmarks stay on top; pinned sort is alphabetical.  
- Non-pinned: manual, A–Z, recent, etc. (config and `:sort`).  
- **`:sort custom`** respects manual drag order.

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
  - **Tag cloud:** size reflects usage; click a chip to scroll to that tag in the list.  
  - **List:** each row shows bookmark count; click the label or count to expand a drill-down with page name, category, **Open** (jumps to the bookmark in Config → Bookmarks), and **− tag** (remove from one bookmark).  
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

**config → collections**: name, icon, AND/OR rules on tag, category, or shortcut. Appear as dashboard groups above regular categories.

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

**Post-onboarding prompts** — On desktop, an unread **What's new** release may open automatically after onboarding or on dashboard load. **One-time discoverability promos** (desktop only) show **Got it** balloons beside features the first time you use them — search modes (`>`, `:`, `?`, filters), grid arrow navigation, smart collections, inline edit, tag cloud, tag-filter bulk toolbar, recent bookmarks (`*`), preview (`[`), quick-add (`&`), week overview, category collapse, quick move (`Shift+M`), quick delete (`Shift+D`), and page overview (`,`). Dismiss with **Got it** or `Esc`; they do not repeat after confirmation. **Layout-versions** (classic layout), **paste URL**, and **preview cards** spotlights are separate one-time hints that may follow in the same session — there is no queue bar or **Later this session** coordinator. Reset layout/paste/preview from **config → general → Advanced → System & tools → Tours & onboarding**. Resetting the layout prompt from config when no dashboard tab is open queues a replay for the next dashboard visit.

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
- **Auto dark mode** follows system (built-in pairs only; disabled with custom theme).

The first time you open the **Theme** tab on a desktop-width window, a **9-step guided tour** creates a temporary **Tour demo** palette, saves it, activates it on General, then removes it (see [Guided config tours](#guided-config-tours)).

### Config → pages & categories (structure tabs)

- **Pages** — add, rename, **archive** (hide without deleting bookmarks), remove, drag or **↑/↓** reorder; order auto-saves (~600 ms). Page dropdowns skip archived pages. Desktop only (mobile shows a toast).  
- **Categories** — per-page list with icon, name, **merge**, remove, bookmark count per row; drag or **↑/↓** reorder with auto-save; switching the page selector flushes pending edits first. Delete asks what to do with in-use bookmarks (move, uncategorize, or delete). Desktop only for full editing.

### Typography and density

- Font preset, size, weight.  
- **`:density`**, **`:columns`**, **`:fontsize`** from commands.

### Header and background

- Optional title, background dots, gradient/image.  
- Button bar: centre bottom or corner dock (`:buttonbar`).

### What’s new

**★** button (opposite the button bar) opens release notes.

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
| **Multi-select** | Checkboxes per row; **All visible**, **Clear**, bulk favicon refresh, bulk delete |
| **Open in Config** | Click the row main area or press `Enter` to open **Config → Bookmarks** for that bookmark |
| **Favicon** | Shows stored bookmark icon; refresh per row or in bulk |
| **Action toolbar** | Config-style buttons per row: open URL, dashboard deep link, re-check status, favicon, overflow (auto-heal, delete) |
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

The dashboard **health** link badge counts broken links and warnings (including shortcut conflicts). When broken issues exist, the link opens `/health?filter=broken`. On **config**, the header **→ health beta** link and **General → Essentials → Health →** use the same routing (Essentials link appears when status monitoring is on).

### Stats (`config#stats`)

Read-only analytics (desktop). Sidebar index jumps to sections; on phone, horizontal **chip-nav** replaces the sidebar.

- **Insights** — automated highlights (busiest page, top bookmark, never-opened share, status coverage, recent activity) with links to sections.
- **Overview & activity** — bookmark totals, period filters (7 / 30 / 90 days / all time), and sparklines. Open counts describe **lifetime** `openCount` for bookmarks active in the selected period (labels update when a period is active).
- **Top bookmarks, pages, categories, shortcuts** — sortable tables; click a bookmark row (or press `Enter`) to open it in **Config → Bookmarks**.
- **Finders** — finder totals and top-20 table by `useCount`.
- **Tags** — coverage, most-used tag, untagged count, per-tag tables.
- **Rot & cleanup** — stale bookmarks, cleanup score (resets when the library is empty).
- **Conflicts** — duplicate URL detail list and shortcut conflicts with a link to **Health**.
- **Toolbar** — **Refresh** reloads stats in-tab; **Export CSV** downloads multiple sections (respects active period filters); **Filter tables** narrows rows across all stats tables with a visible/total hint.
- **Overview** — includes **Last backup** (formatted date from the backups tab when a ZIP was created in this browser).

---

## 16. Config — complete walkthrough

Open `/config`. Tabs `1`–`8` jump between sections. **S** saves (sticky bar).

| Tab | Purpose |
|-----|---------|
| **general** | Language, appearance, layout, bookmarks (display + behaviour merged), smart collections, status, branding, search — split **Essentials** / **Advanced** |
| **theme** | Built-in theme picker |
| **collections** | Custom collection rules |
| **pages** | Add, rename, archive, reorder pages (auto-save; ↑/↓ keyboard; desktop) |
| **categories** | Per-page categories — merge, counts, auto-save reorder (desktop) |
| **bookmarks** | Split-view editor, bulk actions |
| **finders** | External search shortcuts |
| **backups** | ZIP backup/restore, CSV, browser HTML import |
| **help** | In-app documentation index |
| **stats** | Usage insights (desktop) |
| **keyboard** | Rebind shortcuts (link from help) |
| **colors** | Theme editor (`#colors`) — dark/light, custom & packaged palettes, export/import, undo |
| **tags** | Tag management |

### Essentials vs Advanced (general)

- **Essentials** — Language, appearance (including favicon styling and a link to **Config → Theme**), layout, everyday bookmark options, smart collections (master toggle + enabled count), and a compact **status monitoring overview** (monitored count + toggle; **Health →** when status is on — opens `/health?filter=broken` when broken issues exist, otherwise `/health`). Language changes apply immediately; other changes need **Save**.  
- **Advanced** — Full status tuning, branding, search input, system tools (tours, onboarding replay, spotlight resets), feature tour, what’s new. Sticky **section links** at the top jump to panels; the active section highlights while you scroll.  
- **Show all sections** — flat view with every panel on one page; **Expand all** / **Collapse all** bulk controls; same section nav as Advanced.  
- **↺ Reset** — small reset buttons beside many controls restore that field to its saved default (marks the form dirty until you **Save**).  
- **Hash links** — `config#general`, `#general/advanced/layout`, etc. open the right layer and panel; collapsed panels open when linked from search or nav.  
- **ℹ** next to labels — Short explanations in EN/NL/DE/FR.

### Find settings & quick actions (desktop config)

- **Search settings…** — in the breadcrumb row; **`Ctrl+Shift+K`** / **`Cmd+Shift+K`**. Finds tabs, General panels (including Advanced while Essentials is active), individual labels, stats sections, colors groups, keyboard bindings, and Help blocks. Select a result to switch tab/layer, expand collapsed panels, and scroll there.  
- **Settings search promo** — on the first desktop config visit (until dismissed), a pulsing search field, **New** badge, and speech balloon explain settings search vs quick actions. Dismiss with **Got it**, focus, or typing. Replay from **Tours & onboarding → Reset settings search promo**. Skips mobile and active guided tours.  
- **Quick actions** — **`Ctrl+K`** / **`Cmd+K`**. Runs actions only (save, open dashboard, tour resets). Settings navigation is separate — use search settings, not the command palette.

#### Layout and structure

- **Bookmarks** — Display and Behaviour are a **single merged section** with a visual divider between the two groups. Essentials still shows a lightweight subset (icons, new-tab, sort, quick-add, page tabs).  
- **Tours & onboarding** — collapsible block inside **Advanced → System & tools**: onboarding wizard replay, feature tour link, **What's new**, **Reset layout versions prompt**, **Reset paste spotlight**, **Reset preview cards spotlight**, **Reset settings search promo**, and per-tab **Show … tour again** buttons (General, Bookmarks, Finders, Stats, Categories, Tags, Pages, Collections, Theme).

### Guided config tours

**One-time spotlight tours** explain config without reading every panel first. Each tour highlights one UI region at a time with a small card (Back, Next, Skip tour, step counter). The card stays near the bottom on large highlights so it does not cover the spotlight. Page scroll is locked per step so the highlight stays stable. Tours need a **desktop-width** window (the mobile config layout does not run them).

| Tour | When it starts | What it covers |
|------|----------------|----------------|
| **General** (11 steps) | First visit to **config → general** | Overview-only welcome, Essentials vs Advanced layers, appearance, layout, bookmarks, dashboard toolbar, smart collections summary, Advanced section nav, other config tabs, **Search settings…** (`Ctrl+Shift+K`), **Save** |
| **Bookmarks** (extended) | First visit to **config → bookmarks** | Split layout, collapsed structure panel, **+ Bookmark** menu, filters, optional demo bookmarks (editor, detail panel, dashboard **+**), search, bulk toolbar, favicon policy, cleanup of demos, **Save** |
| **Pages** (8 steps) | First visit to **config → pages** | Page list, add page, optional demo page, naming, dashboard handoff, remove page, demo cleanup |
| **Categories** (8 steps) | First visit to **config → categories** | Per-page categories, add category, optional demo **news** category, name/icon, dashboard reorder, remove, cleanup |
| **Tags** (8 steps) | First visit to **config → tags** | Tag cloud, list actions, optional demo bookmark with tag (via Bookmarks tab), tags field, see result on Tags tab, cleanup |
| **Collections** (11 steps) | First visit to **config → collections** | List, new collection, optional demo rules (tag/category/shortcut, AND/OR), save to dashboard, preview on dashboard, cleanup |
| **Finders** (8 steps) | First visit to **config → finders** | Concept, fields, **+ Add finder**, optional **Google** example (`?g`), dashboard usage, reorder/remove, **Save** |
| **Stats** (12 steps) | First visit to **config → stats** | Index, overview, cleanup score, activity, top bookmarks, pages/categories, shortcuts, **tags**, rot & cleanup, conflicts (Health link), search/status settings |
| **Theme** (9 steps) | First visit to **config → theme** (`#colors`) | Editor, dark/light/custom subtabs, add custom theme, auto **Tour demo** palette, live preview, **Save colors**, **General → Appearance** to activate, confirm removal and restore previous theme |

**Completion** — Each tour runs automatically only until you finish or skip it. Completion is stored in your settings (`configGeneralTourCompleted`, `configBookmarksTourCompleted`, `configPagesTourCompleted`, `configCategoriesTourCompleted`, `configTagsTourCompleted`, `configCollectionsTourCompleted`, `configFindersTourCompleted`, `configStatsTourCompleted`, `configThemeTourCompleted`) and in browser `localStorage`.

**Replay** — Open **config → general → Advanced** → **System & tools** and expand the **Tours & onboarding** block. Each tab has a **Show … tour again** button (General, Bookmarks, Finders, Stats, Categories, Tags, Pages, Collections, Theme). Open the matching tab first if the tour does not start. If a tour leaves the page scroll-locked without a visible card, refresh once — stale tour state is cleared automatically on load.

**Mobile** — Tours do not auto-start on the mobile config layout. Rotating footer tips, the settings search promo, and promo banners are also hidden on mobile.

**Not the same as** — **First-run onboarding** (language, layout, status, finish step for pages/bookmarks) or the dashboard **feature tour** (search, finders, commands — start from **config → general → Advanced → System & tools → Start tour**, or `/?tour=1`). After onboarding, **What's new** may open first; classic-layout users may then see a **layout-versions** tip, a **paste URL** spotlight, and a **preview cards** spotlight in the same session — separate from config tab tours.

### Config keyboard

| Keys | Action |
|------|--------|
| `1`–`9` | Jump to the Nth visible tab |
| `←` / `→` | Move between visible tabs (when focus is not in an input) |
| `S` | Save |
| `Alt+↑` / `Alt+↓` | Reorder bookmark in list |
| `Ctrl/Cmd+K` | Quick actions palette (save, open dashboard, tour resets) |
| `Ctrl/Cmd+Shift+K` | Find settings (tabs, panels, labels, help sections) |

---

## 17. Import, export, and backup

### ZIP backup (full instance)

**config → backups → Create backup**

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
- Pick page/category, optional tags and note.  
- Duplicate URL warning; **Save anyway** optional.  
- After save: **Open in nextDash** deep link to the page.

If a dashboard tab is open on the same server, it may toast and refresh.

See `extension/README.md` for development notes.

---

## 19. Mobile, PWA, and touch

### Mobile config

On small screens, config limits to **General** and **Help**; use desktop for full bookmark editing and for **guided config tours** (General and Bookmarks).

Within **General** on phone you get **language**, **theme**, and **layout basics**, plus a compact **Search settings…** for those panels — not the full Essentials/Advanced layers or guided General tour.

### Phone vs desktop

nextDash switches to the mobile layout on narrow viewports (≤768px), portrait tablets, or coarse touch pointers. A dismissible banner on dashboard and config summarizes the limits.

| Feature | Phone / touch | Desktop |
|---------|---------------|---------|
| **Dashboard footer** | **Search** + **+ Bookmark** only | Search, Commands, Finders, Recent, Help, tag cloud `/`, rotating tips |
| **Date/time** | Compact date badge in header (tap to open popover) | Full date/weather line in footer |
| **Commands (`:`) & finders (`?`)** | Open Search → overlay tabs `>` / `:` / `?` | Footer buttons or keys |
| **Recent bookmarks (`*`)** | `:open recent …` in command mode (or `*` with a keyboard) | Recent footer button or `*` |
| **Cheat sheet (`!`)** | — | Footer Help or `!` / `F1` |
| **Tag word cloud (`/`)** | Use `:tag` or `tag:` in the search overlay | `/` FAB + word cloud (when enabled) |
| **Page tabs in header** | Scrollable tab strip with scroll-snap; active tab auto-scrolls into view; `← →` swipe hint on multi-page dashboards | Tab strip + keys `1`–`9` |
| **Health badge** | Hidden — fix links in config on desktop | Header link |
| **Config tabs** | **General** (language, theme, layout) + **Help** | Bookmarks, pages, backup, stats, health, theme editor, tours, all settings |
| **Link preview on hover** | Off | When enabled in settings |
| **Guided tours & footer tips** | Skipped / hidden | Optional on first visit |

### Touch gestures

| Gesture | Action |
|---------|--------|
| Long-press row | Inline edit |
| Swipe (if enabled) | Change page |
| Tap **Search** | Open search overlay (with mode tabs on phone) |
| Tap **+ Bookmark** | Full add-bookmark modal |

Keyboard hints in empty states are hidden on touch.

### Install as app

**Add to Home Screen** uses `/manifest.webmanifest` — custom title/favicon from **branding** settings apply to the installed name/icon.

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

### Localhost bookmarks

**Config → General → Advanced → Allow localhost & private-network bookmarks** is **on by default** for dev workflows. Turn it **off** if nextDash is reachable on a shared network (reduces SSRF via status/preview fetches).

Server-side **pings**, **link previews**, **icon downloads**, and **auto-heal** only follow HTTP redirects to hosts that pass the same rules as the original URL (public hosts when localhost bookmarks are off). Outbound connections also validate **resolved IP addresses at dial time** (DNS-rebinding protection).

Duplicate URL detection (`:duplicate` in search, Health view, and `GET /api/duplicates`) treats URLs as the same when they differ only by trailing slash, hash, or host letter-case (`https://Example.com` ≡ `https://example.com/`).

---

## 22. Troubleshooting and FAQ

### Dashboard empty after install

Normal. Add bookmarks via **&**, **+**, import, or config. Run onboarding if offered — the finish step covers pages and first bookmarks.

### Dashboard failed to load

If bootstrap data cannot be fetched, you get an error toast with **Reload** and the loading skeleton clears. Check that the server is running and `/api/pages`, `/api/settings`, and `/api/bookmarks` respond. Corrupt device settings in `localStorage` fall back to server settings automatically.

### Config sync from another tab

When you save in config while the dashboard stays open, changes apply live. If sync fails, use **Retry** on the error toast instead of a full page reload — unsaved inline edits are less likely to be lost.

### Shortcut does not open bookmark

- Another bookmark or finder may use the same key.  
- Focus must not be in an input.  
- Check **Use shortcuts from all pages** in general settings if you expect global keys.

### Import shows “0 new”

All URLs already exist on the chosen page, or the HTML had no http(s) links. Try another page or remove duplicates first.

### Health deep link does not scroll

Bookmark index may have changed after reorder/delete. Link still opens the right page; use search or `?url=` fallback if added manually.

### Settings not applying

Click **Save** in config (sticky bar). Some fields autosave — watch for “unsaved” indicator.

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

Verify server URL, CORS/network, and that nextDash is running. Check browser console and server logs.

---

## 23. Quick reference

### Most-used keys (dashboard)

```
> search    : commands    ? finders    & quick-add    + new modal
1-9 pages   , overview    * recent     ! cheat sheet
arrows nav  Enter open    ; edit       Shift+M move  Shift+D delete
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
- **Config → Help** — Same topics, translated, with quick anchor links  
- **In-app What's new (★)** — Latest release highlights; older releases load as you scroll (skeleton while fetching)  

---

*This manual describes nextDash as shipped in this repository. Minor details may vary by version; when in doubt, trust the in-app Help and What's new modal.*
