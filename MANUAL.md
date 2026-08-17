<p align="center">
  <img src="logo-ascii-on-black-large.png" alt="nextDash" width="640">
</p>

# nextDash — User Manual

**A complete, step-by-step guide to the keyboard-first bookmark dashboard.**

| | Resource | Where to look |
|---|----------|---------------|
| 🚀 | **Install & security** | [README.md](README.md) — Docker, tokens, production setup |
| 📋 | **Release history** | [CHANGELOG.md](CHANGELOG.md) — every version, new and fix |
| 🗂️ | **Shortcut cheat sheet** | Press **!** or **F1** on the dashboard (live, searchable). Printable: [PDF](nextDash-cheatsheet.pdf?raw=true) / [HTML](nextDash-cheatsheet.html?raw=true) — regenerate with `npm run generate:cheatsheet`. |
| 💬 | **Translated help** | **Config → Help** in the app (EN / NL / DE / FR) |

This manual is for new users and anyone who wants a structured reference. It goes deeper than the README and mirrors the in-app Help topics.

---

## 📚 Table of contents

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

## 1. ✨ What is nextDash?

nextDash is a **self-hosted bookmark dashboard** you open in your browser. There are:

- **No user accounts** — one installation, one dataset on disk.
- **No cloud sync** — your bookmarks live in files you control (typically a `data/` folder).
- **A keyboard-first design** — search, jump between pages, add bookmarks, and run commands without reaching for the mouse.

Think of it as a personal start page: bookmarks grouped by **page** (e.g. Work, Personal) and **category** (e.g. Dev, News), with powerful search and optional link-health tools.

### ✅ What you can do

| Area | Examples |
|------|----------|
| **Organise** | Multiple pages, categories, drag-and-drop reorder, pins, tags, notes |
| **Navigate** | Number keys for pages, arrow keys for bookmarks, search and command palette |
| **Add** | Quick-add line, full modal, paste URL, browser extension, HTML import |
| **Monitor** | Online/offline status, health scores, duplicate detection, stale bookmarks |
| **Customise** | 57+ themes, random theme picks, layouts (including launcher tiles), fonts, density, button bar position |
| **Preserve** | ZIP backup/restore, CSV export, browser bookmark import |

---

## 2. 🧰 Before you begin

### ✅ What you need

- A machine or container to run nextDash (Docker or a single Go binary).
- A modern browser (Chrome, Firefox, Edge, Safari).
- For the extension: a reachable nextDash URL (e.g. `http://localhost:8080` or your Tailscale hostname).

### 🚫 What nextDash is not

- Not a full browser bookmark sync replacement for every device (unless you self-host and expose it safely).
- Not multi-user SaaS — protect the URL if others can reach your network.

