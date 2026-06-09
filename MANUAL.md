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
    → Optional: What's new + layout tip (chained), config guided tours, feature tour, browser extension
```

1. **Onboarding** — Language, links, weather/date, classic or modern layout, search mode, smart collections, optional status monitoring, and a combined keyboard & mouse bookmark step. The finish step covers pages and first bookmarks when you start empty. You can skip and change everything later in **Config → General**.
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
│  [ : ] [ ? ] [ > ] [ * ] [ ! ] [ ⊞ ]   ← button bar         │
└─────────────────────────────────────────────────────────────┘
```

### Header

- **Date/time** — Click for week overview; optional weather line below.  
- **health** — Link to `/health` with badge (e.g. `3 broken`) when issues exist.  
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
| `⊞` | — | Toggle launcher layout (if enabled) |
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

With the dashboard focused and no text field active, paste a URL. The new-bookmark modal opens with the URL pre-filled. If paste cannot open the form (no active page, or the feature is disabled in config), a notification explains what to do.

### 7.4 Inline edit after long-press

Long-press a bookmark row (~500 ms, not on the drag strip) to edit in place on the dashboard. The form shows field-level validation errors while you type. Press **ESC** or click outside to dismiss without saving; the form warns if you have unsaved changes.

### 7.5 Config → bookmarks (bulk and detail)

**config → bookmarks**: list on the left, detail on the right. Best for many edits, tags, notes, favicon upload, and bulk actions.

At the top, the **structure workspace** manages pages and categories; below that you pick the active page, filter by category, and sort the list. **Quick add (⚡)** inserts a URL with minimal fields; **+ Add** creates a blank row and opens the full detail panel. Select multiple rows for the **bulk toolbar** (move, pin, status, favicon refresh, delete). Bookmark changes apply to the dashboard only after **Save** in the config header.

All bookmark lists in config (per-page editor, tags tab, stats) read from one **central bookmark store**, so tags and edits stay in sync across tabs and after guided tours.

The first time you open this tab on a desktop-width window, a **10-step guided tour** walks through these areas (see [Guided config tours](#guided-config-tours)).

### 7.6 Browser extension

Save the current tab to a chosen page (see [Browser extension](#18-browser-extension)).

### 7.7 Import

HTML export from Chrome/Firefox/Edge (see [Import, export, and backup](#17-import-export-and-backup)).

### Duplicate URLs

nextDash warns when a URL already exists on the same page. You can still save anyway in the extension or modal when needed. Imports **skip** duplicates and show a preview: e.g. **12 new, 3 conflicts (skipped)**.

---

## 8. Opening and using bookmarks

### Mouse

- Click the bookmark name (or icon area) to open the URL.  
- Respect **open in new tab** setting from config.  
- **Launcher layout**: large tiles; click plays a short pulse animation.

### Keyboard

- Select a row with arrows or Tab, then **Enter** or **Space**.  
- If the bookmark has a **shortcut** letter and you are not in an input, press that key to open.

### Hyprland / special setups

If **Hypr mode** is enabled in settings, bookmark clicks may be routed to your window manager instead of the browser default.

### Usage tracking

Each open increments **open count** and updates **last opened**. This powers smart collections (“Recently opened”, “Most used”, “Stale”) and stats.

### Recent panel (`*`)

Shows bookmarks you opened recently **on the current page** (not global). From the panel you can open one or use bulk actions aligned with **`:open last`**.

---

## 9. Keyboard navigation

### 9.1 Page navigation

| Keys | Action |
|------|--------|
| `1`–`9` | Jump to page tab by position |
| `Shift + ←` / `Shift + →` | Previous / next page |
| `,` | Page overview modal (popover stays inside the viewport on narrow screens) |

### 9.2 Bookmark grid

| Keys | Action |
|------|--------|
| `↑` `↓` `←` `→` | Move selection |
| `Tab` / `Shift+Tab` | Linear next/previous bookmark |
| `G` then `1`–`9` | Jump to nth category, select first bookmark |
| `GG` | Jump to very first bookmark |
| `Enter` / `Space` | Open selected |
| `Esc` | Clear selection; may undo last drag reorder |

### 9.3 Bookmark actions

| Keys | Action |
|------|--------|
| `;` | Inline-edit selected row |
| `Shift + M` | Move to… (category or another page) |
| `Ctrl + C` | Copy URL (row flashes green) |
| `[` | Toggle hover preview card on selection |
| `Delete` | Delete selected bookmark |

### 9.4 Cheat sheet

Press **`!`** or **`F1`**. Type in the filter box to narrow the list.

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
- Empty state: recent queries, saved searches, filter hints, finders.  
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
- **Arrow keys** move between tags and **Clear tag filter**; **Enter** applies a dashboard filter (only matching tiles stay visible).
- **Escape** or **Clear tag filter** removes the filter and returns focus to bookmarks.
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
| `:find <text>` | Hide non-matching tiles on page |
| `:goto <url>` | Navigate to URL or domain |
| `:layout …` | default, compact, cards, masonry, list, launcher, … (presets — not Classic/Modern) |
| `:layoutversion` | List classic / modern |
| `:layoutversion modern` / `classic` / `toggle` | Switch layout version |
| `:theme <name>` | Switch theme |
| `:density comfortable\|compact\|dense` | Row density |
| `:columns <1-6>` | Column count |
| `:buttonbar bottom\|bottom-left\|bottom-right` | Button bar position |
| `:save` / `:saved` | Save / list saved searches |
| `:history` / `:history clear` | Search history |

### 10.6 Finders (`?`)

Format: `?shortcut query` — e.g. `?g nextdash` if `g` is configured to `https://www.google.com/search?q=%s`.

Configure finders in **config → finders**.

### 10.7 In-page filter (`:find`)

Temporarily hides bookmark tiles that do not match. Run `:find` alone to clear.

---

## 11. Organising pages and categories

### Reorder bookmarks

- Drag the **left strip** of a row to reorder within a category or drop on another category.  
- **Esc** may undo the last reorder.

### Reorder categories

- Drag the **grip** on the category title on the dashboard, or drag rows in **config → categories**.

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

Click category header or chevron. **Always collapse categories** can be set in general settings.

---

## 12. Tags, notes, and metadata

### Tags

- Comma-separated in modal, inline edit, or config detail.  
- Stored lowercase, trimmed, deduplicated.  
- **Search (`>`):** `tag:work` filters results in the search overlay (partial match); dashboard layout unchanged.  
- **Dashboard tag cloud (desktop):** `/` or / FAB — filters **dashboard tiles**; keyboard navigation; Clear returns focus to bookmarks.  
- **Command palette (`:`):** `:tag work` lists bookmarks in the palette only; `:tag +work` / `:tag -work` mutate tags on the selected bookmark.  
- **config → tags**: rename, merge, delete, tag cloud overview.  
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

### Custom collections

**config → collections**: name, icon, AND/OR rules on tag, category, or shortcut. Appear as dashboard groups above regular categories.

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

**Themes control all colors** in both versions; switching layout version does not change your theme.

**Where to switch**

- **Config → General → Layout → Layout version** — dropdown with a live description under the control.  
- **First-run onboarding** — dedicated layout step with a live preview.  
- **Dashboard command mode** — `:layoutversion` lists options; `:layoutversion modern` / `:layoutversion classic` applies one; `:layoutversion toggle` flips between them.  
  (This is **not** the same as `:layout`, which switches **presets** like launcher or compact — see below.)

**Discoverability** — If you keep classic during onboarding, a one-time **Try the modern layout** spotlight may appear after **What's new**. You can try modern, keep classic, or change later in config. Reset the spotlight from **config → general → Advanced → System & tools**.

### Layout presets

| Preset | Character |
|--------|-----------|
| **Default** | Classic multi-column grid |
| **Compact / Cards / Masonry / List** | Density and visual style |
| **Launcher** | Large favicon tiles; toggle **⊞** or `:layout launcher` |

### Themes

- 37+ built-in families (dark/light pairs).  
- **config → theme** tab (`#colors`) — built-in dark/light subtabs, custom theme list, live preview, **Save colors**.  
- **General → Appearance → Theme** — pick the active theme for the whole app (built-in or saved custom).  
- **Auto dark mode** follows system (built-in pairs only; disabled with custom theme).

The first time you open the **Theme** tab on a desktop-width window, a **9-step guided tour** creates a temporary **Tour demo** palette, saves it, activates it on General, then removes it (see [Guided config tours](#guided-config-tours)).

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

Central place to triage issues:

```
Summary cards → Filter pills + page filter → Issue list → Action toolbar
                                    ↓
              Duplicate groups → merge (keep best)
```

| Feature | Use |
|---------|-----|
| **Score 0–100** | Combines broken, duplicate, shortcut conflict, stale, missing preview, unused |
| **Filters** | broken, duplicate, shortcut-conflict, stale, unchecked, unused, missing preview, healthy |
| **Page filter** | Limit the issue list to one dashboard page |
| **Search** | Name, URL, category, page |
| **Action toolbar** | Two compact rows per issue (config-style buttons): standard actions (dashboard, open, ping, favicon, delete) and auto-heal (archive, detect redirect, refresh title, 1-click fix) |
| **dashboard link** | Jump to bookmark on correct page/category |
| **ping** | Re-test a URL; failures show specific errors (e.g. HTTP 404, Timeout, DNS) |
| **Bulk** | Retest all checked, open broken (with confirm/limit), merge duplicate groups |
| **Duplicate merge** | Keeps the “best” bookmark: most opens → pinned → oldest; removes the rest |

Filter, sort, search, and page-filter state persist in the session across refreshes.

The dashboard **health** link badge counts broken links and warnings (including shortcut conflicts).

### Stats (`config#stats`)

Read-only analytics: activity, top bookmarks, cleanup score, **tags** (coverage, most-used tag, untagged count, per-tag tables), rot tables, duplicate/conflict links to health.

---

## 16. Config — complete walkthrough

Open `/config`. Tabs `1`–`8` jump between sections. **S** saves (sticky bar).

| Tab | Purpose |
|-----|---------|
| **general** | Language, appearance, layout, bookmarks (display + behaviour merged), smart collections, status, branding, search — split **Essentials** / **Advanced** |
| **theme** | Built-in theme picker |
| **collections** | Custom collection rules |
| **pages** | Add, rename, archive, reorder pages |
| **categories** | Per-page categories |
| **bookmarks** | Split-view editor, bulk actions |
| **finders** | External search shortcuts |
| **backups** | ZIP backup/restore, CSV, browser HTML import |
| **help** | In-app documentation index |
| **stats** | Usage insights (desktop) |
| **keyboard** | Rebind shortcuts (link from help) |
| **colors** | Custom theme editor (`#colors`) |
| **tags** | Tag management |

### Essentials vs Advanced (general)

- **Essentials** — Language, appearance (including favicon styling), layout, everyday bookmark options, smart collections, and a compact **status monitoring overview** (monitored count + toggle; **Health →** when enabled).  
- **Advanced** — Full status tuning, branding, search input, system tools (tours, onboarding replay, discoverability reset), feature tour, what’s new.  
- **Show all sections** button — toggles a flat view with every panel visible regardless of layer.  
- **ℹ** next to labels — Short explanations in EN/NL/DE/FR.

### Find settings & quick actions (desktop config)

- **Search settings…** — in the breadcrumb row; **`Ctrl+Shift+K`** / **`Cmd+Shift+K`**. Finds tabs, General panels (including Advanced while Essentials is active), individual labels, stats sections, colors groups, keyboard bindings, and Help blocks. Select a result to switch tab/layer and scroll there.  
- **Quick actions** — **`Ctrl+K`** / **`Cmd+K`**. Runs actions only (save, open dashboard, tour resets). Settings navigation is separate — use search settings, not the command palette.

#### Layout and structure

- **Bookmarks** — Display and Behaviour are a **single merged section** with a visual divider between the two groups. Essentials still shows a lightweight subset (icons, new-tab, sort, quick-add, page tabs).  
- **Tours & onboarding** — all 9 tab tour-reset buttons are grouped in a collapsible **Tours & onboarding** block inside Advanced → System & tools. Expand it to reset individual tab tours.

### Guided config tours

**One-time spotlight tours** explain config without reading every panel first. Each tour highlights one UI region at a time with a small card (Back, Next, Skip tour, step counter). The card stays near the bottom on large highlights so it does not cover the spotlight. Page scroll is locked per step so the highlight stays stable. Tours need a **desktop-width** window (the mobile config layout does not run them).

| Tour | When it starts | What it covers |
|------|----------------|----------------|
| **General** (9 steps) | First visit to **config → general** | Settings layout overview, Essentials vs Advanced, appearance, bookmarks section, dashboard toolbar buttons, smart collections summary, Advanced section nav, other config tabs, **Save** |
| **Bookmarks** (extended) | First visit to **config → bookmarks** | Split layout, structure, filters, optional demo bookmarks (editor, **+** modal, dashboard **+**), search, bulk toolbar, favicon policy, cleanup of demos, **Save** |
| **Pages** (8 steps) | First visit to **config → pages** | Page list, add page, optional demo page, naming, dashboard handoff, remove page, demo cleanup |
| **Categories** (8 steps) | First visit to **config → categories** | Per-page categories, add category, optional demo **news** category, name/icon, dashboard reorder, remove, cleanup |
| **Tags** (8 steps) | First visit to **config → tags** | Tag cloud, list actions, optional demo bookmark with tag (via Bookmarks tab), tags field, see result on Tags tab, cleanup |
| **Collections** (11 steps) | First visit to **config → collections** | List, new collection, optional demo rules (tag/category/shortcut, AND/OR), save to dashboard, preview on dashboard, cleanup |
| **Finders** (8 steps) | First visit to **config → finders** | Concept, fields, **+ Add finder**, optional **Google** example (`?g`), dashboard usage, reorder/remove, **Save** |
| **Stats** (12 steps) | First visit to **config → stats** | Index, overview, cleanup score, activity, top bookmarks, pages/categories, shortcuts, **tags**, rot & cleanup, conflicts (Health link), search/status settings |
| **Theme** (9 steps) | First visit to **config → theme** (`#colors`) | Editor, dark/light/custom subtabs, add custom theme, auto **Tour demo** palette, live preview, **Save colors**, **General → Appearance** to activate, confirm removal and restore previous theme |

**Completion** — Each tour runs automatically only until you finish or skip it. Completion is stored in your settings (`configGeneralTourCompleted`, `configBookmarksTourCompleted`, `configPagesTourCompleted`, `configCategoriesTourCompleted`, `configTagsTourCompleted`, `configCollectionsTourCompleted`, `configFindersTourCompleted`, `configStatsTourCompleted`, `configThemeTourCompleted`) and in browser `localStorage`.

**Replay** — Open **config → general → Advanced** → **System & tools** and expand the **Tours & onboarding** block. Each tab has a **Show … tour again** button (General, Bookmarks, Finders, Stats, Categories, Tags, Pages, Collections, Theme). Open the matching tab first if the tour does not start.

**Mobile** — Tours do not auto-start on the mobile config layout. Rotating footer tips and promo banners are also hidden on mobile.

**Not the same as** — **First-run onboarding** (language, layout, status, finish step for pages/bookmarks) or the dashboard **feature tour** (search, finders, commands — start from **config → general → Advanced → System & tools → Start tour**, or `/?tour=1`). After onboarding, **What’s new** and (classic layout) a **layout tip** may chain in one session — separate from config tab tours.

### Config keyboard

| Keys | Action |
|------|--------|
| `1`–`8` | Switch tabs |
| `S` | Save |
| `Alt+↑` / `Alt+↓` | Reorder bookmark in list |
| `Ctrl/Cmd+K` | Quick actions palette (save, open dashboard, tour resets) |
| `Ctrl/Cmd+Shift+K` | Find settings (tabs, panels, labels, help sections) |

---

## 17. Import, export, and backup

### ZIP backup (full instance)

**config → backups → Create backup**

Includes pages, bookmarks (with tags), categories, settings, custom themes (`colors.json`), uploaded dashboard favicon/font, and bookmark icon files under `data/icons/`.

**Import ZIP** replaces **all** current data. **Always backup first.**

Do not rename files inside the ZIP.

Bookmark URL validation during import uses **`allowLocalBookmarks` from the imported `settings.json`** when that file is in the ZIP (not the server’s current setting).

Bookmarks with **invalid URLs** (wrong scheme, or private/loopback hosts when localhost bookmarks are disabled) are **skipped** during import; the UI shows how many were skipped alongside new and conflict counts.

### Factory reset

**config → backups → Reset all data**

Permanently deletes pages, categories, bookmarks, finders, settings, custom themes, uploaded favicon/font, bookmark icons, and health/preview caches. Recreates the **default sample bookmarks** (favicons prefetched on the server), built-in settings, and default colour palette. Not a partial wipe — use ZIP backup first if you need to keep anything.

### Browser HTML import

1. Export bookmarks from Chrome, Firefox, or Edge as **HTML**.  
2. **config → backups → Import from Browser**.  
3. Review preview: **X new, Y conflicts (skipped)**.  
4. Choose target **page**.  
5. Confirm import.

- Folders in the HTML become **categories**.  
- Duplicate URLs (same page + within file) are skipped using the same rules as the server.

### CSV export

All bookmarks: Name, URL, Category, Page, Shortcut — for Excel/Sheets.

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

Within **General** on phone you only get **language**, **theme**, and **layout basics** — not the full Essentials/Advanced layers.

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

When set, destructive API calls require header `X-NextDash-Token: your-long-random-secret`. Opening **Config** or **Health** in the browser supplies this header automatically via a meta tag (same origin only).

| Protected action | Endpoint |
|------------------|----------|
| Reset all data | `POST /api/reset` (+ JSON `{"confirm":true}`) |
| Import ZIP backup | `POST /api/import` |
| Delete page | `DELETE /api/pages/{id}` |
| Health: delete bookmark | `POST /api/health/delete-bookmark` |
| Health: retest all | `POST /api/health/retest-all` |
| Health: merge duplicates | `POST /api/health/merge-duplicates` |
| Health: auto-heal apply | `POST /api/health/auto-heal-apply` |
| Health: cache scan result | `POST /api/health/cache-scan` |
| Health: update bookmark status | `POST /api/health/update-status` |
| Clear all preview metadata | `POST /api/previews/clear` |
| Refresh all preview metadata | `POST /api/previews/refresh` |
| Reset theme colours | `POST /api/colors/reset` |

Routine bookmark edits, config save, and dashboard use are **not** token-gated. The browser extension can store the same token under **Settings → Write token**.

### Localhost bookmarks

**Config → General → Advanced → Allow localhost & private-network bookmarks** is **on by default** for dev workflows. Turn it **off** if nextDash is reachable on a shared network (reduces SSRF via status/preview fetches).

Server-side **pings**, **link previews**, and **auto-heal** only follow HTTP redirects to hosts that pass the same rules as the original URL (public hosts when localhost bookmarks are off).

---

## 22. Troubleshooting and FAQ

### Dashboard empty after install

Normal. Add bookmarks via **&**, **+**, import, or config. Run onboarding if offered — the finish step covers pages and first bookmarks.

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

### Config guided tour does not start

- Use a **wider browser window** or turn off mobile device emulation.  
- Open the correct tab (**general**, **bookmarks**, **theme** / `#colors`, **finders**, **stats**, …) before replaying from **System & tools**.  
- If you already completed the tour, expand the **Tours & onboarding** block in **config → general → Advanced → System & tools** and use the matching **Show … tour again** button (e.g. **Show Theme tour again**).  
- Refresh the page if the editor is still loading, then try again.

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
arrows nav  Enter open    ; edit       Shift+M move
```

### Config (desktop)

```
Ctrl/Cmd+K          quick actions (save, open dashboard, tours)
Ctrl/Cmd+Shift+K    find any setting, tab, or help section
:layoutversion      switch Classic / Modern layout (dashboard)
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
- **In-app What's new (★)** — Latest release highlights  

---

*This manual describes nextDash as shipped in this repository. Minor details may vary by version; when in doubt, trust the in-app Help and What's new modal.*