See [Security and self-hosting](#21-security-and-self-hosting) before exposing nextDash on the internet.

---

## 3. ⚙️ Installation and first launch

### 🐳 Option A — Docker Compose (recommended)

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

### 🧱 Option B — Build from source

```sh
go build -o nextDash && ./nextDash
```

Data is stored under `./data` by default.

### 🌿 Cloning from GitHub

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

### 🚦 First launch flow

```
Install → Open URL in browser → Quick-start card (optional)
    → Dashboard (may be empty) → Config to add pages/bookmarks
    → Optional: What's new; browser extension
```

1. **Quick-start card** — A compact three-step card in the corner: language & auto dark mode, column layout, and weather. Skip it whenever you like — nothing is locked in, and every setting it touches stays reachable in **Config → Behavior** afterwards. It then becomes a short checklist (add a bookmark, tag one, open config, see the keyboard cheat sheet) that dismisses itself once every item is done, or any time you close it (see [Quick-start card](#quick-start-card-doesnt-appear)).
2. **Empty dashboard** — Normal on first run. Use **+** (full add form) or **&** (quick-add) to add your first bookmark, or import from a browser HTML file (see [Import](#17-import-export-and-backup)).
3. **Config** — Click **config** in the header, press **`Shift+S`**, or open `/#config`. Config is a view inside the dashboard, not a separate page. Its **Help** section mirrors much of this manual in shorter form, plus a **Tips & tricks** section and a **What's new** recap.

---

## 4. 🧠 Core concepts

Understanding five ideas makes everything else click.

### 4.1 Pages

A **page** is a separate tab on the dashboard (e.g. `main`, `Work`, `Home lab`). Each page has its own:

- Bookmark list  
- Category list  
- Optional page emoji and **colour dot** on the tab (double-click the tab on desktop or tablet landscape to set name, emoji, and dot from eight swatches)

Switch pages with `0` (Inbox), `1`–`9`, `Shift + ←/→`, or the **pages** overview (`,`). Recently visited pages are kept in memory (and prefetched when you hover a tab), so switching back is usually instant without reloading every bookmark from the server.

### 4.2 Categories

**Categories** are sections within a page (e.g. `dev`, `news`, `tools`). In config they have an ID and display name. Bookmarks belong to one category (or uncategorised).

- Collapse/expand per category on the dashboard; press **`.`** to collapse or expand **all** categories at once.  
- Drag the **`//` prefix** in a category title to reorder sections.  
- Add a new category (or page) straight from the **bookmark form** — the **Page** and **Category** dropdowns each lead with a **➕ New…** option that creates and saves it inline. See [7.2 Full modal](#72-full-modal--shiftb-or-ctrlshifta).  
- Press and hold a category header (~500 ms, not on sort buttons) to rename — double-click still works. **Esc** cancels rename.
- In **config → pages & tags → categories**, edits auto-save when you switch to another config tab or change the page selector (blocked if validation fails). Category lists are protected from accidental empty saves when bookmarks still reference those categories.

#### Spreading a category across columns

*(v1.1.0)* A category can run across several grid columns. Its bookmarks then flow across those columns instead of down a single one, which suits a category with many short entries.

It is a switch, not a width. **How many** columns a spread category takes is not a setting: it follows from **items per category** — which caps the height of one column — and how many bookmarks the category holds. Forty bookmarks with a limit of fifteen take three columns, and two once you delete a handful. The column count is the ceiling: lower it and a spread category narrows to fit, raise it and it takes back only what it asks for.

Because the width follows the contents, it also follows them as they change: a bookmark that pushes a category past its limit brings the next column with it there and then, and one that takes it back under drops the column again. With the limit at fifteen:

| Bookmarks in the category | Columns |
|---|---|
| 1 – 15 | 1 |
| 16 – 30 | 2 |
| 31 – 45 | 3 |

A spread category says so twice: a rule under its header running the width of the whole block, and a small **↔ N** beside the title naming the number of columns it currently takes.

| Route | How |
|-------|-----|
| Mouse | Right-click the category header → **Spread across columns** |
| Keyboard | **Shift + W** on the focused category |
| Command | `:width on` / `:width off`, or `:width all` to switch every category back |
| Config | **pages & tags → categories** has a ↔ button per row |

**Config → appearance → layout → Categories across columns** holds what applies to all of them: **items per category**, whether a **new** category starts out spread, and whether **Turn spreading off everywhere** covers only the current page or every page.

Spreading needs two things: **items per category** must not be *Unlimited*, and the grid must have at least two columns. With no limit there is nothing capping the height of a column, so nothing decides how many columns a category would need — which is why *Unlimited* is out of reach while any category spreads, and why the controls say what to set when it is.

**With Pack columns tightly on** nothing changes while no category spreads — it is the same round-robin columns it has always been. Switch one on and the page becomes a packed grid: the spread category takes its columns where it falls, and the categories after it carry on beside and beneath it instead of waiting for a clear row.

On a phone every category is one column wide.

The first time it is worth knowing about, a card in the bottom-left corner offers a four-step walkthrough of all this — the before/after shape, where the switch is, the sum that decides the column count, and where the remaining settings live. Dismiss it and it does not come back.

That corner holds **one card at a time**, and the others wait their turn rather than being dropped: a card that finds the corner busy — another invitation still unanswered, the ★ release notes open — comes back as soon as it frees up, however long that takes. Until **v1.1.3** it gave up after forty seconds, so on an install carrying an unanswered card, everything behind it was never offered at all.

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
| **Availability check** | One choice of three: **Off** (never tested), **Periodic** (checked about once a day, flags a broken link), or **Monitor** (checked on its own interval with 30 days of history — uptime, heartbeat, outages). Monitor includes everything Periodic does. Set it in the editor, from the dashboard right-click menu, with `Shift + C`, or from a health-view row (`c`) |
| **Open count / last opened** | Usage tracking |

Pinned bookmarks stay at the top of their category (manual, A–Z, or recent sort). Notes remain searchable in fuzzy search and editable via `:note` or inline edit. Pin and note row icons were removed from the dashboard and from config; there are no pin/note badges on bookmark rows.

### 4.4 Inbox

**Inbox** is a separate capture list for links you want to read or sort later — not bookmark pages. Items live in `data/inbox.json` on the server.

- Open with the **Inbox** header tab, **`Shift+I`**, **`0`** (when search is closed), or **`:inbox`**.  
- Add links by pasting a URL on the dashboard (`Ctrl+V`) and choosing **Save to Inbox**, via the browser extension, or through the API.  
- Filter **All** / **Unread** / **Snoozed**, search, and browse date groups. **Snooze** parks a link for later (`z`) — four presets, plus a date field for anything further out than *next week*, waking at 09:00 local like the presets do; **Promote** turns a link into a full bookmark (and health-checks it when status checks are on); **Triage** walks unread items one by one.  
- **Sort** — next to the search field: **newest first** (default), **oldest first**, **title**, or **site**. *Oldest first* is how a backlog gets worked: the items you have been avoiding are at the bottom. Title and site sorts drop the date headings so the ordering runs unbroken from top to bottom.  
- **Linkable and remembered** — filter, sort and search appear in the address bar (`?ib_filter=`, `?ib_sort=`, `?ib_q=`), so a view can be bookmarked or shared. Filter and sort also return on your next visit; a shared link overrides what was stored. The search box is deliberately not remembered.  
- **Select several** — tick rows (click the box, or `x` on the selected row) and a bar offers **Mark read**, **Snooze** and **Delete** for just those items, instead of the toolbar's all-or-nothing bulk. `Esc` clears the selection, switching filter clears it too (so a bulk action cannot reach rows you can no longer see), and deleting names the count and asks first.  
- Keyboard: `j`/`k` move, `g`/`G` first/last, `Enter` open, `p` promote, `r` mark read, `n` note, `z` snooze, `x` select, `d` delete. Toolbar bulk actions: **Mark all read** and **Clear read**.  
- **First visit** — a one-time tour walks the whole loop in seven steps, from where links come from to how a backlog gets cleared. **Config → Help → Inbox** covers the same ground in more depth, at any time.
- Toggle under **Config → Behavior → Inbox → Enable Inbox**; set the paste destination there too, to skip the choice dialog.

### 4.5 Config vs dashboard

Config is a **view inside the dashboard**, not a separate page — same tab, same session, no page load. Open it with **`Shift+S`**, the **config** (gear) link in the header, or the `/#config` address; **`<`** takes you back. Reopening config with **`Shift+S`**, **`<`**, or the gear icon restores the **last section and sub-tab** you were on — whichever way you left, including **`Escape`**, **`0`–`9`**, and the health, inbox and page buttons in the header, which switch view around config without it being asked (**v1.1.0**). The memory lasts **5 minutes**, counted from the moment config left the screen rather than from your last click inside it: reading one panel for half an hour and stepping away for ten seconds still brings you back where you were, while coming back much later starts on **Overview** — a quick return is a continuation of what you were doing, a return an hour later is a new task. A deep link like `/#config/appearance` still takes priority.

| Dashboard view | Config view |
|-----------------|------------------|
| Daily use: open, search, quick-add | Structure: pages, categories, bulk edit |
| Keyboard-first | Bookmark editor, stats, backups |
| Live layout and themes | Every setting, grouped by topic |

It has nine sections — **Overview**, **Pages & tags**, **Bookmarks**, **Appearance**, **Behavior**, **Data & backups**, **Statistics**, **Help**, and **About** — each deep-linkable as `/#config/<section>` (for example `/#config/appearance`).

Most controls **save the moment you change them**, and a short *Saving…* / *Saved* confirmation appears. The bookmark editor is the exception: it collects your edits and writes them when you press **Save**. Config only writes data that actually changed — a small settings edit does not re-upload every page of bookmarks.

---

## 5. 🖥️ The dashboard at a glance

```
┌─────────────────────────────────────────────────────────────┐
│  Date/time · mini status    [page tabs] · ⊞ · inbox · health · config │
├─────────────────────────────────────────────────────────────┤
│  Title (optional)                                           │
├─────────────────────────────────────────────────────────────┤
│  [Smart collections]  [Tag collections]  [Categories…]      │
│    └─ bookmark rows (icon · name · shortcut)                │
├─────────────────────────────────────────────────────────────┤
│  [ + ] [ > ] [ : ] [ ? ] [ * ] [ ! ] [ . ]  ← button bar    │
└─────────────────────────────────────────────────────────────┘
```

Side rail layout (optional — **Config → Appearance → Layout → Button bar position → Rail left** or **Rail right**):

```
┌──┬─────────────────────────────────────────────────────────┐
│+ │  [header: date · page tabs · ⊞ · inbox · health · config]          │
│──│                                                         │
│> │  [Smart collections]  [Tag collections]  [Categories…]  │
│? │    └─ bookmark rows                                     │
│: │                                                         │
│* │                                                         │
│──│                                                         │
│/ │                                                         │
│! │                                                         │
│. │                                                         │
│★ │                                                         │
└──┴──────────── ────────────────────────────────────────────┘
```

### 🧭 Header

- **Date/time** — Click for a **week overview** popover (today highlighted; optional **Open calendar** link when configured in General). Optional weather line below.
- **Page tabs** — Switch bookmark pages (`1`–`9`, `Shift + ←/→`, or click). On desktop the strip scrolls when you have many pages.
- **pages** — Grid icon beside the page tabs; opens an overview of all pages with counts (`,` or click). Same stroke and spacing as inbox, health, and config (**v2026.08.08.6**).
- **Inbox** — When enabled, an inbox icon beside **pages** opens the triage view (`Shift + I` or `0`). Unread count on the tab when something is waiting.
- **health** — A **heartbeat icon** linking to `/#health`, with an inline pill counter (e.g. `3`) when there is something to report — **red** for a monitored bookmark that is down right now or an ordinary broken link, **amber** for warnings, hidden when healthy (styled like the inbox tab). The most severe state wins the badge: a **down monitor** takes priority over a broken link, which takes priority over warnings. A down monitor is counted apart from a broken link — clicking opens `/?hv_filter=monitored#health` for an outage, `/?hv_filter=broken#health` for a broken link. When the number of down monitors **rises**, the icon **pulses once** to catch your eye; it stays quiet on a reload that merely finds an existing outage, on a recovery, and — via a 10-minute cooldown — on a monitor that flaps up and down. The pulse shares the broken red and is told apart by the movement, and it honours reduced-motion and the no-animations setting. Always shown. Open the same view from the keyboard with **`Shift+H`**.
- **config** — Settings and bookmark management.

**pages**, inbox, health, and config are icon buttons to the right of the page tabs, all at the same spacing (**v2026.08.08.6**). On mobile the tab strip is hidden — **pages** and **config** stay in the header.

### 🎛️ Button bar / side rail

The button bar can appear as a **floating bottom bar** (default), a **corner dock**, or a **44 px vertical side rail on either edge** — set via **Config → Appearance → Layout → Button bar position** or the `:buttonbar` command.

**Bottom bar** — buttons float centred at the bottom of the viewport.

| Button | Key | Role |
|--------|-----|------|
| `+` | `+` | Full new-bookmark modal |
| `>` | `>` | Search |
| `:` | `:` | Command palette |
| `?` | `?` | Finders (external search shortcuts) |
| `*` | `*` | Recent bookmarks on this page |
| `!` | `!` / `F1` | Keyboard cheat sheet |
| `.` | `.` | Fold or unfold every category |

Each button can be shown or hidden individually under **Config → Appearance → Toolbar & tabs**. `*` recent, `!` cheat sheet and `.` fold-all share one group, and it disappears only when all three are switched off. **A fresh install starts without the fold-all button** — the key still works, and it is one switch away — while a dashboard that already had it keeps it: an existing `settings.json` with no such key reads as an upgrade, not as a new install.

**Side rail** — 44×44 px square cells stacked vertically against one edge; the dashboard grid shifts by 44 px to clear it. Available on the **left** (`side-left`) or the **right** (`side-right`); the two are mirror images, so the divider faces the content and tooltips open inward. On mobile (≤768 px) the rail automatically reverts to a centred bottom bar.

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
| | `.` | `.` | Fold or unfold every category |
| Bottom | `★` | — | What's new |

**Off by default.** The shortcut popovers are a switch under **config → behavior → general** — *Show shortcut hints on toolbar icons* — and they now start off, for existing dashboards as well as new ones: the setting has been on since it existed and is written into every stored settings file, so changing the default alone would have left everybody exactly where they were. A one-time migration turns them off; switching them back on sticks, because the migration records that it ran and never runs again. With them on, hover a button on desktop for a tooltip with shortcuts. In side-rail mode, tooltips appear to the **right** of the rail. The header icons — **pages**, **inbox**, **health**, **config** — carry the same tooltips (**v2026.08.08.6**) and open **below** the icon, since there is no room above them at the top of the window (**v2026.09.2**).

### 🔗 Deep links from Health

Health can open a bookmark on the dashboard with:

`/?page=<pageId>&bookmark=<index>&category=<categoryId>`

The dashboard switches page, expands the category, scrolls to the row, and highlights it briefly.

---

## 6. ⏱️ Your first 30 minutes

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

## 7. ➕ Adding bookmarks

### 7.1 Quick-add (`&`) — fastest for simple links

1. Focus the dashboard (click empty space; no input focused).  
2. Press **`&`**.  
3. Type one line: `name | url | shortcut` (shortcut optional).  
4. Press **Enter**.

Example: `GitHub | https://github.com | g`

Favicon is fetched automatically when possible.

### 7.2 Full modal (`+`, `Shift+B`, or `Ctrl+Shift+A`)

One shared **bookmark form modal** is used for add and edit everywhere — dashboard, Health, Inbox, Config, and search (`:new`).

- **`+`** on the dashboard (toolbar **+** button uses the same shortcut).  
- **`Shift+B`** from anywhere on the dashboard when not typing in a field.  
- **`Ctrl+Shift+A`** from anywhere (legacy global chord).  
- **`:new`** from command mode.

**Create + New** (footer button while adding) saves the bookmark, clears the form for the next entry, keeps your page and category, and updates the grid behind the modal.

Since **v2026.08.07.1**, success toasts show translated labels again (not raw locale keys), row tooltips and the preview card include last-opened text, and category edits from **Config → Bookmarks** persist reliably to the server.

Since **v2026.08.08**, the example bookmarks on a new install are dated at the moment the install is seeded, so **Recently added** and the age columns have something to work with from the first run instead of reading as undated. A factory reset seeds them the same way. Bookmarks created before that release keep their original blank date.

The modal includes page, category, preview, tags, and note.

Since **v2026.09.05.1**, the **Page** and **Category** dropdowns each lead with **➕ New page…** and **➕ New category…**, so a bookmark can be filed somewhere that does not exist yet without leaving the half-filled form. Picking one hides the dropdown and puts a name box with **Create** and **Cancel** in its place; the new page or category is selected when you come back. A category is created on whichever page the **Page** dropdown is showing — including a page you created moments earlier in the same form — and a new page appears as a tab straight away. A name that already exists is refused under the box, with the box left open so you can correct it. **Enter** confirms the name and **Esc** closes just the name box, leaving the bookmark you were filling in untouched.

**Availability, Shortcut and Pinned sit above the *More options* fold**. Availability is the same **Off / Periodic / Monitor** choice as the bookmark editor in Config — with the interval picker for Monitor and the same explanation behind the **(i)** — so a bookmark can be set up for monitoring at the moment you add it. Before this the modal offered only a *Status check* box, which could not express the three-way choice: Monitor is a superset of Periodic, so *monitored* was unreachable here. **Pinned** uses the same pin pill as the inline editor and Config rather than a bare checkbox.

### 7.3 Paste a URL (`Ctrl+V`)

With the dashboard focused and no text field active, paste a URL. A choice dialog offers **Save to Inbox** or **Add bookmark** (full modal pre-filled). Set a default under **Config → Behavior → Inbox** (*Ask each time*, *Always add bookmark*, or *Always save to Inbox*). Paste is ignored while **inline edit** or the **tag word cloud** is open. If paste cannot open the form (no active page, Inbox disabled, or the feature is blocked), a notification explains what to do.

### 7.4 Inline edit after long-press

Long-press a bookmark row (~500 ms, not on the drag strip) to edit in place on the dashboard — including rows shown in **smart collections** (Today, Recently opened, etc.). The editor opens in a **nearly opaque panel** (~96% background) with a **full-page blur** behind it — including in the **launcher** preset, where other tiles blur but the form stays sharp and readable. The form shows field-level validation errors while you type. Success and error toasts use your UI language. **Save** or **Ctrl+Enter** writes changes to disk immediately (no separate dashboard Save button); **note** and **tags** sync to the bookmark on its category column and in the global store. Press **ESC** or click outside to dismiss; both use an in-app confirm dialog if you have unsaved changes. **Page switches**, **tag-filter** changes, and **config sync** from another tab also confirm before discarding unsaved edits. Background dashboard re-renders are skipped while unsaved inline edits are open. Keyboard grid navigation, **swipe page change**, and **Ctrl+V** paste are paused or blocked while the editor is open. Closing the editor puts the keyboard cursor back where it belongs: on the row you were editing if you opened it with the keyboard, and released if you opened it with the mouse, so the next arrow key resumes from the top instead of stepping past that row. Delete confirms first (modal above the editor), then persists right away; undo in the toast restores the bookmark on the server and in smart-collection views too.

### 7.5 Right-click menu

Right-click any bookmark on the dashboard for its actions in one place:

| Item | What it does |
|------|--------------|
| **Open in new tab** | Opens the bookmark in a background tab and counts the open, like a normal click (also `Ctrl/Cmd + Enter`) |
| **Copy URL** | Copies the URL to the clipboard; the row flashes green (also `Ctrl/Cmd + C`) |
| **Share… / Copy name + URL** | Hands the bookmark to your system's share sheet with its name and URL. **The entry names what your browser will actually do.** Sharing needs more than the feature being present: browsers only open a sheet in a *secure context*, and **Safari on macOS refuses it over plain `http://` — including `localhost`** — even though it reports the feature as available. When a share is refused the link is copied instead, the message says the browser will not open a sheet here, and the entry re-labels itself to **Copy name + URL** so it stops promising a dialog. Reach the dashboard over **HTTPS** (a reverse proxy or Tailscale) for a real share sheet. Chrome and Firefox on macOS/Linux have no Web Share at all. Closing the sheet does nothing, so a cancel is never mistaken for a copy. Since **v2026.08.08.3** this works on the first attempt: the entry used to do nothing at all when the interaction module had not been fetched yet |
| **Edit** | Opens the same inline editor as long-press (also `Shift + E`) |
| **Tags…** | The quick-tag popover (also `Shift + T`) |
| **Move to…** | The move popover — another category or page (also `Shift + M`) |
| **Checking** | Names the bookmark's current availability mode and opens the three-way choice — **Off** / **Periodic** / **Monitor** (also `Shift + C`) |
| **Show in Health** | Opens the [health view](#15-status-monitoring-and-health) with this bookmark's row selected (also `Shift + R`). Offered for **every** bookmark, including ones with checking switched off — the report covers the whole library, and that row is where checking gets turned on |
| **Select** / **Select all in category** | Starts a [multi-selection](#94-selecting-several-bookmarks) with this row, or with every row in its category. Placed above the divider: below it is the destructive zone, and selecting is not destructive |
| **Delete** | Asks for confirmation first, then deletes with undo in the toast. The bookmark goes to the [trash](#trash-data--backups--trash) for 30 days |

Right-click a bookmark that is **part of an open selection** and the menu switches to the selection as a whole — *Move 5 selected*, *Open 5 selected*, *Copy 5 links*, *Delete 5 selected*, *Clear selection* — with the count named, so it is never in doubt what an action will touch. Right-click a row **outside** the selection and you get the ordinary single-row menu, because that is the row you pointed at. One ticked row is not a bulk operation, so it keeps the single-row menu too.

Apart from sharing, nothing here is exclusive to the menu — the rest is reachable from the [command palette](#93-bookmark-actions) and config, and the menu just puts it where most people look first.

**A category can have an icon.** Right-click its header and pick **Icon…**, type an emoji, press Enter. The header follows what you type before you commit, and Escape puts back what was there. `Category.Icon` has been stored and rendered for a long time — the strings for this control were still sitting unused in all four locales — but there was nowhere to set it, so eight categories on a page meant eight identical `▣` headers. **Clear** takes it off again.

**Every entry that has a key shows it** beside the label (**v1.1.1**), so the menu teaches the keyboard route to the thing you just clicked; screen readers get the same key through `aria-keyshortcuts`. The menu also opens from the keyboard with **`Shift + F10`** or the **Menu** key, beside the row rather than in the corner of the window. Arrow keys move through the items and `Enter` activates one; `Esc` or a click outside closes it. It works on **smart collection** rows too. The menu deliberately stays out of the way where the browser's own menu matters: it does not open while the inline editor is active or over a modal, and **`Shift` + right-click** always gives you the browser menu instead. Not available on touch, which has no right-click — use long-press for inline edit there.

### 7.6 Config → bookmarks (bulk and detail)

**config → bookmarks** is the place for many edits at once: a searchable list with a page filter, Health/Inbox-style rows with an action bar, and a bulk toolbar for whole selections.

**Edit** on a row opens the same add-bookmark modal the dashboard uses, prefilled with that bookmark's fields — name, URL, page, category, tags, shortcut, note, pinned, icon, and availability checking (Off / Periodic / Monitor, with an interval for Monitor). Save from the modal writes your changes; closing without saving leaves the row untouched.

**+ Bookmark** opens the same add form empty. Tick several rows to get the **bulk toolbar** — move to another page or category, pin, refresh favicons, add / replace / remove tags across the whole selection, or delete. **Select all** ticks the rows your filters are currently showing, not every bookmark you own; since **v2026.08.08** it names that count when the list is longer than the rows on screen, because the rest arrive as you scroll.

**Tags** above the list is a tag cloud of every tag in use, most-used first and sized by count (**v2026.09.2**). Click one or more to filter — several tags match bookmarks carrying *any* of them, the same OR logic as the dashboard tag cloud. **Select these bookmarks** turns the filtered result into a ticked selection for the bulk toolbar, and each tag also gets its own removable chip beside the count. The panel starts collapsed and opens on its own when a tag filter is already active.

Selections survive a filter change, so you can gather rows from several pages before acting. When part of a selection is hidden by the filters you have on, the bulk bar says how many and offers **Select only these** to drop them — worth a look before **Delete**, which reaches every ticked row whether or not you can see it.

Deleting — a single row or a whole selection — offers **Undo** in the toast that follows (**v2026.09.2**). Before this, single-row delete had no undo at all, and the bulk one could be pushed off screen by a keyboard tip; a confirmation now takes the slot from a tip rather than queueing behind it.

Since **v2026.08.08**, two bookmarks that share a URL on the same page are treated as separate rows by every bulk and single-row action. Before this they were identified by page and URL alone, so ticking one and deleting removed both; the **Duplicate URLs** cleanup filter under Statistics is the fastest way to find such pairs.

The bookmark modal is comfortable on a wide window; on a narrow one the fields stack.

All bookmark lists in config (per-page editor, tags tab, stats) read from one **central bookmark store**, so tags and edits stay in sync across tabs.

### 7.7 Browser extension

Save the current tab to a chosen page or to **Inbox** (see [Browser extension](#18-browser-extension)).

### 7.8 Import

HTML export from Chrome/Firefox/Edge (see [Import, export, and backup](#17-import-export-and-backup)).

### 7.9 Inbox — capture links for later

**Inbox** is for links you have not sorted into pages yet.

1. Open **Inbox** — header tab, **`Shift+I`**, **`0`**, or **`:inbox`**.  
2. **Add** — paste `Ctrl+V` on the dashboard and choose *Save to Inbox*, use the extension **Save to Inbox**, or rely on *Always save to Inbox* in General settings. Fresh items show a preview placeholder until the server fills it in.  
3. **Browse** — filter *All* / *Unread* / *Snoozed* / *With note*, search, filter by site, and scroll date groups. Each filter pill carries its own count, and a sentence under the toolbar says what the active filter selects (**v2026.09.06.2**). The active filter appears under the **Inbox** title as a breadcrumb (e.g. `inbox › unread`), same placement as Health and Config (**v2026.08.08.4**). Unread items show a badge on the Inbox tab. Long lists load further rows as you scroll rather than a page per click (**v2026.09.06.2**).  
4. **Act on a row** — *Open* in a new tab, *Promote* to open the new-bookmark form pre-filled — with every page and category available in its dropdowns, so the bookmark can be filed anywhere (status-checked bookmarks are health-checked right away), *Mark read*, *Snooze* (`z`: 3h / tomorrow / weekend / next week), add a *Note* (`n`), **Share** or copy from the right-click menu (**v2026.08.08.4**), or *Delete* (undo in the toast). Use the toolbar to **Mark all read** or **Clear read**.  
5. **Keyboard** — `j`/`k` move, `g`/`G` first/last, `Enter` open, `p` promote, `r` mark read, `n` note, `z` snooze, `d` delete, `x` tick a row and move on, `Shift+↑/↓` extend the selection, `Ctrl/Cmd+A` tick everything on screen, `R` re-fetch the list, `Esc` clear the selection (legend under the list).  
5b. **Several at once (v1.0.0)** — tick rows and the bar offers **Promote** (choose one page for the lot), **Open**, **Copy links**, **Mark read**, **Snooze** and **Delete**. When a filter hides some of what you ticked, the bar says how many it cannot reach and offers **Select only these**.  
5c. **Stats (v1.0.0)** — the **Stats** button reports how many links you have added, promoted and deleted, what share of the ones you decided on became bookmarks, and how long a link typically sits here. The rate is worked out over the links you *decided on*, not everything ever added, and each figure carries that explanation as readable text rather than as a tooltip.  
5d. **Take the list with you** — **CSV** and **JSON** download exactly what the view is showing, and the file is named after everything that shaped it: the filter, the site, the tag and the search term. **Import** reads a JSON export back in — a file from another install, or one you edited by hand. Links already in the inbox are skipped rather than duplicated, and the toast accounts for every row in the file: added, already here, failed, and whether the item cap stopped the rest.  
6. **Triage** — click **Triage** or run **`:inbox triage`** to walk unread items one by one: `J`/`K` move, `O` open, `P` promote, `R` keep (mark read), `D` delete, `Esc` close.
7. **How it works** — the **`ℹ`** at the end of the toolbar explains what the inbox is for, what read and unread track, what snoozing hides, what promoting leaves behind, and the two ways through a backlog (**v2026.09.06.2**).
8. **The one-time tour** — the first time the inbox opens, a guided modal walks the whole loop in seven steps: where links come from, what read really means, snoozing, notes, promoting, triage, and selecting several at once. It appears once — finishing it, **Skip** and `Esc` all count as seen — and everything in it is covered at more length in **Config → Help → Inbox**. Turning off *Show occasional keyboard tips* under **Config → Behavior → General → Onboarding** suppresses it along with every other one-time hint, and **Show quick-start card again**, in the same place, brings it back after you have seen it.

**Snoozed links are counted as hidden.** The tiles, the header badge and the Inbox tab all count what you can act on now, so a snoozed link is left out of every one of them until it wakes — including *This week* — and **Clear read** leaves snoozed links alone (**v2026.09.06.2**). The first tile is therefore named *Active* rather than *Total*: it counts what the list can show. A line under the list says how many links are asleep and when the first one is due, with a button that switches to *Snoozed* — outside its own tile a sleeping link is otherwise invisible. Your filter, sort and chosen site are remembered for the next visit; a site filter is dropped once its last link leaves the inbox, rather than filtering the list down to nothing.

**Every number counts the rows on screen.** A search or a site filter narrows the tiles, the pills and the header badge along with the list, so nothing promises rows the view is not showing. The site picker offers only sites the active filter can actually reach and says how many rows each one leaves (`example.com (4)`), and **Mark all read** becomes **Mark shown read** — acting on what you can see — as soon as something is narrowing the view. **Clear read** works to the same edge.

**Moving can be undone.** Moving a bookmark to another category — one row, a multi-select, or everything the tag filter is showing — now offers **Undo** in its toast for eight seconds, the same window a delete has. A bulk undo puts each bookmark back in the category it came from rather than filing them all together, because the move records where each one was before it wrote the new value.

**Undo works even at the item cap.** The inbox keeps at most `inboxMaxItems` links (500 by default) and drops the oldest beyond that. Undoing a delete puts the link back with the time it was *originally saved*, not the moment you pressed undo — which, in a full inbox, is precisely the entry the cap would otherwise discard. A returning link is therefore protected and the oldest of the others makes way for it. When there is genuinely no room the undo says the inbox is full, rather than reporting success and quietly dropping the link, which would leave it looking restored until the next reload.

**A link can go back to unread.** Right-click a read row and choose **Mark unread**. The server has always accepted it — a `readAt` of 0 clears the flag — and no client ever sent it, so unread was the one inbox state that only went one way while snoozing, notes, tags and deletes were all reversible. The only escape was *Clear read*, which deletes.

**The fetched summary is shown.** When a link is captured the server downloads its page description; it was stored on every item and displayed nowhere. It now sits under the title, clamped to two lines, and rides along in both exports. Searching matches it too — that read a field name the API never sends, so the one consumer of the summary matched nothing at all.

**Tags are shown, editable and searchable (v1.0.0).** Tags sent when a link is captured — by the extension or by anything posting to `/api/inbox` — have always been stored, but nothing displayed them. They now appear as chips on the row: click one to filter the list to it and click again to clear, right-click a link and choose **Tags** to edit them (comma-separated), search matches them alongside the title and note, and both exports carry them. The tag filter is part of the shared link, so `?ib_tag=` survives a reload. The inbox itself still never assigns a page or category on its own; that choice is made once, at promote time.

**Favicons are fetched once.** Items saved before icon storage existed get their favicon filled in by a background pass at startup. Plenty of sites simply have no favicon, so the attempt is recorded whether or not it found anything — otherwise the same doomed fetch would run again on every single restart, forever, for every such link.

The first visit may show a short intro modal. Replay it from **Config → Behavior → General**.

### ♻️ Duplicate URLs

nextDash warns when a URL already exists on the same page (canonical match: trailing slash, hash, host letter-case, and default ports are ignored — e.g. `https://x` ≡ `https://x:443`). You can still save anyway in the extension or modal when needed. Use **`:duplicate`** in search or the Health view to find duplicates across all pages. Imports **skip** duplicates and show a preview: e.g. **12 new, 3 conflicts (skipped)**.

---

## 8. 🔖 Opening and using bookmarks

### 🖱️ Mouse

- Click the bookmark name (or icon area) to open the URL.
- Bookmarks **without a display name** show the site **hostname** in the grid (e.g. `docs.example.com`); hover or keyboard focus shows the **full URL** in the tooltip.
- Respect **open in new tab** setting from config.  
- **Launcher layout**: large tiles; click plays a short pulse animation.
- **Right-click** a bookmark for its actions — open in new tab, copy URL, edit, tags, move, delete. See [Right-click menu](#75-right-click-menu). **`Shift` + right-click** gives the browser's own menu.
- **Long-press** (~500 ms, not on the drag strip) opens the [inline editor](#74-inline-edit-after-long-press).

### ⌨️ Keyboard

- Start grid navigation with **Tab**, a click on a bookmark, **hold `G` then `1–9`** / **`GG`**, or the **first arrow key**; then use **plain arrow keys** to move the selection (`Shift+←/→` changes pages only).  
- After switching pages with **1–9**, the **first visible bookmark** on the new page is selected automatically.  
- **Collapsed categories** and **launcher tiles dimmed by search** are skipped by keyboard navigation.  
- **Category headers** are keyboard-focusable: **Enter** or **Space** toggles collapse (`aria-expanded` updates).  
- When you move the **mouse over bookmarks**, the stale keyboard highlight **softens** until your next keyboard move.  
- **Enter** or **Space** opens the selected row.  
- If the bookmark has a **shortcut**, type it and press **`Enter`**. Typing filters the list; it never opens anything on its own. That is the default, and it is a choice: **Config → Behavior → Search → Typing a bookmark shortcut** also offers *Open after a short pause* — the shortcut opens by itself once you stop typing for about half a second, and a word that carries on past it keeps going — and *Open the moment it matches*, which is what the dashboard did before **v1.2.0**. Before this, a shortcut fired the moment your query matched it exactly and no longer shortcut shared its letters — so whether your own word survived depended on which *other* bookmarks you owned: on an install with 200 shortcuts, eight of thirteen ordinary words were swallowed mid-word (`invoice` opened something at `in` and left `voice` behind; `github` arrived as `hub`). One extra keystroke buys a keyboard that behaves the same every day.
- **While a row is selected the letters belong to the grid** — **`j`** / **`k`** move, **`x`** ticks, **`g`** starts the jump chord, **`t`** filters by the row's tag — and **`Esc`** hands them back to the search line. **`c`** is the exception: it adds a category whether or not a row is selected, so a search cannot begin with `c`; press **`>`** first.
- **The shortcut field says what a letter costs.** Assigning `c`, `g`, `j`, `k` or `x` now shows what the dashboard does with it and when the bookmark is still reachable, beside the check that another bookmark already has it. Both the inline editor and the bookmark form say it.

### Hyprland / special setups

If **Hypr mode** is enabled in settings, bookmark clicks may be routed to your window manager instead of the browser default.

### 📈 Usage tracking

Each open increments **open count** and updates **last opened**. This powers smart collections (“Recently opened”, “Most used”, “Stale”) and stats. Opens count wherever they happen — the dashboard, the recent panel, search, and the health view — and stats records which of those it was.

Health opens were the exception until **v2026.07.25.1**: they opened the link but recorded nothing, so a bookmark you only ever reached from the health view stayed on zero opens and kept being flagged as stale. Fixed, but not retroactively — opens from before that release were never written down.

**Where you can see it.** Since **v2026.07.25.2** every bookmark shows its own figures in three places:

- **Config → Bookmarks → Edit** — a statistics block with when it was added, when it was last modified, how often it has been opened, when that last happened, and the result of the last availability check. The collapsed rows carry the short version (`35× · 2d ago`) so you can scan for dead weight without opening each one.
- **Hovering a bookmark** on the dashboard — the tooltip adds the open count and last opened. Screen readers deliberately keep the short label, since it is announced on every row while you move through the grid.
- **The link preview card**, if you have preview cards switched on.

**Last modified** is recorded from v2026.07.25.2 onward. It tracks changes you make — name, URL, category, tags, shortcut, icon, note, pin, availability mode — and deliberately ignores background activity: a health check writing its result, or you opening the link, is not an edit. Bookmarks that existed before this release have no edit date until you next change one, and show `—` rather than a made-up date.

Added dates work the same way: bookmarks from before that field existed show `—`, and nothing can recover those dates after the fact.

### 🕘 Recent panel (`*`)

Shows bookmarks you opened recently **on the current page** (not global). Each row shows rank, a recency badge, and open count. Use **`↑`/`↓`/`Home`/`End`** to move between items and bulk-open buttons. From the panel you can open one or use bulk actions aligned with **`:open last`**.

---

## 9. ⌨️ Keyboard navigation

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
| `n` | In the page overview: open the **New page** row. Arrowing one stop past the last page reaches it too (**v2026.09.06**) |
| `c` | Add a category to the page on screen (**v2026.09.06**). Acts on the first press since **v1.1.1**; it used to need a hold of about 300 ms so a tap could still reach the shortcut search. It is the one letter that keeps the grid over the search line, so a search cannot begin with `c` — press **`>`** first |
| `<` | Open **config** (`<` is `Shift+,`). In config, `<` returns to the dashboard — asking to confirm first if there are unsaved changes |
| `.` | Collapse or expand **all** categories at once (smart toggle — any open → all collapse; state remembered per page) |

### 9.2 Bookmark grid

| Keys | Action |
|------|--------|
| `↑` `↓` `←` `→` | Move selection (first arrow key starts navigation if none selected) |
| `k` / `j` | Same as `↑` / `↓`, matching the lists in config (**v1.1.1**) — but **only once a row is selected**: the dashboard's search line is always listening, so a bare letter typed with no cursor in the grid is a character, not a command. The arrows are the way in |
| `1`–`9` (page switch) | Also selects the first visible bookmark on the new page |
| `Tab` / `Shift+Tab` | Linear next/previous bookmark when a row is selected; at the first/last bookmark, Tab exits to the header/FAB |
| `G` then `1`–`9` | Jump to nth visible category or smart collection, select first bookmark. The first `G` arms the chord straight away and a **`g…` pill** in the corner says so; it lapses after three seconds. Like `j`/`k`, the chord only arms with a row selected — otherwise `g` is a letter, and a search for *github* would lose it |
| `G` then `P` | Jump to first pinned bookmark on the page |
| `GG` | Jump to very first bookmark (second `G` while chord pending) |
| `Ctrl + Home` / `Ctrl + End` | First / last bookmark on the page (`Cmd` on Mac) |
| `Shift + Home` | Step up from the list to its category header, where `F2`, `Shift + W`, `Delete` and `Shift + F10` act on the category (**v1.1.1**) |
| `Alt + ←` / `Alt + →` on a header | Move that category one place left or right. `Alt` + arrow already means "move the thing under the cursor" for a bookmark; on a header it is the same idea one level up. Reordering used to mean dragging the small `//` prefix or going to config. Smart collections are skipped — their order is derived, not stored — and focus follows the category rather than the header element the render replaces |
| `Enter` / `Space` | Open selected |
| `Esc` | Clear selection and move focus to the first bookmark; may undo last drag reorder. With something typed it clears the search line, which now empties on screen instead of keeping the abandoned query until the next keystroke |

**The line you type into names its own key.** The prompt shows the key that starts each mode in front of the mode itself — **`>`** search, **`:`** commands, **`?`** finders, **`@`** everywhere — so the convention is legible without reading the legend under it. Typing a bare letter still searches, and now that is all it does — nothing opens until `Enter`, so `>` is a way to be explicit rather than a way to protect your typing. Once there is a query, an **`×`** beside it clears the line, for touch and for anyone who would rather click than reach for Escape.

**A key legend under the bookmarks.** On for a fresh install and off for everyone who already had a dashboard — an existing `settings.json` has no such key, and appearing under a grid someone already knows is not a welcome. Switch it either way with **Show a key legend under the bookmarks** in **config → behavior → general**, beside the other two discoverability switches, and it stays out of the way even then — four keys (`↑↓←→`, `Enter`, `x`, and `!` for the rest), appearing only once you move the cursor with the keyboard and going again the moment you open a bookmark.

### 9.3 Bookmark actions

| Keys | Action |
|------|--------|
| `Shift + Alt + ←` / `→` | Move the selected bookmark into the category beside it, in the order the page shows them. `Alt` alone moves the category, the plain arrows move the cursor, so the third gesture takes the third modifier. Smart collections are skipped — they are a query, not a place a bookmark can be put |
| `Shift + F` | Filter the page you are on: a slim bar above the grid hides every row that does not match, and any category left with nothing in it. Matches what the row shows — name, shortcut, address, tags. `Escape` clears the query, a second `Escape` closes the bar. Different from search (`>`), which is an overlay over every page and takes you somewhere |
| `Shift + E` | Inline-edit selected row (page switches confirm before discarding unsaved edits). Was `;`, which still works but is no longer listed (**v1.1.1**) |
| `Shift + M` | Move to… (category or another page); popover receives focus — use arrows and `Enter` inside it |
| `Shift + T` | Quick-tag selected row (popover receives focus — `↑`/`↓` navigate; `Enter`/`Space` toggle tag and advance to next; `✓` on tags already applied) |
| `Shift + D` | Quick-delete selected row (popover receives focus; undo in toast) |
| `Shift + C` | Availability checking for the selected row — **Off** / **Periodic** / **Monitor**. The popover anchors below the row and opens on the current mode; pick with `o` / `p` / `m`, or arrow and `Enter` |
| `Shift + W` | Spread the focused category across columns, or put it back to one |
| `Ctrl + C` | Copy URL (row flashes green) |
| `Shift + P` | Pin or unpin the selected row |
| `Shift + L` | Share the selected row, or copy its name and URL where there is no share sheet. Was `Shift + S`, which now always opens config (**v1.1.1**) |
| `Shift + R` | Show the selected row on its own line in Health |
| `Shift + V` | Toggle hover preview card on selection. Was `[`, which still works but is no longer listed — brackets mean *previous / next sub-tab* in config (**v1.1.1**) |
| `Delete` | Delete selected bookmark — the same popover `Shift+D` and the right-click menu open, beside the row. With a selection open it deletes everything selected instead, confirmed in one modal that names the count |
| `Enter` / `Space` on **+ N more** | Expand or collapse a long category; selection returns to the last bookmark above the toggle so you can keep arrowing down |

### 9.4 Selecting several bookmarks

Bulk actions used to live only in the tag filter, so acting on several bookmarks at once required them to share a tag. Any rows will do now.

| Keys | Action |
|------|--------|
| `x` | Tick the row under the cursor and move to the next one, so a run of rows is `x`-`x`-`x` rather than `x`-`↓`-`x`-`↓` |
| `X` | Tick every row in the selected row's category |
| `Shift + ↑` / `Shift + ↓` | Extend the selection a row at a time |
| `Ctrl/Cmd + A` | Tick everything currently on screen |
| `Ctrl/Cmd + click` | Add or remove a single row with the mouse |
| `Shift + click` | Extend the selection to the clicked row |
| `Esc` | Clear the selection |
| `Delete` | Delete everything selected (one confirmation for the whole set) |

A toolbar appears above the grid while a selection is open, with **Move**, **Tags**, **Open**, **Copy links**, **Delete** and **Clear** — the same actions the right-click menu offers, doing exactly the same thing. **Move** opens the ordinary move popover, so a bulk move picks a category or page the same way a single move does.

**Tags** lists every tag you already use, each showing how it sits across the selection: a **✓** when every selected bookmark has it, so clicking takes it off; a **–** and *on 2 of 3* when only some do, so clicking fills in the rest; and plain when none do. The count is spelled out because *add* and *remove* mean different things for a mixed selection. Since **v2026.09.05.1**.

**Deleting a selection can be undone** (v1.0.4). The toast offers **Undo** for eight seconds and puts every bookmark back in the position it held; the [trash](#trash-data--backups--trash) still catches it for 30 days after that. If the save does not go through, the rows come back and an error says so, rather than disappearing from the screen in silence.

A **plain click while a selection is open clears it** instead of opening the bookmark, so a stray click cannot act on rows you had forgotten were ticked. A bookmark that appears in a [smart collection](#13-smart-collections-and-custom-collections) as well as its own category lights up in both places, because it is one bookmark shown twice.

**Pages remember where you were reading** (v1.0.4). Switching to another page and back returns you to the offset you left, within the same visit; opening the page fresh starts at the top as it always did.

### 9.5 Cheat sheet

Press **`!`** or **`F1`** (or run **`:cheat`** / **`:help`**). Focus lands in the filter box automatically. Type to narrow the list. When the **side rail** is active, a **Layout (side rail)** section lists tab order and `:buttonbar` hints. The cheat sheet does not open while the **page overview** (`,`), **tag cloud**, or another blocking overlay is open. On first open (desktop), a one-time **Got it** balloon may appear beside the modal — dismissing it does not close the cheat sheet.

Since **v2026.08.09** the sheet opens on the section for the view you are in: from **Health** the health shortcuts lead and are marked, from **Inbox** the inbox ones (inbox triage when that overlay is up), from **config** the config ones. Nothing is hidden or reordered — the filter still searches every section — and opening it from the bookmark grid behaves as before. A one-page **Shortcuts PDF** is linked from **Config → Overview** (Tips panel) and at the top of **Config → Help**; it always opens in a new tab.

Every shortcut uses its **fixed default**. Custom key rebinding is not available — the cheat sheet is the authoritative list.

**Occasional tips** — now and then the dashboard shows one keyboard tip as a small toast with a **Cheat sheet** button beside it. It draws from the built-in tips catalogue, appears at most once every few days, never repeats a tip you have already seen, and stays away during first-run setup, on touch, and while a dialog or the inline editor is open. Turn it off under **Config → Behavior → General**.

### 9.6 Blocking overlays & focus

While any of these are open, the bookmark grid behind them is **inert** (not clickable) and keyboard focus stays inside the overlay until you close it:

| Overlay | Shortcut / trigger |
|---------|-------------------|
| Shortcut search | `>` (also `:` / `?` modes in the same panel) |
| Cheat sheet / recent | `!` / `F1`, `*` |
| Tag word cloud | `/` (desktop, when enabled) |
| Page overview | `,` |
| Quick-add omnibox | `&` |
| Quick move / quick tag / quick delete / checking | `Shift+M` / `Shift+T` / `Shift+D` / `Shift+C` |
| Inline edit | `Shift+E` |
| App modal | e.g. new bookmark `+`, confirmations, recent bookmarks `*` |

**Tab** / **Shift+Tab** cycle within the open overlay. **Escape** closes it and restores focus to the control that opened it (or the bookmark grid). One-time **Got it** discoverability balloons dismiss with **Esc** without trapping the overlay open. A `MutationObserver` re-syncs dashboard `inert` when overlays are added or removed so the grid is not left stuck non-interactive. With an **active tag filter**, only the bookmark list is `inert` — the filter banner and bulk toolbar stay interactive while the tag cloud is open. Grid shortcuts **`Shift+E`**, **`Shift+M`**, **`Shift+T`**, **`Shift+D`**, **`Shift+C`**, **`Shift+P`**, **`Shift+L`**, **`Shift+R`** and **`Shift+V`** work on the keyboard-selected row when no overlay is open.

---

## 10. 🔎 Search, commands, and finders

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
| `status:` | `status:online`, `status:broken`, `status:pinned`, `status:untagged`, `status:noted`, … |
| `opened:` | `opened:today`, `opened:week`, `opened:month`, `opened:year`, `opened:never` |
| `added:` | `added:today`, `added:week`, `added:month`, `added:year` |
| `-` before any of them | `-tag:archive`, `-category:work`, `-status:pinned` |

**Every filter also works in the negative.** A leading `-` excludes instead of selects, so `tag:dev -status:pinned` reads as "dev links I have not pinned". Custom collections have had an *excludes* operator on every rule field since they were built; the search bar could only say yes, which is the wrong half for a tidy-up question. A half-typed `-tag:` excludes nothing rather than everything.

**`status:untagged` and `status:noted`** (with `tagged` / `unnoted` as their opposites) close the other gap: *untagged* was already a collection rule, a stats row and a config filter, and was the one thing the bar could not ask for — while a note is the sentence you left to explain why a link was worth keeping.

Since **v1.0.4** the two age filters are offered while you type, like the others, with their words listed once the key is in — `never` only under `opened:`, since a bookmark has no "never added" state. While typing a partial value (e.g. `status:on`), autocomplete stays visible until the token is complete. `status:online` / `status:offline` use persisted reachability on monitored bookmarks.

**Bookmark shortcuts starting with `G`** — `G` now belongs to the jump chord in every case (see §9.2): the first press arms it, a digit or `P` follows, and a second `G` goes to the top. Reach a bookmark whose shortcut starts with `g` through search (`>`) instead.

### 10.2 Tag word cloud (`/`, desktop)

When **Tag cloud (/)** is enabled (config → appearance → display, on by default on desktop):

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
| `:recent` / `:overview` / `:cheat` / `:help` / `:whatsnew` / `:reload` | Recent modal (`*`), page overview (`,`), cheat sheet (`!` / `F1`), what's new, reload |
| `:inbox` / `:inbox triage` | Open Inbox (`Shift+I`, or `0`) or triage unread items one by one |
| `:config [section]` | Open config or tab (`bookmarks`, `backups`, `stats`, …) |
| `:stale [days]` | List stale bookmarks |
| `:health [filter]` | Open health view (`Shift+H`) — `broken`, `duplicate`, `stale`, `refresh`, … |
| `:health page [n]` | Open health with a specific page context |
| `:monitor` | Shows how many bookmarks are checked (monitored and periodic). `:monitor off` turns checking off for all of them at once; `:monitor on` opens the health view filtered to never-checked bookmarks, where the bulk button confirms before enabling — there is deliberately no "monitor everything" |
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
| `:width on` / `off` | Spread the focused category across columns, or put it back; `:width all` switches every category back |
| `:buttonbar bottom\|bottom-left\|bottom-right\|side-left\|side-right` | Button bar position (`side-left` / `side-right` = vertical rail on that edge) |
| `:save` / `:saved` | Save / list saved searches (kept in settings, so they are in every ZIP backup and follow you between browsers — **v1.0.2**) |
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

## 11. 🗂️ Organising pages and categories

### Create pages and categories

Neither has to start in config (**v2026.09.06**). Both gestures live where the things themselves live.

- **A page** — open the pages overview with **`,`** and use the **New page** row under the list: by click, by **`n`**, or by arrowing one stop past the last page. Naming it takes you straight to the new page, which is where its first category gets added anyway. The pages button in the header is unchanged — switching pages is the daily action, creating one is the rare one.
- **A category** — a **`+`** sits beside the **A–Z** / **Rec** chips in a category header, and **`c`** does the same from the keyboard. Both act on the page on screen, so neither asks which page you meant. The key acts on the first press: it used to wait out a hold of about 300 ms so a tap could still reach the shortcut search, and it was one of only two keys that did. The `+` appears in whichever header ends the grid, and costs no space of its own.
- **From the bookmark form** — the **Page** and **Category** dropdowns each lead with **➕ New page…** and **➕ New category…**, so a bookmark can be filed somewhere that does not exist yet without leaving the half-filled form.

**Right-click a category header** — or press **`Shift + F10`** on it, or the **Menu** key — for **rename**, **spread across columns**, **add category** and **delete** in one menu, each with its key beside it. **`Delete`** on a focused header deletes that category directly, with the same confirmation (**v1.1.1**) — it used to open the menu, the one place in nextDash where `Delete` meant *show me the options*. Renaming was previously only reachable through a long press, and deleting meant a trip to config. Deleting tells you what it will do first, with the count — the bookmarks are **kept** but lose their category and reappear under *unknown category* — and the delete goes to the [trash](#trash-data--backups--trash). Smart collections and tag-filter groups have no menu: they are views over bookmarks rather than stored categories.

A category you have just created **stays visible** even with *hide empty categories* on, until you leave the page — otherwise it would vanish in the moment between creating it and putting something in it.

### Reorder bookmarks

- Drag a bookmark from **anywhere on its row** to reorder within a category or drop it on another category. A single **click** still opens the bookmark, and a stationary **long-press** still opens the inline editor — only a drag gesture reorders.
- Dragging **across columns** shows a drop marker without the column flicker earlier versions had; the row settles into place when you release.
- Manual drag only works while a category is on **manual order**. If it is sorted **A–Z** or **Recent**, bookmarks there can't be dragged (the sort would undo it) — the category shows a hover tooltip, a not-allowed cursor, and a brief note when you try, reminding you to switch it back to manual order first. A plain click still opens the bookmark.
- Reorder saves **debounce 1 second** (like category order) and show a localized success toast.
- **Esc** undoes the last reorder if the debounced save has not completed yet.

### Reorder categories

- Drag the **`//` prefix** in the category title on the dashboard, or drag rows in **config → pages & tags → categories** (or focus a row and press **↑** / **↓**). The `//` acts as the drag handle — a plain click on it still toggles collapse.
- Order in **config → pages & tags → categories** saves automatically after a short debounce (~600 ms) with a localized sync toast.

### Reorder pages

- Drag the **grip** on a row in **config → pages & tags → pages**, or focus a row and press **↑** / **↓**.
- Order saves automatically after a short debounce (~600 ms) and shows a localized sync toast.

### Move between pages

- **Shift+M** on dashboard, or detail panel in config, or bulk move in config.

### Page customisation

Double-click a page tab **on desktop or tablet landscape** (not on mobile — avoids accidental renames on touch):

- Rename the page  
- Set an optional **emoji** icon  
- Pick a **colour dot** from eight swatches (or the empty swatch to remove it); the dot appears on the tab beside the label or page number

The popover saves when you click away or press **Enter**. Use **config → pages & tags → pages** to rename on any device or to manage several pages in a list.

### Sorting

- Each category header has **A–Z** and **Recent** toggles at full visibility (including **Other** and unknown-category blocks); click an active toggle again to return to manual drag order. Sort buttons are keyboard-focusable; **←** / **→** move between them without collapsing the category.
- Sort is view-only: bookmark order in data is unchanged until you drag (manual mode only).
- **`:sort`** applies to the category you are focused in (keyboard selection or first category as fallback) and shows the category name in the command palette.

### Collapse

Click category header or chevron, or focus the header and press **Enter** / **Space**. Press **`.`** anywhere on the dashboard to collapse or expand **every** category at once (smart toggle — if any category is open, they all collapse; otherwise they all expand); state is remembered per page. **Always collapse categories** can be set in general settings.

---

## 12. 🏷️ Tags, notes, and metadata

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
- **`Shift+V`** toggles preview card on keyboard focus.  
- **Show favicons** — **Config → Appearance** or `:favicons on/off` on the dashboard.
- **Refresh every icon** — `:favicons fetch` re-downloads the favicon of every bookmark on every page, replacing the ones already stored, so icons that changed at the source are updated too. A progress bar shows how far along it is. The same run happens automatically once on a new install, right after you finish or skip the first-run setup card while keeping the example bookmarks. Individual icons can also be refreshed from the health view (`f` on the selected row), and **Config → Bookmarks** has a bulk **Refresh favicons** button for a selection.  
- **Fetch favicon** in config detail or health actions.

### Shortcuts

- Single character per bookmark; must be unique across **all pages** when set.  
- Shown in the shortcut column; included in screen reader labels.

---

## 13. 🧩 Smart collections and custom collections

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

You can **long-press** or press **`Shift+E`** on a smart-collection row to inline-edit or delete; changes apply to the real bookmark on its page and stay in sync across collection columns.

### Custom collections

**config → pages & tags → collections**: name, icon, AND/OR rules on tag, category, or shortcut. Each rule's value field autocompletes from the tags, categories, and shortcuts already in use, so you rarely type a full value (shortcut suggestions keep their original casing). Appear as dashboard groups above regular categories.

### Tag collections

When enabled, one auto-group per tag that meets minimum count.

---

## 14. 🎨 Layouts, themes, and appearance

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
- **Quick-start card** — the layout step covers packed columns and columns per row (see [Quick-start card](#quick-start-card-doesnt-appear)).  
- **Dashboard command mode** — `:layoutversion` lists options; `:layoutversion modern` / `:layoutversion classic` applies one; `:layoutversion toggle` switches between them.  
  (This is **not** the same as `:layout`, which switches **presets** like launcher or compact — see below.)

**Post-onboarding prompts** — On desktop, the **first config open** may show a one-time keyboard intro toast (**v2026.08.01**); an unread **What's new** release can surface a hint in search for seven days — the release modal never opens by itself (see [What's new](#whats-new)). Last-seen release syncs via **`settings.discoverabilityState`** in `settings.json` across browsers. The quick-start card and its checklist are the only other first-run prompts (see [Quick-start card](#quick-start-card-doesnt-appear)) — the tours, spotlights, and discoverability promo balloons this section used to describe were all removed in **v2026.07.17**.

### Layout presets

| Preset | Character |
|--------|-----------|
| **Default** | Classic multi-column grid |
| **Compact / Cards / Masonry / List** | Density and visual style |
| **Launcher** | Large favicon tiles; enable via **Config → Behavior → Layout** or `:layout launcher` in search |

### Spacing (v2026.09.06)

Two settings under **Config → Appearance → Layout → Bookmarks layout**, each a row of three buttons rather than a dropdown.

| | Snug | Balanced | Airy |
|---|---|---|---|
| **Category spacing** — the gap between rows of categories | Rows sit close together | **Default** — a little tighter than pre-v2026.09.06 | The gap the dashboard used to have |
| **Page margins** — the empty band down the left and right | Narrow edges, more room for columns | **Default** — exactly the margin the dashboard always had | Wide edges, columns pulled together |

This is not the same as **Density**, which sizes the bookmark rows *inside* a category; spacing is the room *between* the rows those categories sit in.

Two things worth knowing:

- **Page margins never move on their own.** *Balanced* is byte-for-byte the margin `.container` has always carried, so an existing dashboard looks identical until you pick something else.
- **Every option still narrows the margin on a small window**, so the columns are never squeezed before the whitespace is. And the space *Snug* hands back only becomes **wider columns** when **Pack columns tightly** is on (the default) — with packing off the columns are a fixed width and the reclaimed space stays empty.

**Settings that are a shape are drawn.** Columns per row, density, category spacing, page margins, the button-bar position and the layout version each carry a small stand-in drawing beside the control — bars at the proportions of a real grid — and it redraws as you change the value, so the answer to "what will this look like" is on the panel rather than behind a trip to the dashboard. The type-size buttons show the letters at the size they set, the background-dots toggle shows the dots, **Paste destination** draws the route a pasted link takes — forking in two where *Ask each time* forks — and the help pages about layout and the inbox open with the same drawings instead of another paragraph. They are decorative: every one sits beside the label that already names it, so a screen reader hears the setting once.

### Themes

- **A fresh install starts on Retro CRT** — green phosphor on near-black, with the light variant of the same pair for daytime, since auto dark mode is on out of the box. Existing dashboards keep whatever theme they already have; the default only decides where a brand-new install begins.
- 74 built-in families (dark/light pairs), including twenty-three new pairs from **v2026.09.08.2** — Blueprint, Static Noise, Signal Flare, Bone China, Peacock, Tyrian, Absinthe, and sixteen more — and twenty from **v2026.07.26** (Patina Verdigris, Rhubarb Tart, Bio Abyss, Sumi Ink, Denim Fade, and fifteen more).  
- **config → appearance → custom themes** — build, edit, and delete your own palettes. **Export** writes a palette to a `.json`; **Import** reads one back as a new theme (**v1.0.2**), so a palette built on one machine can be carried to another, or shared, without a full ZIP restore. A contrast check warns when text against background is too weak to read. Changes preview live on the dashboard behind the config view; leaving the tab drops an unsaved preview rather than leaving the dashboard half-edited.
- **config → appearance → general** — pick the active theme for the whole app (built-in or one of your own). Since **v2026.09.08.2** the list previews as you move through it: arrow keys or the mouse apply each theme to the dashboard behind the config view, and nothing is saved until you press Enter or click one. **Esc**, a click elsewhere, or moving focus away puts back the theme you started with, so browsing the list can never leave you somewhere you did not choose.
- **Random theme** (**v2026.07.26**) — under **config → appearance → Theme**, below your saved theme. Choose **Off** (always use the saved theme), **On page refresh** (new built-in pick on each reload), or **On view change** (new pick when switching bookmarks ↔ config ↔ inbox ↔ health, or when switching dashboard pages — tabs, `1`–`9`, swipe, or hash; **v2026.07.26.2**). Each rotate picks a different theme from the pool when more than one is eligible (**v2026.07.26.3**). A **Currently showing** hint names the active theme while random is on. If random is on and you pick a different saved theme, your choice is stored but the display keeps rotating until you turn random off — a toast confirms this (**v2026.07.26.3**), including from `:theme` in search. With **auto dark mode**, only variants matching your system light/dark are eligible; custom single-palette themes are skipped. The first desktop visit to Appearance may show a one-time popover pointing at this control (**v2026.07.26.1**); dismiss it with **Got it** or **Esc** — the button stays fixed while the card appears.
- **Auto dark mode** follows system light/dark for built-in theme pairs; your saved theme id stays stable (the app applies the matching dark/light variant without overwriting the palette name). Disabled with a fully custom theme.
- **Favicon harmonisation** — recolours site favicons that clash with your theme (styles: **Muted**, **Tinted**, **Overlay**, with an intensity slider). Set per theme under **config → appearance → theme**, so the dark and light variant of a pair are configured separately. Changes apply live on the bookmark grid without a reload; stays enabled when a custom theme is active; and with **Random theme** on, it is one shared setting for the whole rotation instead of resetting each time the pool picks a new theme (**v2026.07.26.3**). **New installs start with it on** (Muted, intensity 0.5) for both variants of the default theme; existing dashboards keep whatever they had.

### Config → pages & categories (list tabs)

Desktop list tabs (**pages**, **categories**, **tags**, **finders**, **collections**) share the same layout pattern: a short intro paragraph, toolbar with **+ Add** and filters, then the list. On **Classic** layout, toolbar and list sit inside one elevated surface card. Empty states include a clear next step (e.g. Tags → open Bookmarks to add a tagged bookmark; Collections → start editing a new collection).

- **Pages** — add, rename, remove, drag or **↑/↓** reorder; order auto-saves (~600 ms). **Usage** column shows a popularity bar and bookmark count (Tags-style). Desktop only (mobile shows a toast). On the dashboard, **double-click a page tab** (desktop/tablet landscape) to rename, set an emoji, and pick a **colour dot**; on **Bookmarks**, the **Context** panel only switches the active page — full page editing stays here.
- **Categories** — per-page list with icon, name, **merge**, remove; drag or **↑/↓** reorder with auto-save; **Usage** column with popularity bar and bookmark count (Tags-style). Switching the page selector **or leaving the Categories tab** flushes pending edits first (blocked if validation fails). Delete asks what to do with in-use bookmarks (move, uncategorize, or delete). Breadcrumb shows the selected page. On **Bookmarks**, **Context** only switches the active category filter. Desktop only for full editing.

### Typography and density

- Font preset, size, weight.  
- **`:density`**, **`:columns`**, **`:fontsize`** from commands.

### 🧭 Header and background

- Optional title, background dots, gradient/image. **Background type** defaults to **none** (**v2026.07.26**); choose gradient, image, or **auto** (theme-matched preset) under **config → appearance**. **Background opacity** fades only the backdrop layer — bookmark rows and chrome stay fully readable (**v2026.07.26**).
- **Button bar position** — centre bottom, corner dock, or a **side rail on either edge** (`:buttonbar side-left` / `side-right`). The side rail places navigation buttons in a 44 px vertical strip against that edge (`/` tag cloud directly under `*` recent); the dashboard grid shifts to clear it. On mobile it reverts to a centred bottom bar automatically. The rail is offered once via a card on the dashboard — trying it applies it immediately and tells you where to switch it back.

### What’s new

**Release notes never open by themselves.** A new version does not pop a modal in front of you on load — you open it with **★** or from **Config → Overview → Show what's new**. If a release seems not to have arrived at all, it is usually the browser cache: an already-open tab keeps the files it loaded, so a hard refresh (`Cmd/Ctrl+Shift+R`) settles it.

**Not every release is in the modal.** A small presentation hotfix can ship without release notes of its own — **v2026.07.23.4**, which repaired the health view's see-through **More** menu, is one. The [changelog](CHANGELOG.md) carries the complete history either way.

**★** opens release notes from a **corner FAB** below the `/` tag cloud on desktop (bottom-left by default; mirrored when the button bar is docked left/right; pinned at the bottom of the side rail). It is **not** in the centre dock toolbar. **Config → Help** also has **Show what's new** at the top. **Config → Overview → Latest update** summarises the newest release in plain text (from the same `modalLead` as the ★ modal) with a **Show what's new** button beside it. Since **v2026.08.04**, nextDash can also **check GitHub for a newer release** once a day: a dot on ★, a toast while you are actively using the app, and **Check for updates** on Config → Overview (above Tips). Turn it off under **Config → Behavior → Privacy**. The ★ modal header reports what that check found — the release, a link to it on GitHub, and **Dismiss** — but since **v2026.08.08.2** no longer carries a check button of its own; the manual trigger lives on Config → Overview. The latest release loads first; scroll to load up to the **50 most recent** versions (each fetches its own JSON on demand, with a loading skeleton). A release can be **recorded without being announced**: it counts toward the version number and appears on **Config → Overview → Latest update**, but is skipped in this modal, so a small release landing the same day as a large one does not push the large one aside. v1.1.1 shipped that way and **v1.1.2** put it back in the list; **v1.2.1**, a single Health fix, ships that way too, so the modal still leads with **v1.2.0**. The same releases are summarized under **What's new** in **Config → Help**, and in full in the [changelog](CHANGELOG.md).

---

## 15. 💓 Status monitoring and health

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
| **Last opened** | Every row says when you last opened it on the **right side of the meta line** — domain and check mode stay left; last opened, the primary issue reason, and *+N more* share one right-aligned trail so the dates line up down the feed (**v2026.08.08.5**). Labels read *just opened*, *4h ago*, *yesterday*, *3d ago*, then a date once it is more than a week back (*Jul 21*, and *Jun 2025* beyond a year). The exact moment is in the tooltip. Rows you have never opened say so plainly rather than showing nothing — that is the same signal the **stale** and **unused** filters act on. Opening a row updates the label straight away and never re-ranks the list: nothing in the sort key — score, severity, name — changes when you act on a row (**v1.2.1**) |
| **Score breakdown** | Click the score badge — or press `s` — to unfold how the score was reached: every bookmark starts at 100, each issue lists what it costs (broken −60, duplicate −15, shortcut conflict −15, never checked −10, stale check −5, no preview −5), down to the total. **Usage costs nothing** (**v1.2.1**): *never opened* and *not opened in 30 days* are listed under *worth knowing, at no cost to the score*, and still drive the **Unused** and **Stale** tiles and filters. They used to cost −10 each, which meant opening a bookmark — the thing this view asks you to do — raised its score and, under the worst-first sort, sent the row hundreds of places down the list you were working through |
| **Summary tiles** | Compact stat tiles; click a tile to jump to that filter. **Monitored** sits directly after **Healthy** and colours itself from live state: the whole tile turns **red** while any monitored bookmark is unreachable, **green** while they all answer, and stays neutral at zero. Its tooltip names the split (*1 of 3 not responding*); clicking opens the monitored list and is remembered. A monitor awaiting its first check counts as neither, since unknown is not the same as failing. Each tile explains its rule on hover — which matters most for the pair that sound alike: **Stale** is *not opened in over 30 days*, **Unused** is *never opened at all* |
| **How long it has been failing** | Every checked bookmark records when its current run of failures started, so the row says *failing for 3d 4h* with the first failure date in the tooltip. Only a monitored row had this before, which meant a link that died four months ago looked exactly like one that broke this morning |
| **Gone without saying so** | The most common form of rot is a page that answers **200** and shows *page not found*. With **Config → Behavior → Status & health → Spot pages that answer 200 but say "not found"**, a monitored check reads the page — the same single bounded read drift and the keyword rule already share — and judges the title first, then the opening of the body, in five languages. A hit is a failure with its own class, not a content failure: clearing an expectation does not clear it, because an expectation did not cause it. An explicit expectation still wins |
| **Group by site** | A button beside the sort. One host down takes every bookmark on it with it, and grouped by site that reads as one problem with a count rather than ten problems. Works under every filter and sort |
| **A tile counts what its filter shows** | The Broken tile reads the Broken filter rather than the report's own `brokenCount`, which deliberately keeps a down monitor apart from an ordinary dead link. On screen that split read as *Broken 0* beside a pill saying *Broken 1* — and once empty tiles were dropped, as no tile at all while the filter still had a row. The split is still there and still visible, in the Monitored tile that names it in full, and in the tile's own tooltip |
| **A tile only appears when it has rows** | Broken, Content, Unchecked, Stale and Unused are drawn only when something is behind them, the rule Drift and Certificates already followed. Total, Healthy and Monitored always stay: they describe the collection rather than a backlog, and a zero in them is the answer |
| **Find a setting by what it is set to** | The settings search matches the current value as well as the name and its keywords, and shows it after the location — so *8099*, *Monitor* or *15* find the setting you cannot name |
| **Which settings are per device** | With *Keep settings on this device only* on, a handful stay server-wide by design — the custom favicon, the custom font, collections, the button-bar position. Those carry an **all devices** mark, and the switch itself is marked **this device**. With the setting off everything is shared, so nothing is marked |
| **A statistics row leads somewhere** | A tag in *Most used tags* is a button: it opens **Config → Bookmarks** filtered to that tag, clearing the other filters, the way the cleanup panel already handed off its rows |
| **Duplicate a page or a category** | **Duplicate** on a page row copies its categories, and asks separately whether the bookmarks come too; on a category row it copies the category with its settings and, if you say so, the bookmarks in it. Copies start with an empty check and open history — a copied uptime would be a claim about a URL this copy has never checked — and duplicated bookmarks come without the original's shortcut |
| **Edit a name or shortcut in the row** | Double-click the title, or click the shortcut pill — including the faint **+** on a bookmark that has none — and edit it where you read it. `Enter` saves, `Escape` restores, clicking away saves. A shortcut already taken is named as you type it — *“G” is already GitHub* — and `Enter` refuses it: two bookmarks sharing a key means neither is reachable by it, so the one that already worked is not broken to make room. Clicking away from a clash puts the old value back and says why. The check runs across every page, the same rule the health view's shortcut conflicts use. Anything with a picker (category, tags, checking) keeps its own menu |
| **One row of filters** | Every filter is a pill in a single row that scrolls sideways when it runs out of width — the **More** menu is gone, and so is the second line the row used to wrap onto. A pill carries its count only when there is one to carry, since *Content 0* is wider than *Content* and says the same thing |
| **Selection: pin and checking** | The selection toolbar carries **Pin/Unpin** and **Checking** beside Move, Tags, Open, Copy links and Delete. Pin reads the selection first, so a mixed set pins rather than flipping each row into the opposite of its neighbour; Checking offers the same three modes as the row's own `Shift + C`, applied to the whole selection with one toast at the end |
| **Undo on a bulk tag change** | Tagging or untagging twenty rows in one click can be taken back for eight seconds, from a snapshot of what each bookmark had. Applying the opposite change would have stripped a tag from rows that already carried it themselves |
| **The trend, out of the way** | The 90-day line no longer sits above the list. The tile row carries it as a sparkline with the current reading — costing no row of its own — and clicking it, or the ▲/▼ beside the percentage in the header, opens the full chart — 15rem tall, with 100/50/0 on the vertical axis and the first, middle and last date under it, plus its six series and per-day readout. On a narrow screen the old placement took the full width and pushed the work below the fold |
| **Rot report** | A button in the toolbar: what has gone, what has moved or been rewritten, what has been failing for over a month, what is broken and was never opened, and what broke this week — each with the rows behind it. The view is a work queue; this is the once-a-month read |
| **Follow redirects in bulk** | Select rows and **Follow redirects** asks each one where it now goes, lists the answers, and applies them after one confirmation. A domain move breaks twenty bookmarks with the same redirect; fixing them one menu at a time was the work this removes. The server still pings each replacement before storing it, so a row that still fails is reported as such |
| **Use the last archived copy** | **Find in Web Archive** opens the calendar of captures. The entry under it asks the archive for the closest capture, says when it was taken, and offers to point the bookmark at it — the original address is appended to the note, so nothing is lost. Decline and the capture opens in a tab anyway |
| **Rows you have acted on stay put** | Opening a row under **Unused**, or re-checking one under **Broken**, takes it out of what the filter selects — and removing it closes the gap and moves everything below it up by one, mid-task. The row keeps its position instead, dimmed and marked **handled**, until you change the filter, sort or search, or reload the report with **R** or **Retest all** (**v1.2.1**) |
| **Tiles and filters agree** | A bookmark can be several things at once, and the tiles count every condition that holds — so one that is both a duplicate and never opened is counted by **both** and appears under **either** filter. Until **v2026.09.06.1** the filters matched on the row's single worst problem instead, so a tile could report *2* and then list nothing when you clicked it. The row itself still shows only its worst problem, which is what decides its colour and its place in the list |
| **What the filter selects** | A sentence under the toolbar states the rule behind whichever filter is active, in words rather than as a tooltip you have to find. It appears on an empty filter too — that is exactly when *what was being looked for* is the only useful thing left to say (**v2026.09.06.1**) |
| **How this works (`ℹ`)** | The **ℹ** at the end of the toolbar opens a short explanation of the numbers: how the score is charged, why one bookmark can be counted by several tiles, how current the cached figures are, why an uptime percentage carries its check count, why the all-monitors panel pools checks, and how the trend line treats days you were away |
| **Report age** | The report is built on the server and cached for a few minutes, so the header says how old it is — a headline count read as live when it was not. Under a minute reads *just now* rather than *0m*. **Retest all** rebuilds it (**v2026.09.06.1**) |
| **Health over time** | Once you have opened this view on more than one day, a chart beside the text explaining the filter draws the share of healthy bookmarks as a line, with an arrow beside the percentage in the header naming the movement across the window (*up 12 points over 30 days*). **Point at a day** to read out its date and the share healthy on it; a day with no reading says so rather than showing 0%. Drawn on a **fixed 0–100 scale** marked at 100%, so a collection sitting between 91% and 93% looks as flat as it is. One point is kept per day for **90 days** in `data/health-trend.json`, and days you did not open the dashboard leave a **gap** rather than a straight line through them. Nothing appears until there are two days to compare (**v2026.09.06.1**); moved out of the header, given the hover readout and its own `ℹ` in **v1.0.1** |
| **Availability menu** | `c` on a row, or a click on its mode badge, opens a short menu: the three modes, the **Check interval** strip on a monitored row, and **Expected response** — which opens the settings in the row itself rather than in the popover. They lived in the menu until **v2026.09.09.1**, where they had grown into a form: five of its controls sat below a scrollbar, Save among them, so it was possible to fill the fields in with no visible way to store them. In the row they get its full width, the keyword and status boxes sit side by side, and `Esc` or **Cancel** closes the panel |
| **Expected response** | A monitored row can say what a *good* answer looks like, not just that one arrived. Open the availability popover, choose **Expected response**, and the row expands into a panel where you set **Text the page must contain** — a phrase that only shows when the page works — or tick **Fail if present instead** to catch an error banner. **Status codes that count as healthy** narrows the default rule (anything under 500) to codes you name: `200`, `200-299`, `200,301,401`. A code nextDash cannot parse is dropped rather than obeyed, so a typo cannot take a working bookmark down. Clearing both fields also clears the failure they caused |
| **A failure records why** | A failed check stores its cause — DNS, timeout, refused, TLS, content, HTTP — alongside the sample. The engine always worked this out and then dropped it, so a network-level outage reached the incident list with a blank reason. Incidents now name the cause, and the history CSV carries a `reason` column |
| **A single miss does not count** | A failed check is tried once more, five seconds later, and only recorded as a failure if that fails too. One dropped packet used to write a permanent `down`: it dented the 24h/7d/30d uptime for as long as the sample lived, opened a one-check incident and coloured a heartbeat bucket. The alert retries were never the same thing — they held back the message, not the record |
| **Content tile & filter** | A page that answers 200 while showing *Database connection failed* is not broken in the ordinary sense — the host replied. Those failures get their own **Content** tile and filter, ranked next to Broken, and the row names the phrase or code it expected. A server that is down and a checkout button that vanished need different responses, so they are counted apart |
| **Certificates** | Every HTTPS check already completes a TLS handshake, so the expiry date is read from it — no extra request and nothing to switch on. Recorded from **every** check, not only the monitor sweep: periodic checks, a retest-all and a single on-demand check all contribute, so an install that never switched a bookmark to Monitor still gets warnings. A **Certificates** tile appears once something is close, and affected rows carry a badge with the days left. Warnings go out at **30, 7 and 3 days** through the same webhook and push notifications as downtime. Certificates belong to a *host*, so ten bookmarks on one domain all show the badge and one renewal clears them all |
| **The trend chart draws more than one line** | The trend file records nine counters a day for ninety days — healthy, score, broken, monitors down, monitored, unchecked, stale, unused, duplicate — and the chart drew one of them. A row of buttons above it switches between **Healthy %**, **Score**, **Broken**, **Monitors down**, **Stale** and **Unchecked**. Percentages keep the fixed 0–100 axis; counts get an axis scaled to the window |
| **A recovery says how long it was down** | "X is back online" now ends with *after 3h 12m*, worked out from the same history the failure count is read from. It was the one question a recovery message raised and could not answer |
| **Bulk mute** | Muting is per-bookmark alert policy and was the one health setting you most want to set on a group — twelve bookmarks behind one outage meant twelve dialogs. **Mute alerts** and **Unmute** sit in the health selection bar, and go through an endpoint that changes only the field it is given: muting does not clear the keyword checks or the drift baselines those bookmarks carry |
| **Check timeout** | Three seconds was hardcoded for every check in the app, so a self-hosted service that legitimately answers in four — a large Nextcloud, a container that just started — was permanently *Timeout*, which reads as offline. **config → behavior → status & health → Check timeout** offers 5, 10, 15 or 30 seconds; the server clamps to 2–30, and the connect budget stays two thirds of whatever you pick |
| **A window says what it could not cover** | History is capped per URL, so a five-minute monitor holds about a week rather than the full thirty days. The 30-day figure was still computed over what was there and labelled *30 days*; a window the samples cannot fill now reads **only 7d of history** instead of a check count |
| **Filters** | broken, **content**, duplicate, shortcut-conflict, stale, unchecked, unused, missing preview, healthy, **monitored**, **drift** — default **broken** on first visit, and your last filter and sort come back on the next one; a `?hv_filter=` deep link still overrides what was stored |
| **Filters that all fit** | The row wrapped onto a second line once every filter was a pill, so the less common ones lived behind a **More** menu — hidden even on windows wide enough to show them. They are all pills again now, in one row that scrolls sideways; see *One row of filters* above |
| **Monitored filter** | Offered as soon as there are bookmarks, not only once something is already monitored — it used to be invisible to anyone who had not already found the feature. An empty Monitored list explains what monitoring does and how to switch it on (`c` on a row) rather than reporting "no issues found" |
| **Export** | Downloads the **current filter and search** as CSV — name, URL, status, score, page, category, last checked, and the same issue wording the score panel shows. When the exported list holds monitored bookmarks it also carries **interval, the three uptime windows, last response time and total checks** — but only then, since otherwise they would be six empty columns on every line. Uptime is written as a plain number so a spreadsheet can average the column, and a window with no samples stays **blank** rather than becoming a `0` that reads as total downtime. For working through findings beside a spreadsheet, or handing someone the list. Values starting `=` `+` `-` `@` are prefixed so a spreadsheet treats them as text instead of formulas; a UTF-8 BOM keeps accented titles intact in Excel |
| **Export history** | Appears on the **Monitored** filter. Downloads the individual up/down checks behind an uptime percentage — one row per check, with its timestamp, whether the site was up, ping time and HTTP status. The ordinary Export gives you the current state of each bookmark; this gives you the record over time, for charting an outage or seeing when a site started getting slow. Same formula guard and BOM |
| **Bulk actions** | Tick the box on any row — or press **`x`** to tick the one under the cursor and move on, **`X`** or **`Ctrl/Cmd+A`** for everything the current filter shows; **`Ctrl`**+click and **`Shift`**+click work with the mouse. A bar appears above the list with **Set checking**, **Re-check**, **Open**, **Copy links**, **Delete** and **Clear selection** — deliberately the same bar, in the same place, that **Config → Bookmarks** has. Deletes go to the [trash](#trash-data--backups--trash) like any other, and a row that changed since the report was built is skipped and reported rather than deleted, so a list a few minutes old cannot remove the wrong bookmark. Ticks survive a filter change, so the bar names how many the current filter is hiding and offers **Select only these**. **`Esc`** clears the selection without leaving the view (**v2026.09.05.1**) |
| **Work through the list** | Filtering to **Broken** tells you what is wrong and then leaves every fix costing the same three moves: find the row again after the list re-renders, aim at its action, decide. **Work through** in the toolbar — or **`f`** — puts one row on screen at a time with its actions large and the rest of the page out of the way: **Re-check** (`p`), **Open** (`Enter`), **Delete** (`d`), **Skip** (`j`), and `k` to go back. It starts on the row your cursor is on rather than the top of the list, because the way in is usually *I am looking at this one*. `Esc` leaves and puts the cursor on the row you had reached, so dipping in for three fixes and back out is not a mode switch. It is the same list and the same actions throughout — nothing is available only here — and stepping past either end says so rather than quietly wrapping round to the start. A row deleted from the card drops out of the queue and the next one takes its place |
| **Accept drift** | A drift finding is a prompt, not a verdict: a rebrand, a docs reorganisation or a deliberate move to a new domain trips drift on **every** bookmark pointing at that site at once, and all of them are fine. Tick those rows and use **Accept drift** in the bulk bar — it appears only when the selection actually holds findings, and counts just those. Accepting does two things in one write: it clears the finding **and** drops the baseline the finding was measured against, so the next check records the page as it is today. Clearing only the finding would not work, because the stored baseline still describes the page as it was *before* the change and the identical drift would be reported again on the very next check. Note what accepting asserts: that the new page is the right one — a page that genuinely rotted would be marked healthy, which is why there is no *accept everything* and the rows are always ones you picked |
| **Silence one bookmark** | Alerting used to be all or nothing: a personal blog and a critical server shouted equally loudly, and the only way to quieten the first was to stop monitoring it — which also stopped recording it. Open the availability popover on a monitored row, choose **Expected response**, and tick **Do not alert me about this bookmark** in the panel that opens. It is still checked, its history still builds, and the row still reads as down when it is down, carrying a **Muted** badge so it can never be mistaken for one that should have raised the alarm and did not. Only the outgoing message is withheld. Un-muting during an outage still alerts — a muted failure does not quietly use up the one alert that outage was going to send |
| **Controls panel** | Search, status pills, sort, export, and retest action in one compact block |
| **Search** | Name, URL, category, page |
| **Edit** | Row Edit (or `Enter`) leaves the Health view, opens the bookmark’s page, and launches the dashboard **inline editor** (falls back to Config when unavailable) |
| **Favicon** | Shows stored bookmark icon; refresh per row |
| **Action toolbar** | Config-style buttons per row: open URL, dashboard deep link, re-check status, favicon, overflow (**Status** → re-check status; **detect redirect**, **refresh title**, **archive**, **copy URL**, **share**, delete) |
| **Copy URL and Share** | The **More** menu carries the same two entries as the dashboard's right-click menu. **Share** copies a dashboard deep link with `?hv_id=` so the recipient lands on the same row in Health, not the raw bookmark URL. The second reads **Share…** where your browser has a share sheet and **Copy name + URL** where it does not. Both apply to any row, healthy or broken |
| **Action runtime** | Row actions are guarded against overlap and refresh the health report after changes |
| **Detect redirect** | Overflow **detect redirect** uses a fast redirect-only suggest (`redirectOnly=1`, skips title fetch); confirm shows the proposed URL; errors and timeouts appear in the status bar |
| **Feed paging** | Long lists scroll with the page — no nested scrollbar. The first fifty filtered rows render immediately; scrolling loads more in batches of fifty. **Shift+G** jumps to the last filtered row (**v2026.07.26.3**) |
| **Panel head** | Below the **Health** title, a breadcrumb shows the active filter (e.g. `health › broken`) and a **% healthy** badge names how many bookmarks have no active issue — same placement as Config subpages (**v2026.08.08.4**) |
| **Keyboard** | `j`/`k` or arrows move focus; `Tab` steps one row at a time (not through every control) and releases at either end; `g`/`G` (or `Home`/`End`) first/last; `R` or `?` reload the cached report without retest-all; `Enter` or `Space` → open the URL; `s` → score breakdown; `p` → re-check; `f` → **work through** the list one row at a time; `x` → select (`X` or `Ctrl/Cmd+A` for everything the filter shows); `m` → more actions (arrows inside the menu, `Esc` back to the row); `c` → availability checking; `i` → enlarged monitoring statistics on a monitored row. The shortcut legend under the feed lists them, and the cheat sheet (`!`) carries the same set |
| **Background rechecks** | Optional server-side schedule under **Config → Behavior → Status & health**; keeps the Health view current without opening Retest all |
| **Emphasis on the dashboard** | How much a monitored bookmark stands out among the rest, under **Config → Behavior → Status & health**. **Only when there is a problem** (default) leaves a healthy monitor looking like any other bookmark and lets an outage draw the eye; **Always stand out** gives every monitored bookmark an accent edge, so you can see at a glance what you are watching; **Never stand out** keeps monitoring entirely in the health view and marks nothing on the dashboard, not even an outage. A monitored bookmark shows its status badge in all cases except Never |
| **Check mode per row** | Each row shows its current mode (**Off** / **Periodic** / **Monitor**) as a button. Click it, or press `c`, to change it — the list keeps its scroll position and filter, so a filtered list does not reshuffle while you work down it. Options carry their own letters: `o`, `p`, `m` |
| **Bulk enable** | On a **filtered** list, a button offers to switch the visible rows to Periodic or Monitor at once, confirming the exact count first. Never offered on the unfiltered **All** list, where it would point the scheduler at every bookmark you own |
| **Monitoring** | A monitored row shows a **heartbeat bar** of recent checks, **uptime** over 24h, and a response-time **sparkline**; the expanded panel adds **outage history** (start, duration, cause), or *down since* while it is still down. A **Monitored** filter narrows the list to these rows. Interval is 5 minutes to 24 hours (default 15); history is kept 30 days in `data/health-history.json`. The uptime figure is followed by **the number of checks behind it**, because *100%* from three checks is a much weaker claim than *100%* from three hundred |
| **All monitors together** | The **Monitored** filter opens with a panel covering the whole set, which no individual row can: **pooled uptime** over 24h / 7d / 30d, how many monitors are responding right now, and the average response time across all of them. Uptime here **counts individual checks** rather than averaging each monitor's percentage — otherwise a monitor with three recorded checks would weigh as heavily as one with three thousand. Below it, three lists: **Least available (7 days)** (anything failing now placed first; monitors at a clean 100% are left out, so a short list means little is wrong rather than that only five were examined), **Slower than last week** (the last day against the seven days before it, meaningful slowdowns only, the two windows never overlapping), and **Outages** — every recorded failure across the collection, newest first, each naming its bookmark, with the true total shown when the list is capped (**v2026.09.06.1**) |
| **Check interval per row** | Open the mode popover on a row that is **already monitoring** and a **Check interval** row sits under the three modes: 5m, 15m, 30m, 1h, 6h, 24h. This is the screen where you look at a heartbeat and conclude the cadence is wrong, so it no longer means a trip to the bookmark editor. Offered only on a monitored row — picking an interval elsewhere would be a second, hidden way of switching monitoring on. Choosing the interval a bookmark already has closes the popover without writing anything, and the interval also sets the time axis of that row's heartbeat (**v2026.09.06.1**) |
| **Enlarge statistics** | The row strip only has room for a 24h figure and one ping. The **⤢** button at the end of it — or `i` — opens the same monitoring data at full size: a large response-time chart with min / average / max marked and a tooltip per point, **uptime side by side for 24h / 7d / 30d** with the number of checks behind each, a taller heartbeat, the check interval and last check, and the full outage list. A window with no samples yet reads *no data* rather than 0%, so a monitor enabled an hour ago does not look like a day of downtime. Nothing is re-fetched — it is the report already on screen — so it opens instantly. `Esc` closes it and leaves your place in the list. The button only appears once there is something to show: a monitored bookmark still awaiting its first check does not get one |
| **Reading values off the chart** | The chart is interactive: click or hover anywhere in a measurement's slice of the plot — a full-height column, not just the dot — and the **readout under the chart** names that measurement: response time, the time it was measured, how many checks the point folds together, and whether it was up, down or degraded. It opens on the most recent measurement rather than empty. `←` / `→` walk point to point and update the readout as they go, skipping buckets with no measurement so you never land on an empty reading. The chart is a single `Tab` stop, so **Close** stays one `Tab` away, and tabbing back in returns to the point you were reading |
| **Downtime alerts** | Optional webhook under **Config → Behavior → Status & health**, posted when a monitored bookmark goes down and again when it recovers. Fires only after N consecutive failures (default 3, range 1–10) so a single hiccup stays quiet. Local addresses are refused unless **Allow local bookmarks** is on — the same SSRF rules as pings |
| **Notification presets** | Rather than hand-writing a webhook body, pick the service: **Slack**, **Discord**, **Telegram**, **Gotify**, **ntfy**, **Pushover**, or **Raw JSON** for anything else. Each shapes the message the way that service expects, and asks only for what it actually needs — Telegram for a **Chat ID** alongside the bot URL, Pushover for an **application token** and **user key** instead of a URL, since its endpoint is fixed. **Send test alert** posts one synthetic failure down the exact path a real one would take: a mistyped chat ID or a token in the wrong field otherwise fails silently, and the alert you find out about is the one that never arrived |
| **When many fail at once** | One upstream going down — a host, a reverse proxy, the network itself — takes every bookmark behind it down in the same sweep. Alerting per bookmark would post a dozen near-identical messages within a second, which is exactly the pattern Slack and Telegram rate-limit, so the alerts that mattered would be dropped by the service rather than delivered. Past a handful in one round they collapse into a single message naming the first few and counting the rest. Below that the individual messages are kept, because they name the bookmark and its error and are strictly more useful. A round mixing kinds — an outage and a recovery together — stays expanded for the same reason, and certificate warnings are never collapsed, since each names a different host |
| **Maintenance windows** | Recurring periods when downtime is expected — a nightly backup, a weekly reboot. Set them under **Config → Behavior → Status & health**: pick the days, a start and an end. Failures inside a window raise no alert and do not count against uptime, but the checks still run and the heartbeat still records what happened, so a real outage that began during maintenance is not hidden. A window whose end is before its start runs **past midnight**, which is when most maintenance happens; the row says so rather than leaving it looking like a typo. An incomplete window, or one whose start equals its end, is ignored and says so |
| **Browser notifications** | The same downtime and recovery alerts, delivered to your browser rather than to a webhook — so they arrive while nextDash is closed. Switch them on from the card on the dashboard or under **Config → Behavior → Status & health**, then allow notifications once per device. Backup results and new-release notices are available there too, off by default. **Requires HTTPS**: Safari refuses notifications on `http://localhost`, as does every browser on iPhone and iPad (all WebKit); desktop Chrome and Firefox do allow localhost. See [Browser notifications](#browser-notifications) |
| **Layout parity** | Uses the same **Classic / Modern** layout version and visual settings as the dashboard (preset, density, custom background, opacity, font weight, animations, auto dark mode); updates when you save in config |
| **Row action styling** | Per-row toolbar buttons and overflow menu match the active layout (rounded chips). The **More** menu is drawn as the same opaque panel as the dashboard's right-click menu — same surface, radius, spacing and shadow, and the same blurred edge under the Modern layout |
| **Right-click a row** | Opens that row's **More** menu at the cursor, the way right-clicking a bookmark does on the dashboard. It is the same menu the ⋯ button opens — a second way in, not a second set of actions — so it also answers `m`, arrow keys and `Esc`. **`Shift` + right-click** still gives you the browser's own menu |
| **dashboard link** | Jump to bookmark on correct page/category |
| **Re-check status** | Re-test a URL; failures show specific errors (e.g. HTTP 404, Timeout, DNS). The row updates immediately |
| **Bulk** | **Retest statuses** from the toolbar |
| **Retest scope** | Bookmarks only get status checks when **Check status** is on for them (off by default, set per bookmark in **Config → Bookmarks**). Retest used to skip everything else — including rows flagged **broken**, which this page can't switch on — so those could never be cleared here. Retest now also tests any bookmark with a recorded error, tells you plainly when there is nothing to test, and stops after 250 checks per run (each takes up to 3s; run it again to continue) |
| **Detect redirect result** | An applied redirect is checked against the new address before the row counts as healthy. If the replacement fails too, the row stays red with the reason instead of reporting a fix that was never verified |

Filter, sort, and search state persist in the session across refreshes and sync to the URL (`hv_filter`, `hv_sort`, `hv_q`, `hv_id`).

**A guided tour on first use.** The first time you open the Health view, a short six-step walkthrough introduces the monitoring features around one worked example — a self-hosted status page behind a login, backed up nightly — rather than listing settings in the abstract: turning on **Monitor** and picking an interval, saying what *up* means for that page with status codes `200,401` and a keyword check, watching for **drift**, excluding the nightly backup with a maintenance window, and wiring up an alert with **Alert after 3** and a test send. It appears once and then never again; `Esc`, the backdrop and **Skip** all count as having seen it. **Show quick-start card again**, under **Config → Behavior → General**, brings it back along with the inbox tour and the keyboard tips — the one-time hints attached to individual settings in config are left alone.

**URL deep links** — Open health view with query parameters:

| Parameter | Example | Effect |
|-----------|---------|--------|
| `hv_filter` | `/?hv_filter=broken#health` | Pre-select a filter pill |
| `hv_id` | `/?hv_id=1:4#health` | Open health and select row 4 on page 1 (shareable deep link) |
| `page` | `/?page=2#health` | Open health with a specific page context |
| `hv_sort` | `/?hv_sort=name#health` | Set sort order |
| `hv_q` | `/?hv_q=github#health` | Pre-fill search |
| `hv_refresh` | `/?hv_refresh=1#health` | Run retest-all on load |

From the dashboard, **`Shift+H`** opens the Health view directly. **`:health`** (command mode) opens it with optional filters (`broken`, `duplicate`, `stale`, …) or `refresh` to re-scan. **`:stale`** overflow rows link to `/?hv_filter=stale#health`.

The dashboard **health** icon (a heartbeat glyph styled like the inbox tab) shows a compact counter pill for broken links and warnings (including shortcut conflicts) — broken count takes priority over warnings, red for broken and amber for warnings, hidden when healthy. While you stay on bookmarks or Inbox, it refreshes about once a minute so a new outage surfaces without opening Health (**v2026.08.08.4**). When broken issues exist, the link opens `/?hv_filter=broken#health`. Keyboard entry is **`Shift+H`**. The config view's **Overview** links to the same place when something needs attention.

### Browser notifications

Downtime alerts delivered to the browser itself, so they arrive **while nextDash is closed**. The webhook above posts to a server, which only helps if something is listening for it; this reaches whatever device you allowed, including a phone.

**Turning it on.** A card appears on the dashboard a few seconds after load and offers to switch outage alerts on in one click. Or go to **Config → Behavior → Status & health → Browser notifications**, enable the master switch, then press **Enable on this device**. Either way the browser asks for permission, and a confirming test notification follows immediately so you can see it works.

Permission is granted **per browser**, so every device you want alerts on is asked once. The category switches themselves are server-side and shared across devices.

| What can notify | Default |
|---|---|
| **Downtime and recovery** — a monitored bookmark goes down, and again when it comes back. Follows the same retry threshold as the webhook, so a single hiccup stays quiet | On when you accept |
| **Automatic backups** — a scheduled backup succeeded or failed. Manual backups never notify; their result is already on screen | Off |
| **New release available** — announced once per version, when a newer nextDash starts. Read from the release notes shipped in the binary; nothing calls home | Off |

**Requirements.** Notifications need a **secure context**:

- **Safari (macOS, iPhone, iPad)** and **every browser on iPhone or iPad** — HTTPS only. They all use WebKit, which refuses on `http://localhost`, so a local-only setup cannot use this in those browsers. A hostname with a real certificate (a reverse proxy, or Tailscale's HTTPS) works.
- **Chrome, Edge and Firefox on desktop** — HTTPS, or `http://localhost` for local testing.
- On **iPhone and iPad**, add nextDash to the home screen first.

**Declining and changing your mind.** *No thanks* is remembered and the card does not return; **×** only postpones it. If you decline and later reconsider, **Show the invitation again** in the same config panel brings it back to the dashboard.

**Where the data lives.** Subscriptions and the server's signing key are in `data/push-subscriptions.json`. Deleting that file unregisters every device — they simply opt in again. A subscription the browser has discarded is dropped automatically the first time a notification bounces.

### Stats (`config#stats`)

Read-only analytics (desktop). Filter toolbar sits above a fused **split surface**: chip navigation and sidebar index share the left column; stats blocks fill the content pane — same split-shell pattern as Help. Sidebar index jumps to sections; on phone, horizontal **chip-nav** replaces the sidebar. Content stays on the Stats tab only — it does not overlay other config tabs.

- **Insights** — automated highlights (busiest page, top bookmark, never-opened share, status coverage, recent activity) with links to sections.
- **Overview & activity** — bookmark totals, period filters (7 / 30 / 90 days / all time), sparklines, and **week-over-week** active-bookmark comparison when the **week** period is selected. Open counts describe **lifetime** `openCount` for bookmarks active in the selected period (labels update when a period is active).
- **Top bookmarks, pages, categories, shortcuts** — sortable tables; click a bookmark row (or press `Enter`) to open it in **Config → Bookmarks**.
- **Finders** — finder totals and top-20 table by `useCount`.
- **Inbox** — current inbox health (total / unread, oldest unread age, unread > 30d backlog, tags / notes / previews) plus **lifetime triage throughput**: items added, converted to bookmarks, discarded, average time to triage, a conversion coverage bar, an added-vs-triaged trend sparkline (7 / 30 / 90 days), and source / top-domain tables. Lifetime counters are kept in `data/inbox-stats.json` and start from when tracking began (older activity isn't included).
- **Tags** — coverage, most-used tag, untagged count, per-tag tables.
- **Where your usage sits** (Content, **v2026.07.25.2**) — the share of all your opens that the busiest ten bookmarks account for. A high share means the collection is broad but the habit is narrow.
- **Opens per bookmark, by category** (Content, **v2026.07.25.2**) — usage divided by category size, sorted by that ratio. The neighbouring "bookmarks per category" panel measures size; this one shows whether a category earns its place. A low figure on a large category is one you built but do not use. Both panels count categories **per page** (**v2026.09.2**): a category is a name *on a page*, so the same name used on two pages is two categories, as the **Categories** figure has always counted them. Before this they were merged into one row whose ratio averaged both, which could report five opens per bookmark for a category used ten times on one page and never on another. When a name is in use on more than one page, the page name is shown alongside it to tell them apart.
- **Cleanup candidates** (Content, **v2026.07.25.2**) — never opened, opened once and never again, untagged, still on plain `http`, and without an icon. **Show** opens the matching bookmarks in **Config → Bookmarks** with that filter applied, where the bulk toolbar can tag or delete them. A banner names the active filter and **Show all bookmarks** clears it. Rows with a count of zero are left out.
- **Rot & cleanup** — stale bookmarks, cleanup score (resets when the library is empty).
- **Conflicts** — duplicate URL detail list and shortcut conflicts with a link to **Health**.
- **Toolbar** — **Filter tables** search (narrows rows across all stats tables with a visible/total hint), **Expand all** / **Collapse all sections** (same as General; **v2026.07.09**), **Refresh** (reloads stats in-tab), and **Export CSV** (downloads multiple sections; respects active period filters) live in the in-surface toolbar (**v2026.07.01.1** moved Refresh/Export from the intro row).
- **Section state** — Stats sections start collapsed and remember which ones you expand across visits.
- **Overview** — includes **Last backup** (formatted date from the backups tab when a ZIP was created in this browser).

---

## 16. ⚙️ Config — complete walkthrough

Configuration is a **view inside the dashboard**, not a separate page. It opens in place — same tab, same session, no page load.

| To open | To leave |
|---------|----------|
| **`Shift+S`**, **`<`** (`Shift+,`), the **config** (gear) link in the header, or the `/#config` address | **`Escape`** (unless you are typing in a field, or something is open on top of it), or the back link |

Reopening config (**`Shift+S`**, **`<`**, the gear link, or `/#config`) restores the **last section and sub-tab** for 5 minutes after you left, unless a `/#config/…` deep link names something else.

Pick a section from the rail on the left, or link straight to one with `/#config/<section>`. Sections that have sub-tabs extend that: `/#config/appearance/layout` opens Appearance on Layout, `/#config/bookmarks/<pageId>` scopes Bookmarks to one page, and the address bar keeps up as you click.

While config, health, or inbox is open, the **large dashboard title** shows only the view name (for example **Health** or **Config**). The active sub-context — `config › bookmarks`, `health › broken`, or `inbox › unread` — appears as a breadcrumb **under the section title inside the panel**, matching Config subpages (**v2026.08.08.4**).

Below **Help**, separated by a gap, **Find settings** opens the settings-jump overlay (`Ctrl/Cmd+Shift+K`) — the same search that jumps to any section, sub-tab, help topic, or setting. Since **v2026.09.07** every setting is searchable from the moment config opens, whether or not you have been to its tab, and settings also answer to related words that do not appear in their label: *uptime*, *wallpaper*, *telemetry* and *hotkey* each find the right one.

### The eight sections

| Section | What lives there |
|---------|------------------|
| **Overview** | Six headline tiles (including **Monitored**), anything needing attention, a **New features** carousel, **Latest update**, optional **GitHub update check** (since **v2026.08.04**), tips, and about-the-developer panels |
| **Pages & tags** | Categories, tags, pages, finders, and custom collections — five sub-tabs (**Categories** opens first since **v2026.08.06**) |
| **Bookmarks** | The bookmark list and its editor, with bulk actions and a page filter (`/#config/bookmarks/<pageId>`) — two sub-tabs since **v1.1.0** |
| **Appearance** | Theme, layout, display, and custom themes — four sub-tabs |
| **Behavior** | General, date & weather, search, status, and privacy — five sub-tabs |
| **Data & backups** | Backup, restore, import, export — plus **Reset** on its own tab |
| **Statistics** | Usage insights across five sub-tabs |
| **Help** | In-app documentation (EN/NL/DE/FR) across seven sub-tabs |

### Saving

**Most settings save the moment you change them.** Tick a checkbox, pick from a dropdown, drag a slider — it is written and confirmed with a short *Saved* message. There is no save button to hunt for and nothing to lose by navigating away.

The **bookmark editor is the exception**: it collects your edits and writes them when you press **Save**, so a half-finished row is never persisted. It tells you when it has unsaved changes and asks before you discard them.

Config only writes what actually changed — editing one setting does not re-upload every page of bookmarks.

### Sub-tabs

Six sections divide their content further. Every strip is a proper tab widget: **`←`/`→`** move between tabs and wrap around at the ends, **`Home`**/**`End`** jump to first and last, and the strip is a single stop in the page's tab order rather than one stop per tab.

| Section | Sub-tabs |
|---------|----------|
| **Pages & tags** | Categories · Tags · Pages · Finders · Collections |
| **Bookmarks** | List · Settings (**v1.1.0**) |
| **Appearance** | Theme · Layout · Display · Toolbar & tabs · Custom themes |

**Branding** — page title and favicon — is the tail of **Display** rather than a tab of its own; `/#config/appearance/branding` still lands on it. Each tab has a **filter** beside *Only changed*, and `Escape` clears it. The theme list answers to **typing**: open it and type the first letters of a name to jump to it among a hundred and fifty. Pointing at a **type size** shows it on the dashboard behind config and moving away puts it back — the same idea as browsing the theme list, which previews its colours. A custom theme has **⤓ Export** on its row and **Import theme…** beside *Add custom theme*, so one palette can move between installs without a whole backup.
| **Behavior** | General · Date & weather · Search · Inbox · Status & health · Privacy |

Every Behavior tab has a **filter field** beside *Only changed*: it narrows the tab to the settings whose label, hint or options match what you type, and `Escape` clears it. That is the other half of `Ctrl/Cmd+Shift+K`, which finds one setting anywhere; this one narrows the eighty-odd in front of you. **Keep settings on this device only** lives here, in *Sync & feedback*, and only here — it used to be offered on Data & backups as well, where it was the copy that worked.
| **Data & backups** | Backups & data · Icons & previews · Server log · Trash · Reset |
| **Statistics** | Overview · Activity · Content · Inbox · Health |
| **Help** | Getting started · Tips · Configuring · Pages & bookmarks · Search & keyboard · Health · Monitoring · Inbox · Statistics · Data & hosting |
| **About** | No sub-tabs — the wordmark, what nextDash is, the release notes, and where it comes from |

**Statistics** can be narrowed to **one page**: a *Showing* selector beside the sub-tabs, offered as soon as there is more than one page. Everything worked out on this side narrows with it — counts, coverage, activity, the cleanup score. Two things cannot: the **inbox**, which belongs to no page, and the **health report**, which the server builds for the whole collection. Both say so on screen rather than quietly ignoring the choice, and the export records which scope produced it. The filter is deliberately not remembered between visits — it hides most of the library, and a filter still in force from last week reads as a shrunken collection rather than as a choice.

**Health** opens with the **healthy share over time**, drawn from the day-per-day series the server already records for the health view — on a fixed 0–100 axis, with a gap where a day was never recorded, and the change in words beside it (*up 12 points over 30 recorded days*). Below a couple of recorded days it says what it is waiting for instead.

**Statistics** ends with the time the figures were worked out and two controls beside it, on every sub-tab: **Refresh** — the numbers come from what is in memory, so a tab left open goes stale while the stamp above it keeps its old time — and **Export as CSV**, which carries every sub-tab's figures including the two that come from the server, so visit **Inbox** and **Health** before exporting if you want theirs in the file. Duplicate URLs are counted the way the health view counts them: a trailing slash, a `#fragment` and a differently-cased host are the same link, not three.

**Help** carries the guide, and three things worth knowing about it. **Tips** is the whole catalogue of keyboard tips, grouped by what you are doing — the same list the dashboard draws its rotating tip from. Every panel has a **🔗** beside its heading that copies a link straight to that topic (`/#config/help/monitoring/health-cert`), which opens the right tab and lights the panel up on arrival. And where a panel describes something that can be switched off — the inbox, availability checking, alerts, analytics — a line under the heading says whether it is on **for you**, with a button to the setting.

The search box above the tabs covers every tab **and** the About section, so a word that appears only there is still found; each result says where it came from and takes you there.

**About** — a section of its own at the foot of the rail, `/#config/about`. It was a tab of Help, which is where you look for *how something works*, not for what this thing is or who wrote it. It carries the nextDash wordmark and the three addresses worth having: **[nextdash.cc](https://nextdash.cc)** for the project itself, **[GitHub](https://github.com/jordibrouwer/nextDash)** for issues, requests and release notes, and **[jordibrw.nl](https://jordibrw.nl)** for the person who writes it. The release notes are not repeated here: **Show what's new** sits in **Help → Getting started** and beside the onboarding switches in **Behavior → General**.

### Working with bookmarks

**Bookmarks** lists every bookmark with a **debounced search** field (matches name, URL, category, note, shortcut, and tags), **filter chips** for page, category, tag, and search text, and a **page filter**. With **All pages**, category labels read `Page · Category` and each row carries a page badge; click a page or category on a row to filter. Pick one page to scope categories and share the view as `/#config/bookmarks/<pageId>`. **Summary tiles** above the list follow active filters when any are set. Rows load **50 at a time** as you scroll. Sort includes last opened, most opened, and pinned first. Rows use the same Health/Inbox action bar; **Edit** opens the prefilled add-bookmark modal with name, URL, page, category, tags, shortcut, note, pinned, icon, and availability checking (Off / Periodic / Monitor, with an interval for Monitor). Press **`o`** or double-click a row to open the URL.

Its **settings** — what a quick-added bookmark starts with, the sort the list opens on, how many rows load at a time, and the rest — are on the **Settings** sub-tab (**v1.1.0**). They used to sit under the list, fifty rows down and further as the infinite scroll loaded more, which also ruled out jumping to the bottom: the bottom moved as you approached it.

**+ Bookmark** opens the same add form the dashboard uses. Tick several rows for the bulk toolbar — move to another page or category, pin, **refresh favicons**, **export CSV**, edit tags across the selection, or delete. **Select all** applies to the rows your filters are currently showing, not the whole library.

### Appearance

**Theme** covers your saved theme, **Random theme**, background (none / gradient / image / auto, with opacity), fonts, and branding. Pick a built-in dark/light family or a custom theme, then optionally set **Random theme** to **Off**, **On page refresh**, or **On view change** (includes dashboard page switches since **v2026.07.26.2**) — see [Themes](#themes) above for how the pool and auto dark mode interact. A **Currently showing** line appears while random is active; picking another theme while random is on saves your choice and shows a toast that rotation continues until random is off (**v2026.07.26.3**). On desktop, the first visit to this tab may show a one-time themed popover below **Random theme** (**v2026.07.26.1**); dismiss it with **Got it** or **Esc** (the button does not float with the card).

**Layout** holds layout version (Classic / Modern), launcher icon size, column count, layout preset, and density.

**Display** holds bookmark-row toggles — icons, status colour, animations, shortcut letters, ping times, link preview cards.

**Toolbar & tabs** holds the visibility of everything in the dashboard chrome. Since **v2026.09.07** it is three groups matching how the dashboard is built — **Header** (page tabs, page names, title, and the health and config icons), **Button bar — main buttons** (add, search, commands, finders) and **Button bar — extras** (recent, cheat sheet, fold-all, tag cloud) — so the group a setting sits in tells you where on screen to look. Each group has **Show all** / **Hide all** with a count of what is currently showing. Hiding a button leaves its keyboard shortcut working.

**Branding** holds the custom page title and favicon.

**Custom themes** is a full editor: build a palette, check its contrast, and apply it. Changes preview live on the dashboard behind the config view; leaving the tab drops an unsaved preview rather than leaving the dashboard in a half-edited state.

Many controls carry an **ℹ** button explaining what the setting does, and a **↺** to put it back to its default.

### What you have changed (v2026.09.07)

Config can tell you how far the install has drifted from a stock one, which is the quickest answer to *why does my dashboard behave differently from this manual*:

- **Overview → At a glance** carries a line — *N settings differ from the default* — naming the sections involved and linking to the tab that holds the most of them. On an untouched install the line is absent rather than reading zero.
- **Only changed**, above each tab of settings, hides everything still on its default and says how many differ before you press it. It is not remembered between visits.
- **Reset panel**, beside a panel's title, puts that whole group back at once instead of one **↺** at a time. It appears only when something in the group has been changed, and asks first.

### Server log (Data & backups → Server log)

What the server has been doing, without shell access to the container. Every line the server writes — background jobs, imports, health checks, and one line per API request — is captured as it is written and shown here. Nothing changes about the container log: the same lines still go to stderr, so `docker logs` is unaffected.

- **Collect server log** — **off by default**, and the switch that starts and stops collecting. While it is off nothing is captured, no file is written, and the log costs the server nothing at all; turning it off keeps whatever has already been collected rather than clearing it. Switch it on when you want to watch something, off again when you are done.
- **Refresh** — **Off** by default, or every **2 / 5 / 15 / 30 seconds**. Off means no polling at all; a poll only asks for the lines that arrived since the last one, so leaving it on 2s is cheap. The interval stops the moment you leave the tab or close Config.
- **Limit the log** — by **age** or by **number of entries**, never both. Whichever you pick, the other control is greyed out, because a log capped two ways drops lines for a reason neither setting explains on its own.
  - **By age** → **Keep entries for** 1, 2, 4, 12 or 24 hours, 7 or 30 days, or **Until cleared**. Older lines drop away on their own; how many there are does not matter.
  - **By number of entries** → **Keep at most** 100, 500, 1000, 2500 or 5000. Only the newest that many are kept and older ones fall off as new lines arrive; how old they are does not matter.
- **Show** — everything, warnings and errors, errors only, or **Activity only** (**v1.1.1**). The last one is not a severity but a source: activity lines are what *was done* — a bookmark saved, a page added, a check run — and they have always been written into this same log, findable only by knowing to search for the word. **Search** filters on the message and on the subsystem name. All of it is applied by the server, so it covers the whole buffer rather than what is on screen.
- **Scroll to newest lines** — follows the tail, and stops following while you are scrolled up reading something.
- **Copy**, **Download** — the current lines to the clipboard, or the whole buffer as a `.log` file.
- **Clear log** — empties the buffer **and** deletes `server.log` and its rotated copies from the data directory. It asks first, and cannot be undone.

Severity is inferred rather than declared: a request line takes its level from the HTTP status (5xx is an error, 4xx a warning), and other lines from their wording. Lines are held in memory — the most recent **2000** when limiting by age, or however many you chose when limiting by count — and mirrored to `server.log` in the data directory, capped at **2MB** with two rotated copies, so the history survives a restart.

> Anyone who can open Config can read this log, including full webhook URLs where those were logged. If your instance is reachable by people who should not see that, clear the log or keep retention short.

### Trash (Data & backups → Trash)

Deleting is not final. Deleted **bookmarks, pages and categories** go to the trash and stay there for **30 days**, then go for good. The toast's undo is for the moment right after; the trash is for the next morning — and the next morning you are on the dashboard, so **`:trash`** opens it from there. It was reachable only by mouse before: no command, no shortcut, and `trash` was not in the config-section list either, so even `:config trash` missed.

- **Search** — filters the list by name, URL, tag, category or the page it came from (**v1.0.2**). The count beside it says how many of the total are showing.
- **Restore** — puts the bookmark back on its own page, at the position it had. If the page has shrunk since, it lands at the end rather than failing.
- **Restore selected** — tick several rows and bring them all back at once (**v1.0.2**), which is the answer to a bulk delete of twenty. Each is restored on its own, so one that cannot come back (its page is gone) does not stop the rest; the toast says how many did and how many stayed.
- **Select all** — ticks what the search is showing, not the whole trash, so a search narrows what "all" means.
- **Delete forever** — removes one entry ahead of the 30 days.
- **Empty trash** — clears everything at once. Both ask first.

Each entry names the page it came from and when it was deleted. This covers **every** route out of the library — the dashboard, the [health view](#health-view-health), and **Config → Bookmarks** — singly or as a [bulk delete](#94-selecting-several-bookmarks) of twenty rows at once, all twenty recoverable individually. The trash holds at most 500 entries; past that the oldest drop out early.

**A deleted page is kept as one entry**, not one per bookmark (**v2026.09.06**). It is listed as *Page · 12 bookmarks*, so the size of the restore is visible before you click, and restoring brings the page, its categories and its bookmarks back together in a single action — at its original place in the tab strip. That matters because a page's identity is what its bookmarks point at: a page restored as a fresh copy would look right and be referenced by nothing. Deleting a **category** is recorded the same way; its bookmarks were never removed, so restoring only puts the category definition back at the position it held.

Both deletes also offer **Undo** in the toast for eight seconds — the net for the misclick, where the trash is the net for the delete you notice the next morning.

A restore that cannot go ahead is **refused rather than forced**, and the item stays in the trash so a failed restore is never a second deletion:

- **The page is gone** (restoring a bookmark or a category) — recreate the page, or restore it from the trash if it is still there, then restore the item.
- **The page's old slot has been taken** by a different page since — it cannot be restored without replacing that live page, so nextDash refuses and says so.

### Reset (Data & backups → Reset)

The destructive actions sit on their own sub-tab so they are not something you scroll past while changing backup settings.

**Automatic backups** run **weekly** by default, and **How often** on the same panel offers daily, weekly, fortnightly or monthly. Only the **newest three** are kept: a fourth pushes the oldest out, and so does the copy taken before a restore, which the panel says beside the list. `NEXTDASH_AUTO_BACKUP_KEEP` raises that count (1–50), and `NEXTDASH_AUTO_BACKUP_DIR` (absolute path) moves the archives off the data directory altogether — backups kept inside the thing they back up are lost with it.

Each stored backup lists **what is in it** — *1.7 MB · 412 bookmarks on 5 pages* — and the exact moment it was made is in the tooltip on its relative time, for when three of them are from the same day. **Download all** saves the lot one file at a time.

**Restoring or importing writes a backup of the current data first**, on the server, before anything is replaced. It is taken after the archive has been read and found valid, so a corrupt file does not spend a rotation slot; if the copy cannot be written the restore still goes ahead and says so in the server log, because being unable to move forward *or* back is worse.

- **Delete all bookmarks only** — removes every bookmark, keeps pages, categories, and settings. Asks once.
- **Reset all data** — removes everything. Asks twice: a confirmation, then you type **RESET** (or the word in your language) before the button becomes clickable.

Back up first — neither can be undone.

### ⌨️ Config navigation keys

Config has its own keyboard layer — dashboard grid shortcuts do not run while config is open. Press **`!`** or **`F1`** for the cheat sheet; the **Config view** group lists every binding below.

| Keys | Action |
|------|--------|
| `Shift+S` or `<` | Toggle config; reopening within 5 minutes restores the last section and sub-tab, however you left |
| `0`–`9` | Leave config for Inbox (`0`) or a bookmark page (`1`–`9`); clears stored config location |
| `j` / `k` | Previous / next section in the left rail |
| `g` / `G` | First / last section |
| `←` / `→` or `↑` / `↓` (section rail) | Move between sections when the rail is focused |
| `Home` / `End` (section rail) | Jump to first / last section |
| `Alt + ←` / `→` or `[` / `]` | Previous / next sub-tab |
| `←` / `→` (sub-tabs) | Move between sub-tabs when a sub-tab strip is focused |
| `↑` / `↓` (Pages & tags lists) | Move between rows when focus is in the list panel |
| `Enter` / `Space` (list row) | Focus the first field in the selected list row |
| `g` / `G` (list row) | Jump to first / last row in a Pages & tags list |
| `/` (Tags tab) | Focus the tag filter |
| `j` / `k` (Bookmarks list) | Move between bookmark rows |
| `Enter` / `o` / double-click (bookmark row) | Open the bookmark URL |
| `e` (bookmark row) | Open the bookmark editor modal |
| `m` / `c` (bookmark row) | Open the More menu / checking mode menu |
| `/` (Bookmarks) | Focus the bookmark search field |
| `←` / `→` (choice row) | Move between options; `Space` selects |
| `Home` / `End` (slider) | Jump to min or max on a focused slider |
| `Ctrl/Cmd + Shift + K` | Find a setting, section, or help topic (settings jump) — every setting is indexed, not only the tabs you have opened — or click **Find settings** below Help in the left nav |
| `Escape` | Close bookmark modal → clear list selection → exit config |

Inline hints at the bottom of form sections and under list tabs summarise the keys for that panel — press **`Shift+K`** in a legend to open settings jump. Since **v2026.08.09.1** these read the same way as the legends under **Inbox**, **Health** and **Config → Bookmarks**: each key is a chip beside the action it performs, rather than one sentence with the keys buried in it. **Help → Search & keyboard → Config navigation** repeats this in prose. The first config open on desktop may show a one-time intro toast pointing at **`!`** for the full cheat sheet (**v2026.08.01**).

Shortcuts do not fire while focus is in an input, textarea, select, or contenteditable field, except where noted (for example list keys from the tag filter or bookmark search).

`Escape` closes one layer at a time. With a modal open over config — the add-bookmark form, for example — the first press closes the modal and leaves you in config; a second press closes config. The same applies to search overlays and inline edit on the dashboard underneath.

Closing config leaves the **dashboard underneath untouched**: an active tag filter stays applied when you return.

---

## 17. 📦 Import, export, and backup

### 🗜️ ZIP backup (full instance)

**config → data & backups → Backup** — ZIP, settings export, and CSV sections appear as divided rows inside one fused surface card on all layout versions.

Includes pages, bookmarks (with tags), categories, **finders** (`finders.json`), settings, custom themes (`colors.json`), **uptime monitoring history** (`health-history.json`), uploaded dashboard favicon/font, and bookmark icon files under `data/icons/`. Legacy icon files that lived directly in `data/` are exported as `icons/<filename>` so bookmark references survive a full round-trip.

Monitoring history is the one piece of health data that is **measured** rather than derived, so it is the one that is archived: without it a restore resets every monitored bookmark to *waiting for its first check* — no response-time chart, no uptime windows, no outage list — and a 30-day figure takes 30 days to earn back. The **preview cache** and **health cache** are deliberately left out and cleared on import: a scan rebuilds those in minutes.

**Push subscriptions** (`push-subscriptions.json`) are also left out. A subscription belongs to one browser on one device and cannot be handed to another install — restoring someone else's would be a set of dead endpoints. Devices opt in again from the config panel, which takes a click each.

The panel shows **Last backup: …** after you create a ZIP (stored locally in the browser).

**Import ZIP** replaces **all** current data. **Always backup first.**

Do not rename files inside the ZIP.

Import is **atomic**: files are staged, orphan icons and stale JSON are removed, then everything is committed in one step. If the ZIP **omits** `finders.json`, your **existing finders are preserved** (not deleted as orphans). The same applies to `health-history.json`: every ZIP written before monitoring history was archived omits it, and treating that absence as a deletion would throw away measurements the archive never carried.

History for bookmarks that the imported data no longer monitors is **not** removed by the import itself; the monitor scheduler sweeps those orphans on its next tick (within a minute), so the file settles on its own.

Bookmark URL validation during import uses **`allowLocalBookmarks` from the imported `settings.json`** when that file is in the ZIP (read **before** bookmarks — not the server’s current setting).

Bookmarks with **invalid URLs** (wrong scheme, or private/loopback hosts when localhost bookmarks are disabled) are **skipped** during import; the UI shows how many were skipped alongside new and conflict counts. Icon filenames in imported JSON are sanitized.

### Automatic backups

**config → data & backups → Automatic backups** — nextDash automatically creates a full ZIP backup (the same contents as a manual ZIP backup) **once a week** and stores it **on the server**, under `data/auto-backups/`. This is separate from the browser download above: automatic backups live with your instance so they survive even if you never click *Create backup*.

- **Rotation** — the latest **3** automatic backups are kept. When a new one is written, the **oldest is removed** automatically, so the folder never grows without bound.
- **Download / Restore / Delete** — each stored backup lists its **date** and **size** with three actions: **Download** (saves the ZIP to your computer), **Restore** (replaces **all** current data with that backup after a confirmation, then reloads — the same effect as importing the ZIP, without the download/upload round-trip), and **Delete** (removes it from the server after a confirmation).
- **Back Up Now** — creates an automatic backup on demand at any time, without waiting for the weekly run. It works even when the weekly toggle is off, and refreshes the **Last backup** date shown in the ZIP section.
- **Totals** — a small summary line shows how many automatic backups you have and their combined size.
- **Countdown** — the section shows how long until the next scheduled backup.
- **A failed run says so** — the outcome of the last scheduled attempt is recorded and shown on the **Last backup** tile, which turns red and names the error. Until now a failing run only wrote a log line and, if Web Push happened to be configured, sent a push: a full disk or a wrong `NEXTDASH_AUTO_BACKUP_DIR` could stop backups for months while the panel looked normal, because the newest file's date does not move when a run fails.
- **Enable / disable** — a toggle (on by default) controls the **weekly** run. Turning it off stops new automatic backups but never touches **Back Up Now** or your existing files.

Filenames carry a UTC timestamp; if you create several backups within the same second, later ones get a `-2`, `-3`, … suffix so none overwrite each other. Like a manual **Import ZIP**, a restore is atomic and replaces everything — bookmark URL validation and skipped-URL handling work the same way.

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

### CSV export and import

All bookmarks: localized column headers — Name, URL, Category (display name), Page, Shortcut, **Tags**, **Notes** — for Excel/Sheets.

**Import bookmarks (CSV)** reads the same file back onto the current page (**v1.0.2**), so you can tidy hundreds of rows in a spreadsheet — bulk-fixing categories, adding tags — and return the result. Quoted commas, doubled quotes and line breaks inside a field are handled, and columns are matched by header name, so reordering them is fine. Rows without a URL are skipped, and existing URLs are skipped as duplicates, exactly as the browser import does. Unlike the browser-HTML import, this route carries **tags and notes**.

### When to use which

| Scenario | Tool |
|----------|------|
| Disaster recovery / migration | ZIP |
| Share list with spreadsheet users | CSV |
| One-time migration from browser | HTML import |
| Daily new links | Quick-add, extension, modal |

---

## 18. 🔌 Browser extension

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

### Without opening the popup

Two routes exist to skip the popup entirely, and until now both could only make a bookmark on a page:

- **Right-click** — *Save page / Save link to nextDash* files a bookmark; **Save page / Save link to nextDash Inbox** puts it in the inbox instead. Right-clicking a link is the most common capture gesture there is, and it was the one that could not reach the inbox.
- **Keyboard** — `Ctrl/Cmd+Shift+Y` saves the tab as a bookmark, `Ctrl/Cmd+Shift+U` saves it to the inbox. Both use the badge on the icon to report: **+** saved, **D** already there, **?** no server configured, **!** failed.

Tags sent with an inbox capture are now stored too — the server has accepted them for a while and the extension dropped them silently.  
- **409** when the shortcut is already used on that page.  
- After save: **Open in nextDash** or **Open Inbox in nextDash**.

If a dashboard tab is open on the same server, it may toast and refresh.

### Write token & CORS

- If the server sets `NEXTDASH_WRITE_TOKEN`, paste the same value in extension **Settings → Write token**.  
- If you set `NEXTDASH_CORS_ORIGINS` on the server, add your extension ID (`chrome-extension://…`) to the allowlist or cross-origin saves will fail.

See `extension/README.md` for development notes.

---

## 19. 📱 Mobile, PWA, and touch

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
| **Page tabs in header** | Scrollable tab strip with scroll-snap; active tab auto-scrolls into view; on **Modern** layout many tabs scroll inside the header without widening the page (**v2026.07.26.1**); `← →` swipe hint on multi-page dashboards | Tab strip + keys `1`–`9` |
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

## 20. 🚀 Efficient workflows

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

### ⌨️ Keyboard-only day

Keep hands on home row: **`>`** search → **Enter** open → **Esc** → **`&`** add → **`:`** change layout/theme → **`,`** switch page.

---

## 21. 🔐 Security and self-hosting

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

They are also readable in the app: **Config → Data & backups → Server log**, with **Show → Activity only**. That needs **Collect server log** switched on, since it is the same buffer. Which events are written stays an environment setting; the viewer only decides what you look at.

### Rate limits

Per-client limits on outbound fetches and SSRF-sensitive APIs (`NEXTDASH_OUTBOUND_REQUESTS_PER_MIN`, default 120; `NEXTDASH_SSRF_API_RATE_PER_MIN`, default 60). Returns **429** when exceeded.

### Content-Security-Policy

HTML pages send a restrictive CSP by default. Set `NEXTDASH_CSP=off` only when required by your proxy or integration.

#### GitHub update checks

Since **v2026.08.04**, nextDash can compare your running release tag with the latest on GitHub once a day. When a newer version exists, Config → Overview shows a compact notice above Tips, the ★ button gets a dot, and a toast appears once per release while you are actively using the app. Press **Check for updates** on Overview to compare manually; since **v2026.08.08.2** the ★ modal header only reports the result, with a link to the release and **Dismiss**.

Go to **Config → Behavior → Privacy** and tick or clear **Check GitHub for new releases** (on by default). When off, the dot, toast, and update bars disappear everywhere. Only a public GET to the GitHub Releases API is sent — no bookmarks or settings.

**For the whole server (self-hosting).** Set **`DISABLE_UPDATE_CHECK=true`** to turn update checks off for every user; the Privacy toggle then appears greyed out with a note that the operator disabled it.

#### Analytics and privacy

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
| Config sections | which of the eight sections you open, which sub-tab you land on and whether you got there by click or arrow key, whether an overview *needs attention* row was followed, and which backup action was run |
| Settings you change | the **name** of the setting only — never what you typed into it. A toggle also reports `true`/`false`, since on/off is the whole point of measuring one; free-text fields such as the dashboard title or a webhook URL report the name alone |
| List shape | which filter or sort you picked in health or inbox, and whether you used a summary tile or a filter pill. The search box in either view is never reported |
| Settings snapshot | once per page load: which features you have switched on, as plain yes/no values and small enums — layout and density, what a bookmark row shows, search behaviour, inbox and paste, availability checking and its interval, and the rest — plus the **release you are running** (`v1.1.1`) so the numbers can be read per version rather than as one blur across every release. A theme you built yourself is reported as `custom`, never by its id |
| Size of your install | once per page load, and every figure **rounded into a bucket**: how many bookmarks, pages, categories, distinct tags, finders and collections you have, how many bookmarks are monitored or merely checked, and the inbox totals — what is waiting now, and how many links have ever been added, promoted or deleted. `500+` rather than 1274, because an exact count would follow one install from release to release. Nothing is counted at all while analytics is off (**v1.1.1**) |

The settings snapshot is what makes it possible to see, for example, that a given option is used by almost nobody and could be simplified away — or that one is popular and deserves more attention.

#### What is never measured

No bookmark names, no URLs, no search queries, no page or category names, no notes, and no tags — the counts above say *how many* tags exist, never which. No cookies are set, no personal profile is built, and you are not tracked across other websites. Where an exact number could be revealing it is rounded into a bucket (for example `2-5 items` rather than a precise count). The Umami instance is self-hosted by the project, so nothing is shared with an advertising network. The tracker host is allow-listed in the CSP (`script-src` and `connect-src`).

This is separate from the local **open count / last opened** [usage tracking](#usage-tracking), which stays entirely on your own server and is never sent anywhere.

### Startup validation

Before listening, the server checks `PORT` (1–65535) and that `NEXTDASH_DATA_DIR` is creatable and writable. Misconfiguration exits with a clear error.

### Production Docker

Use `docker-compose.prod.yml` for deployments: assets ship inside the binary via `go:embed`; only `./data` is mounted. Since **v2026.08.02** the image is slimmer (~40% smaller), precomputes static asset hashes at build time, caches parsed templates and store reads in memory, and applies HTTP read/write/idle timeouts. Since **v2026.08.02.1** the container starts as root so host Docker hooks (e.g. Tailscale on Unraid) can run, then drops to user `nextdash` via `scripts/docker-entrypoint.sh` (`NEXTDASH_RUN_AS_ROOT=1` keeps root when required). The compose file sets a 256 MB memory limit; for TLS and long-cache static assets in front of the app, see `docker-compose.proxy.yml` and `deploy/Caddyfile`. Commented environment examples live in the prod compose file and [README.md → Production Docker example](README.md#production-docker-example).

### Build metadata & cross-tab sync

- `GET /version` — version and commit string for ops/monitoring.  
- `GET /api/data-revision` — hash of bookmark data; open dashboard tabs poll this to refresh after saves in config, the extension, or another tab (name, URL, shortcut, tags, and category placement).

Preview metadata is cached in memory and flushed periodically (~30 s) and on shutdown so restarts do not serve stale OG tags indefinitely.

---

## 22. 🛠️ Troubleshooting and FAQ

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

## 23. 📌 Quick reference

### Most-used keys (dashboard)

```
> search    : commands    ? finders    & quick-add    + new modal
1-9 pages   , overview    * recent     ! cheat sheet
arrows nav  Enter open    Shift+E edit  Shift+M move  Shift+T tag  Shift+D delete
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

## 📖 Further reading

| | Document | Contents |
|---|----------|----------|
| 🚀 | [README.md](README.md) | Install, security, Docker, and feature overview |
| 📋 | [CHANGELOG.md](CHANGELOG.md) | Complete release history (new / fix) |
| 💬 | **Config → Help** | Same topics as this manual, translated (EN/NL/DE/FR), with anchor links, **Browser extension**, **Security & self-hosting**, and a **What's new** recap |
| ★ | **In-app What's new** | Latest release first; scroll for up to **50 recent** versions (each loads on demand with a skeleton while fetching) |

---

*This manual describes nextDash as shipped in this repository. Minor details may vary by version; when in doubt, trust **Config → Help** and the ★ What's new modal.*