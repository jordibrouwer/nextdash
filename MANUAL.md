<p align="center">
  <img src="logo-ascii-on-black-large.png" alt="nextDash" width="640">
</p>

# nextDash — User Manual

**A complete guide to the keyboard-first bookmark dashboard.**

| | Resource | Where to look |
|---|----------|---------------|
| 🚀 | **Install & security** | [README.md](README.md) — Docker, environment variables, production setup |
| 📋 | **Release history** | [CHANGELOG.md](CHANGELOG.md) — every version, new and fix |
| 🗂️ | **Shortcut cheat sheet** | Press **!** or **F1** on the dashboard (live, searchable). Printable: [PDF](nextDash-cheatsheet.pdf?raw=true) / [HTML](nextDash-cheatsheet.html?raw=true) — regenerate with `npm run generate:cheatsheet`. |
| 💬 | **In-app help** | **Config → Help**, in English, Dutch, German, French, Spanish and Chinese |

This manual describes nextDash as it is now. It follows the same topics as Config → Help and goes into more detail. What changed in which release is in the [changelog](CHANGELOG.md).

---

## 📚 Table of contents

1. [What is nextDash?](#1-what-is-nextdash)
2. [Installation and first launch](#2-installation-and-first-launch)
3. [Core concepts](#3-core-concepts)
4. [The dashboard](#4-the-dashboard)
5. [Adding bookmarks](#5-adding-bookmarks)
6. [Opening and editing bookmarks](#6-opening-and-editing-bookmarks)
7. [Keyboard](#7-keyboard)
8. [Search, commands and finders](#8-search-commands-and-finders)
9. [Pages, categories and collections](#9-pages-categories-and-collections)
10. [Tags](#10-tags)
11. [Widgets](#11-widgets)
12. [Appearance](#12-appearance)
13. [Health and monitoring](#13-health-and-monitoring)
14. [Inbox](#14-inbox)
15. [Config](#15-config)
16. [Statistics](#16-statistics)
17. [Data, backups and import](#17-data-backups-and-import)
18. [Logs](#18-logs)
19. [Browser extension and capture](#19-browser-extension-and-capture)
20. [Phones, tablets and the installed app](#20-phones-tablets-and-the-installed-app)
21. [Security and self-hosting](#21-security-and-self-hosting)
22. [Troubleshooting](#22-troubleshooting)
23. [Quick reference](#23-quick-reference)

---

## 1. ✨ What is nextDash?

nextDash is a **self-hosted bookmark dashboard** you open in your browser.

- **No accounts.** One installation, one set of data on disk.
- **No cloud.** Your bookmarks live as plain JSON files in a directory you control.
- **Keyboard first.** Search, switch pages, add, edit and run commands without the mouse.

Bookmarks are grouped by **page** (Work, Home) and **category** (Dev, News). Around that sit search, a command palette, link health checks with uptime monitoring, an inbox for links you have not filed yet, and widgets that show something other than links.

### ✅ What you can do

| Area | Examples |
|------|----------|
| **Organise** | Pages, categories, drag and drop, pins, tags, notes, smart collections |
| **Find** | Type to search, filters, a command palette, finders for other sites |
| **Add** | One-line quick add, the full form, paste a URL, browser extension, share sheet, bookmarklet, imports |
| **Watch** | Broken links, uptime monitoring, certificate expiry, page drift, alerts |
| **Show** | Widgets for health, inbox, feeds, weather, calendar, your machine and your own services |
| **Customise** | 121 theme families, surfaces, layout, header and action buttons, six languages |
| **Keep** | Automatic backups, a 30-day trash, local copies of pages, HTML and CSV export |

### 🚫 What nextDash is not

- Not a multi-user service. Anyone who can reach the address can read and change the data — see [Security and self-hosting](#21-security-and-self-hosting).
- Not a feed reader. Fresh and the RSS widget tell you what is new; they do not store articles.

---

## 2. ⚙️ Installation and first launch

### 🐳 Docker Compose (recommended)

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
docker compose up -d
```

Open `http://localhost:8080`.

From a git checkout, `docker-compose.prod.yml` is the production file (only `./data` is mounted; the assets are built into the binary) and `docker-compose.yml` is for development (it mounts `./static` and `./templates`).

### 🧱 Build from source

```sh
go build -o nextDash && ./nextDash
```

Data is stored in `./data` next to the binary. `NEXTDASH_DATA_DIR` points it elsewhere.

### 🌿 Which branch to clone

| Branch | Use it for |
|--------|------------|
| **`main`** (default) | Self-hosting and Docker builds — the released code |
| **`dev`** | Contributing — tests, scripts and work in progress |

### 🚦 First launch

1. **Quick-start card.** A small card asks for your language and dark mode, your column layout and your weather location. Skip it whenever you like; every setting stays in config. It then becomes a short checklist — add a bookmark, tag one, open config, see the cheat sheet — that closes itself when done.
2. **Example bookmarks.** A new install starts with a few example bookmarks and a Health widget, so there is something to try the keys on.
3. **Your own bookmarks.** Import your browser's bookmark file under **Config → Data & backups** ([§17](#17-data-backups-and-import)), or add them with **+** and **&** ([§5](#5-adding-bookmarks)).
4. **Config.** Press **`Shift + S`** or click the gear. Config is a view inside the dashboard; **`Escape`** takes you back.

**The first hour.** Split your bookmarks across a few pages, give the ten you open daily a shortcut, and switch on link checking under Config → Behavior → Status & health. Everything else can wait until you know what you want.

---

## 3. 🧠 Core concepts

### 3.1 Pages

A **page** is a separate set of categories and bookmarks — Work, Home, a project. Each page has a name, an optional emoji and an optional colour dot. Switch with **`1`–`9`**, **`Shift + ←/→`**, the page switcher in the header, or the pages panel (**`,`**). A page remembers where you were scrolled.

### 3.2 Categories

A **category** is a section on a page. It has a name, an optional icon, a sort (manual, A–Z or Recent) and can be spread across several columns. Category names are unique per page; the same name on two pages is two categories. Bookmarks without a category collect under *Other* at the end of the page.

### 3.3 Bookmarks

| Field | Purpose |
|-------|---------|
| **Name** | The label. A bookmark without a name shows its host name. |
| **URL** | The address (http or https; private addresses only when allowed) |
| **Page / Category** | Where it is filed |
| **Tags** | Free labels, stored in lower case |
| **Shortcut** | One or two letters that open it from the dashboard |
| **Note** | Plain text, searchable |
| **Pinned** | Keeps it at the top of its category |
| **Icon** | Fetched automatically, or set by hand |
| **Availability checking** | **Off**, **Periodic** or **Monitor** — see [§13](#13-health-and-monitoring) |

nextDash also records when a bookmark was added and last changed, how often it was opened and when last, and its preview (title, description, image) and health.

### 3.4 The inbox

The **inbox** holds links you want to keep before you know where they belong. It is a list of its own, not a page. See [§14](#14-inbox).

### 3.5 Views

The dashboard has four views: the **bookmarks**, **health**, the **inbox** and **config**. They are all part of one page — switching never reloads. **`Escape`** backs out to the bookmarks, and the browser's **Back** button returns to the view you came from. Changing a filter inside a view is not a history step.

---
## 4. 🖥️ The dashboard

```
┌───────────────────────────────────────────────────────────────────────────┐
│ It's 09:12 · Thursday          1  2  3  4  +5      ⌂  ⤓  ♥  ⚙             │
│ Leiden, rain, 16°C                                                        │
│ main                                                                      │
├───────────────────────────────────────────────────────────────────────────┤
│ // today (15)        // other            // vps             // weather     │
│   bookmark rows        bookmark rows       bookmark rows      widget       │
│                                                                           │
│                        [ + ] [ > ]   ← action buttons (dock)               │
└───────────────────────────────────────────────────────────────────────────┘
```

### 🧭 The header

The header has three zones.

- **Left — clock, weather and name.** The time and date, the weather line, and the name of the page or view (*main*, *health*, *config*). Click the date for a week overview; a **Calendar URL** (Appearance → Date & weather) adds an *Open calendar* link. **Clock and weather** chooses where they stand: beside the view name (the default), in a column of their own, or on their own line with the name underneath.
- **Middle — the page switcher.** See [below](#the-page-switcher).
- **Right — the destinations.** **Dashboard** (⌂), **inbox** (with its unread count), **health** (a pulse icon with a count) and **config** (the gear). The health count is red for a broken link or a monitored bookmark that is down, amber for warnings, and hidden when all is well; it pulses once when a new outage appears. Each destination can be switched off; its key keeps working.

**Button style** draws the header controls plain (underlined when current) or each in its own box. As the window narrows, the header folds its parts away in a fixed order, so the switcher and the destinations stay reachable.

### 🔢 The page switcher

| Style | What it looks like |
|-------|--------------------|
| **Numbers beside the destinations** (default) | `1 2 3 4 +5` |
| **One segmented control** | The pages as one joined control |
| **Plain text, underlined** | The page names as tabs |
| **One button with a list** | The current page, with a list of the rest |

**Page tabs shown before "+N"** (3–9, default 4) sets how many pages show before the rest fold into a **+N** list. Every page keeps its digit key. **Show page names in tabs** and **Show the dashboard title** sit in the same group. Double-click a page tab to rename it and give it an emoji and a colour dot.

`:switcher`, `:maxtabs` and `:buttonstyle` change these from the command palette.

### 🎛️ The action buttons

| Button | Key | Opens |
|--------|-----|-------|
| Add | `+` | The full bookmark form |
| Search | `>` | The search panel |
| Commands | `:` | The command palette |
| Finders | `?` | Finders |
| Tag cloud | `/` | The tag cloud |
| Recent | `*` | Recent bookmarks |
| Pages | `,` | The pages panel |
| Fold all | `.` | Folds or unfolds every category and widget |
| Cheat sheet | `!` | The cheat sheet |

Every button is on to begin with. Switch the ones you do not want off under **Config → Appearance → Action bar**. Hiding a button leaves its key working; with every button off, the surround disappears too.

**Where the fixed buttons stand.** A fresh install puts the bar in **a column on the right** that slides into the edge after **2 seconds**, so the page has it out of the way until it is wanted.

| Position | Behaviour |
|----------|-----------|
| **In a column on the right** (default) / **on the left** | A vertical column along that edge; the page moves aside to make room. |
| **In a dock at the bottom** | Centred at the bottom. |
| **In the header** | Beside the destinations. **Action buttons shown before "+N"** (default 2) folds the rest behind one control whose menu lists each action with its key. |
| **Behind one menu in the header** | One control; every action is in its menu. |

**A bar that slides away.** **Slide a docked bar away after** takes *always in view*, 2 (default), 5, 10 or 30 seconds, and applies to the three docked positions. The bar comes back when the pointer touches that edge, when focus moves into it, and on **`'`** or **`Shift + O`**, which also send it away again. Switching page or view leaves it where it is. A bar in use — the pointer over it, the keyboard in it, or a menu of its own open — never leaves while you are using it.

While it is away, a small **handle** stands on that edge, so the place it came from stays visible. It grows and brightens as the pointer comes near, and a click on it brings the bar back. There is no handle for a bar in the header or behind the menu, and none on a touch screen, where nothing hovers.

**The keys.** **Show the key on each button** adds a key chip to every button. It starts **on** for a new install and **off** on a dashboard that already existed — a bar of nine chips is a lot to meet on upgrade. With the chips off, resting on a button for a moment shows that button's key beside it, so the key is still there to find.

`:buttons` and `:maxactions` change these from the command palette.

The **★** button in the bottom-right corner opens the release notes.

### 🗂️ The grid

Categories and widgets stand in columns. Each category header shows `//`, its icon and name, a count, and chips for sorting (manual, **A–Z**, **Recent**), a **+** to add a category and a **⋯** menu. Click the header to fold the category. A spread category shows **↔ N** with the number of columns it takes. Smart collections (*Today*, *Recently opened*, …) and custom collections appear as groups among your categories.

A bookmark row shows its icon, name, optional tags, the shortcut letters and, when checked, its status and ping. How the row looks is set under **Appearance → Grid** ([§12](#12-appearance)).

**A key legend** under the grid shows the four most useful keys once you start moving with the keyboard; switch it under Behavior → General.

**Occasional tips.** Now and then the dashboard shows one keyboard tip, never the same one twice. Switch them off under Behavior → General → Onboarding.

**Corner cards** offer things once, one card at a time: a round of link review, a round of tag suggestions, browser notifications, the theme browser, Fresh, spreading a category. Each can be dismissed, and each review card has a switch under Behavior → General → Onboarding.

### 🃏 The link preview card

Hovering a bookmark — or pressing **`Shift + V`** on the selected row — opens a card in a fixed order:

1. **What the page is** — icon, title, one address and a status pill.
2. **What it says** — image, description, publisher, author and date where the page declares them, your note and tags. For video providers the card carries a player.
3. **What you know about it** — last check and ping, uptime, certificate expiry, the Fresh count, opens and last opened, shortcut and location.

A row with nothing to say is left out. **Config → Appearance → Grid → Display → Link preview cards** offers **Off**, **On hover** (default) and **Keyboard only**, a hover delay, and a checklist of rows. `Shift + V` works in every mode and keeps the card open with **Copy**, **Refresh** and **Edit**.

The picture and the site icon are fetched **by your server** and stored under `data/preview-images/`, so hovering never tells the site you looked. The first hover shows the text at once and the picture a moment later. Untick **Image** and no picture is fetched or stored; set the cards to **Off** and nothing is fetched for them at all. **Data & backups → Icons & previews** caps the stored pictures at 50, 200 or 500 MB and can remove them all. Pictures are left out of backups; they are fetched again when needed.

---

## 5. ➕ Adding bookmarks

### 5.1 Quick add (`&`)

Press **`&`**, type one line — `name | url | shortcut` (shortcut optional) — and press **Enter**.

```
GitHub | https://github.com | gh
```

### 5.2 The full form (`+`, `Shift + B`, `Ctrl + Shift + A`)

One bookmark form is used everywhere: the dashboard, health, the inbox, config and `:new`.

- **`+`** on the dashboard, or the add button.
- **`Shift + B`** from anywhere on the dashboard, unless you are typing in a field.
- **`Ctrl + Shift + A`** from anywhere.

The form has two groups: **what it is** (address, name, icon, note) and **where it goes** (page, category, tags, shortcut, pin, availability checking). On a wide window they stand side by side. Adding starts in the address field; the title and icon are fetched when you paste a URL.

- The **Page** and **Category** lists start with **New page…** and **New category…**, so a bookmark can go somewhere that does not exist yet.
- **Availability** is the same **Off / Periodic / Monitor** choice as everywhere, with the interval for Monitor.
- The **shortcut** field warns when a shortcut is taken, and says which letters the grid itself uses.
- **Save** or **`Ctrl + Enter`** saves. **Create + New** saves and clears the form for the next one, keeping page and category.
- On a phone the form leaves out the icon and note fields; existing values are kept.

### 5.3 Paste a URL (`Ctrl + V`)

With no field active, paste a URL on the dashboard. A dialog offers **Save to Inbox** (`1`) or **Add bookmark** (`2`). Set a fixed answer under **Config → Behavior → Inbox** — *Ask each time*, *Always add bookmark* or *Always save to Inbox*.

### 5.4 Other routes

- **Browser extension** — saves the current tab ([§19](#19-browser-extension-and-capture)).
- **Share sheet and bookmarklet** — save to the inbox from a phone or any browser ([§19](#19-browser-extension-and-capture)).
- **Import** — a browser bookmark file, a CSV file, or a source such as GitHub stars ([§17](#17-data-backups-and-import)).
- **Config → Bookmarks → Add bookmark** — the same form ([§15](#15-config)).
- **`:new`** and **`:add`** in the command palette.

### ♻️ A link you already have

nextDash compares addresses loosely: a trailing slash, a `#fragment`, the case of the host and a default port do not make a link different.

- **Same page** — refused. Two identical rows on one page are never intended.
- **Another page** — you are asked, and told where it is: *"You already saved this on Work · Docs"*, with a link. **Save anyway** keeps the second copy.

The form, quick add and the extension all ask. Imports skip duplicates and say how many.

---

## 6. 🔖 Opening and editing bookmarks

### 🖱️ With the mouse

| Gesture | What it does |
|---|---|
| Click a bookmark | Opens it and counts the open. The row flashes briefly. |
| Middle-click / `Ctrl`-click | Opens it in a new tab, and counts the open |
| Right-click a bookmark | The actions menu. Inside a selection it acts on the whole selection. `Shift` + right-click gives the browser's menu. |
| Drag a bookmark | Reorders it, or moves it to another category |
| Long-press a bookmark (~500 ms) | Edit in place |
| Hover a bookmark | The preview card |
| Click a category header | Folds or unfolds it |
| Long-press or double-click a category header | Renames it |
| Right-click a category header | Rename, spread, add, icon, delete |
| Drag the `//` in a category title | Reorders categories |
| Double-click a page tab | Renames the page, sets its emoji and colour |
| `Alt`-click / `Shift`-click | Adds to, or extends, a selection |

**Open in new tab** follows Behavior → General; `Ctrl/Cmd + Enter` always opens a new tab.

### 📋 The right-click menu

| Item | Key | What it does |
|------|-----|--------------|
| Open in new tab | `Ctrl/Cmd + Enter` | Opens it in the background |
| Copy URL | `Ctrl + C` | Copies the address |
| Share… / Copy name + URL | `Shift + L` | The system share sheet where the browser offers one (HTTPS only); otherwise copies name and address |
| Edit | `Shift + E` | Edit in place |
| Pin / Unpin | `Shift + P` | |
| Tags… | `Shift + T` | The quick tag picker |
| Move to… | `Shift + M` | Another category or page |
| Checking | `Shift + C` | Off / Periodic / Monitor |
| Show in Health | `Shift + R` | Opens health on this row |
| Select / Select all in category | `x` / `X` | Starts a selection |
| Delete | `Shift + D` | Asks first; undo in the toast; the trash keeps it 30 days |

The menu also opens with **`Shift + F10`** or the **Menu** key, beside the row.

### ✏️ Editing in place

**`Shift + E`**, a long press, or **Edit** opens the bookmark form over the row, with the page dimmed behind it. **Save** or **`Ctrl + Enter`** writes it; **`Esc`** or a click outside closes it, asking first when something changed. While it is open, the grid keys, swiping and paste are paused. Deleting from the form asks first and offers undo.

### 📈 Usage

Every open — from the grid, search, the recent panel or health — adds one to the bookmark's open count and records the time. This feeds *Recently opened*, *Most used*, *Stale*, statistics and the health view. Opening the same site from the browser's address bar does not count. The counts are in your data files and travel with backups.

### 🕘 Recent bookmarks (`*`)

A narrow panel with what you opened recently on this page: one row per bookmark, with its category, when and how often. The arrow keys move, `Enter` opens. `:open last 5` opens several at once.

### 🪟 Hypr mode

**Behavior → General → Hypr mode** makes a click open the bookmark in a new browser tab and then close the installed app's window, the way an app launcher works. It pairs with nextDash installed as an app ([§20](#20-phones-tablets-and-the-installed-app)).

---
## 7. ⌨️ Keyboard

Every action on a bookmark is **`Shift` plus a letter**. Bare letters belong to search until the cursor is on the grid, and then to the grid. The right-click menu shows each key, and the cheat sheet (**`!`** or **`F1`**) lists all of them.

### 7.1 Views and panels

| Keys | Action |
|------|--------|
| `1`–`9` | Go to a page |
| `Shift + ←` / `Shift + →` | Previous / next page |
| `0` or `Shift + I` | Inbox |
| `Shift + H` | Health |
| `Shift + S` or `<` | Config (and back) |
| `Shift + A` | The theme browser |
| `>` `:` `?` | Search, commands, finders |
| `+` · `Shift + B` · `&` | Full bookmark form · from anywhere · quick add |
| `/` | Tag cloud |
| `*` | Recent bookmarks |
| `,` | Pages panel (`n` there makes a new page) |
| `!` or `F1` | Cheat sheet |
| `.` | Fold or unfold every category and widget |
| `Shift + N` | Add a category to this page |
| `'` or `Shift + O` | Slide a docked action bar away or back |
| `Shift + F` | Filter this page in place |
| `Shift + Q` | Switch whether letters search names or shortcuts |
| `Esc` | Close the panel; on a bare grid, go to the first page; on the first page, open search |

### 7.2 Moving on the grid

| Keys | Action |
|------|--------|
| `↑` `↓` `←` `→` | Move the cursor. The first arrow key starts it. |
| `k` / `j` | Up / down, once a row is selected |
| `Tab` / `Shift + Tab` | Next / previous bookmark |
| `Home` / `End` | First / last bookmark in the category |
| `Ctrl + Home` / `Ctrl + End` | First / last bookmark on the page |
| `Page Up` / `Page Down` | One screen up / down |
| `G` then `1`–`9` | First bookmark in that category or collection |
| `G` then `P` | First pinned bookmark |
| `G G` | First bookmark on the page |
| `Enter` / `Space` | Open |
| `Enter` on **+ N more** | Show or hide the rest of a long category |
| `Esc` | Clear the cursor; undo a drag that has not saved yet |

With the cursor on a row, a bookmark's own **shortcut** opens it. The letters the grid uses — `g`, `j`, `k`, `t`, `x` — keep their grid meaning; reach a bookmark with such a shortcut through search.

### 7.3 Acting on a bookmark

| Keys | Action |
|------|--------|
| `Shift + E` | Edit in place |
| `Shift + V` | Preview card, kept open |
| `Shift + M` | Move to another category or page |
| `Shift + T` | Tags |
| `Shift + D` or `Delete` | Delete (asks first; undo in the toast) |
| `Shift + P` | Pin or unpin |
| `Shift + C` | Availability checking — `o` off, `p` periodic, `m` monitor |
| `Shift + L` | Share, or copy name and URL |
| `Shift + R` | Show the row in health |
| `Ctrl + C` | Copy the URL |
| `Ctrl/Cmd + Enter` | Open in a new tab |
| `t` | Filter the grid by this bookmark's tag |
| `Alt + ↑` / `Alt + ↓` | Move it within its category (manual order) |
| `Shift + Alt + ←` / `→` | Move it into the category beside it |
| `Shift + F10` or Menu key | The right-click menu |

### 7.4 Acting on a category or widget

`Shift + Home` steps from the rows up to the header. There:

| Keys | Action |
|------|--------|
| `Enter` / `Space` | Fold or unfold |
| `F2` | Rename |
| `Shift + W` | Spread across columns (on a widget: one or two columns) |
| `Alt + ←` / `Alt + →` | Move the category one place |
| `Delete` | Delete the category (bookmarks are kept) or close the widget |
| `Shift + F10` | The header menu |

The arrow keys walk into a widget and through its rows; `Enter` does what clicking the row does.

### 7.5 Selecting several

| Keys | Action |
|------|--------|
| `x` | Tick the row and move to the next |
| `X` | Tick the whole category |
| `Shift + ↑` / `Shift + ↓` | Extend the selection |
| `Ctrl/Cmd + A` | Tick everything on screen |
| `Alt` + click / `Shift` + click | Add one / extend with the mouse |
| `Delete` | Delete the selection (one confirmation, undo in the toast) |
| `Esc` | Clear the selection |

A toolbar appears with **Move**, **Tags**, **Pin**, **Checking**, **Open**, **Copy links** and **Delete**. The tag picker shows a **✓** for tags the whole selection has and *on 2 of 3* for tags only some have. While a selection is open, a plain click clears it instead of opening a bookmark. A bulk change can be undone from its toast for eight seconds, and deleted bookmarks stay in the trash for 30 days.

### 7.6 The cheat sheet

**`!`** or **`F1`** opens the cheat sheet with a filter box. It opens on the section for the view you are in — health, inbox or config — and lists more than 200 keys and commands. A printable version is linked at the top of Config → Help and at the top of this manual. Keys cannot be rebound.

While a panel is open, the grid behind it does not react. `Tab` stays inside the panel, and `Escape` closes it and puts focus back where it was.

---

## 8. 🔎 Search, commands and finders

Search, commands and finders are three modes of one panel.

```
>  search     — your bookmarks, with filters
:  commands   — actions: :theme, :open last 5, …
?  finders    — ?g query → another site
@  everywhere — search all pages at once
```

### 8.1 Just type

The dashboard's search line is always listening. Letters narrow the list; **`Enter`** opens the top result, **`↑`/`↓`** pick another, **`Ctrl/Cmd + Enter`** opens in a new tab, **`Esc`** closes. Results are ranked by match and by how often you open them. The panel also searches notes and the description nextDash fetched from each page.

With the panel empty, your recent and saved searches show as chips (`←`/`→` and `Enter`).

**Typing a bookmark shortcut** (Behavior → Search) has three answers:

| Setting | What happens |
|---------|--------------|
| **Open the moment it matches** (default) | The bookmark opens as soon as what you typed equals its shortcut. Fastest; can cut off an ordinary word that starts with those letters. |
| **Open after a short pause** | The shortcut waits until you stop typing. |
| **Press Enter to open** | Typing only narrows the list; the shortcut leads it. |

**Switch search mode** (Behavior → Search, or **`Shift + Q`**) decides whether bare letters look for a shortcut or a name. When one finds nothing and the other would, the panel adds a row that searches the other way.

**Behavior → Search** also holds fuzzy suggestions for near-misses, *include finders in search*, *keep search open when empty* and the search hint.

### 8.2 Filters

| Filter | Examples |
|--------|----------|
| `tag:` | `tag:work` |
| `category:` | `category:dev` |
| `page:` | `page:2`, `page:current`, `page:all` |
| `status:` | `online`, `offline`, `broken`, `ok`, `checked`, `unchecked`, `pinned`, `unpinned`, `tagged`, `untagged`, `noted`, `unnoted`, `feed` |
| `opened:` | `today`, `week`, `month`, `year`, `never` |
| `added:` | `today`, `week`, `month`, `year` |
| `-` before any filter | `-tag:archive`, `-status:pinned` |

Filters combine with each other and with plain words: `tag:dev -status:pinned api`. They are offered as you type.

### 8.3 Beyond the current page

- **`@`** at the start searches every page; each result names its page.
- **`Shift + F`** is the opposite: a bar above the grid that hides non-matching rows on this page and keeps the layout and cursor. `Escape` clears it, a second `Escape` closes it.
- **`:find text`** does the same from the command palette.

### 8.4 From the browser's address bar

nextDash describes itself to your browser as a search engine (`/opensearch.xml`).

- **Firefox** — Settings → Search → Search shortcuts; give it a keyword.
- **Chrome, Edge, Brave** — Settings → Search engine → Manage search engines → Site search; shorten the keyword, for example to `nd`.
- **Safari** — not supported.

Then type the keyword, `Tab`, a term and `Enter`. A search also has an address of its own, `#search?q=your+terms`, which can be bookmarked or opened from a script. Behind a reverse proxy, `X-Forwarded-Proto` and `X-Forwarded-Host` are honoured.

### 8.5 Commands (`:`)

A lone **`:`** lists every command in five groups — Bookmarks, Search & navigate, Look & layout, Smart collections, Settings & tools — with your recent commands on top. Commands with an argument complete as you type. A toggle keeps the palette open and shows its new state.

| Command | What it does |
|---------|--------------|
| `:new` / `:add` | Full form / quick add |
| `:edit` · `:move` · `:copy` · `:note` · `:pin` · `:unpin` · `:remove` | On the selected bookmark |
| `:tag` · `:tag work` · `:tag +name` · `:tag -name` | List tags, browse a tag, add or remove a tag on the selected bookmark |
| `:filter <tag>` / `:filter clear` | The dashboard tag filter |
| `:find <text>` / `:find clear` | Filter this page |
| `:open all` · `:open pinned` · `:open tag <name>` · `:open category <name>` · `:open last [n]` | Open several in tabs (at most 15 at once) |
| `:page <name or n>` · `:page new <name>` | Switch page · create one |
| `:category <name or n>` · `:category new <name>` | Jump to a category · create one |
| `:recent` · `:overview` | Recent bookmarks · pages panel |
| `:save` · `:saved` · `:history` | Saved searches and search history (saved searches are kept in settings) |
| `:sort order\|az\|recent` | Sort the focused category |
| `:stale [days]` · `:duplicates` | Cleanup lists |
| `:goto <url>` · `:goto config\|stats\|health` | Go somewhere |
| `:inbox` · `:inbox triage` | The inbox |
| `:health [broken\|duplicate\|stale\|refresh]` · `:health page <n>` | The health view |
| `:monitor` · `:monitor off` | How many bookmarks are checked · switch checking off everywhere (asks first) |
| `:config [section]` | A config section, for example `:config appearance` |
| `:backup` · `:export` · `:trash` | Backups · download a backup · the trash |
| `:favicons fetch` · `:favicons on\|off` | Download every icon again · show icons |
| `:metadata` | Bookmarks without a preview |
| `:theme <name>` · `:dark` | Theme · flip light and dark |
| `:depth` · `:glow` · `:contrast` · `:backdrop` · `:pattern` · `:harmonize` | Surfaces ([§12](#12-appearance)) |
| `:layout <preset>` · `:density` · `:columns <1-6>` · `:width on\|off\|all` · `:rows` · `:packed` · `:fontsize` | Grid |
| `:switcher` · `:buttonstyle` · `:maxtabs` · `:maxactions` · `:buttons` · `:header` | Header and action buttons |
| `:preview` · `:title` · `:opacity` · `:animations` · `:status` · `:shortcuts` · `:lang` | Display toggles |
| `:locklayout` | Lock or unlock drag and drop |
| `:collections` | Smart collections on or off |
| `:telemetry on\|off` | Analytics (reloads the page) |
| `:cheat` · `:help` · `:whatsnew` · `:reload` | Cheat sheet · release notes · reload |

### 8.6 Finders (`?`)

`?shortcut query` sends the query to another site: `?g nextdash` searches Google. A fresh install has DuckDuckGo on `du`. `?w` without a query opens the site's own search page.

**Structure → Finders** manages them: a name, a shortcut and a URL with `%s` where the query goes (for example `https://github.com/search?q=%s`). Names and shortcuts must be unique. Rows can be dragged or moved with `↑`/`↓`, carry tags, and show how often each finder was used. **Include finders in search** (Behavior → Search) shows them among ordinary results.

---

## 9. 🗂️ Pages, categories and collections

### 9.1 Pages

- **Create** — **New page** in the pages panel (`,`, then `n`), `:page new`, **Structure → Pages**, or **New page…** in the bookmark form.
- **Rename, emoji, colour** — double-click the page tab, or use Structure → Pages.
- **Reorder** — drag a row in Structure → Pages, or `↑`/`↓` on a focused row.
- **Delete** — the × in the pages panel (asks twice) or Structure → Pages. The page goes to the trash with its categories and bookmarks.
- **Duplicate** — on the page row in Structure → Pages; asks whether the bookmarks come too.

Page names are unique. Each row in Structure → Pages shows how many bookmarks the page holds.

### 9.2 Categories

- **Create** — the **+** in a category header or **`Shift + N`** (on the page you are on), `:category new`, **New category…** in the bookmark form, or **Structure → Categories**.
- **Rename** — `F2`, a long press or double-click on the header, the right-click menu, or Structure → Categories.
- **Icon** — right-click the header → **Icon…** and type an emoji.
- **Reorder** — drag the `//` in the title, `Alt + ←/→` on the header, or Structure → Categories.
- **Delete** — `Delete` on the header, the right-click menu, or Structure → Categories. The bookmarks are kept and lose their category; the category goes to the trash.
- **Duplicate** — on the row in Structure → Categories, with its width, icon and sort, and optionally its bookmarks.

A category you just created stays visible even with *hide empty categories* on, until you leave the page.

### 9.3 Sorting and folding

Each category header has **A–Z** and **Recent** chips; click the active one to go back to manual order. Pinned bookmarks always stay on top. A sorted category cannot be dragged — the cursor and a short note say so. Sorting is only a view; the stored order changes when you drag.

Click a header, or press `Enter` on it, to fold the category. **`.`** folds or unfolds everything on the page, widgets included; the state is kept per page. **Always collapse categories** (Appearance → Grid) starts every category folded.

### 9.4 Moving and reordering bookmarks

- Drag a row within its category or onto another. A click still opens; a long press still edits.
- `Alt + ↑/↓` moves the selected bookmark within its category; `Shift + Alt + ←/→` moves it to the next category.
- `Shift + M` moves it to any category or page.
- Moves can be undone from the toast for eight seconds.
- **Lock layout** (Behavior → General, or `:locklayout`) turns dragging off for bookmarks and categories.

### 9.5 Spreading a category across columns

A category can run across several columns, so a long list of short entries flows across instead of down.

| Route | How |
|-------|-----|
| Mouse | Right-click the header → **Spread across columns** |
| Keyboard | **`Shift + W`** on the header |
| Command | `:width on` / `:width off`, or `:width all` to switch every category back |
| Config | The ↔ button on the row in Structure → Categories |

The number of columns is not a setting: it follows from **items per category** and the number of bookmarks. With a limit of fifteen:

| Bookmarks | Columns |
|---|---|
| 1–15 | 1 |
| 16–30 | 2 |
| 31–45 | 3 |

The column count of the grid is the ceiling. Spreading needs a limit on items per category and at least two columns. With **Pack columns tightly** on, the categories after a spread one fill in beside and below it. On a phone every category is one column wide. **Appearance → Grid → Layout → Categories across columns** holds the limit, whether new categories start spread, and whether *turn spreading off everywhere* covers this page or all pages. A walkthrough is under Config → Help → Structure & bookmarks.

### 9.6 Smart collections

**Structure → Collections** turns them on. Each has its own item limit (0 = unlimited) and can be limited to certain pages.

| Collection | Shows |
|------------|-------|
| **Today** | What you tend to open at this time, tuned by keywords for office hours, evenings and weekends |
| **Recently opened** | What you opened last |
| **Recently added** | What you saved last (off by default) |
| **Most used** | Ranked by opens; appears once you have opened bookmarks from the dashboard |
| **Stale** | Not opened within the stale threshold |
| **Fresh** | Bookmarks whose site published since you last opened them ([§13.9](#139-fresh)) |

Editing or deleting a bookmark inside a collection changes the real bookmark.

### 9.7 Custom and tag collections

**Custom collections** (Structure → Collections) take a name, an icon and rules on tag, category or shortcut, combined with AND or OR, including *excludes*. The value fields suggest what is already in use.

**Tag collections** turn each tag used by enough bookmarks into its own group; raise the minimum to keep one-off tags out.

---

## 10. 🏷️ Tags

### 10.1 Tags on a bookmark

- Set them in the bookmark form, the side panel in Config → Bookmarks, with `Shift + T`, or with `:tag +name`.
- Stored in lower case, trimmed, without duplicates. Autocomplete offers the tags you already use.
- **Tags on rows** (Appearance → Grid → Display) shows them as chips on the dashboard — the first few, then a count. Click a chip to filter.

### 10.2 Filtering by tag

- **The tag cloud** (`/`) sizes each tag by use. Click or press `Enter` on several; the dashboard shows bookmarks with **any** of them. Chips under the page title remove one tag each; `Escape` on the dashboard clears the filter.
- While a tag filter is active, a toolbar offers **Open**, **Copy links**, **Move** and **Delete** for everything shown.
- `t` on a selected bookmark filters by its tag.
- `tag:work` in search narrows results without changing the dashboard.

### 10.3 Managing tags

**Config → Bookmarks → Tags** lists every tag with how many bookmarks carry it. Rename or delete a tag everywhere at once; renaming onto an existing tag is refused. Expand a tag to see its bookmarks and remove it from one. `↑`/`↓` move and `/` focuses the filter.

### 10.4 Tag suggestions

**Config → Bookmarks → Tag suggestions** proposes one tag for a whole group of bookmarks. Its sources:

- **Your rules** (the **Your rules** tab) — `github.com → #code`, a site or a site plus one section. They win over everything.
- **Your own tags** — when most tagged bookmarks on a site share a tag, the rest are offered it.
- **A shipped list** of 463 subjects and the sites that belong to them. Your own words win: a subject called `dev` is offered as `#code` if that is what you use.
- **Read their pages** (optional) — fetches the pages nothing else can place and files them by what they are about. It says what it will cost, shows progress and can be stopped. Only a dozen keywords per page are kept.

Each row names its source and its count. The count opens the group, so single bookmarks can be left out. **Apply** tags the rest (undo in the toast); **No thanks** stops the proposal from coming back, and refusals are listed with a way back. At most 25 rows show at a time. **Forget the scanned keywords** (here or under Data & backups → Icons & previews) clears what *Read their pages* kept.

A corner card offers a round when ten proposals are waiting; it can be switched off under Behavior → General → Onboarding.

### 10.5 Notes

Notes are plain text. Edit them in the form, the side panel or with `:note`. Search matches them, and the preview card shows them.

---

## 11. 🧩 Widgets

A page holds categories and, beside them, **widgets**: blocks that show something other than links. Categories and widgets share one order.

### 11.1 The kinds

*Are the links still good?*

| Kind | Shows |
|---|---|
| **Health** | Broken, down, changed and fine; each figure opens its filter |
| **Uptime** | Monitored bookmarks, worst first, with a heartbeat |
| **Certificates** | Certificates close to expiry, per host |
| **Health trend** | How the collection's health has moved, drawn like the summary in the health view |

*What is arriving?*

| Kind | Shows |
|---|---|
| **Inbox** | How much is waiting, and how old the oldest is |
| **Feeds** | Feeds with news, and feeds that stopped after repeated failures |
| **Sources** | What each import source last did |

*What needs tidying?*

| Kind | Shows |
|---|---|
| **Neglected** | Bookmarks not opened in a long time |
| **Blind spots** | Never checked, checked long ago, or not watched |
| **Duplicates** | The same address stored more than once |
| **Archive** | How many bookmarks have a copy, and which broken ones have none |
| **Trash** | What is in the trash and when it goes |
| **Backups** | The age of the newest automatic backup, and whether the last run failed |

*How is this machine doing?*

| Kind | Shows |
|---|---|
| **Processor** | CPU use and the load average |
| **Memory** | What is really in use; the file cache counts as free |
| **Disks** | Used, free and reserved space on the disks you name |
| **Containers** | Running and total containers, failing healthchecks, recent restarts |

*What is happening around you?*

| Kind | Shows |
|---|---|
| **Weather** | Current conditions and a forecast (3 days, 5 days or 24 hours), from the settings under Appearance → Date & weather |
| **Calendar** | What is coming up, from the **Calendar feed URL (.ics)** under Appearance → Date & weather |
| **RSS** | The newest articles from up to ten feed addresses set on the widget, merged newest first |

And the **Custom** widget, which reads any service that answers with JSON ([§11.5](#115-the-custom-widget)).

A tile with a row limit shows what it left out (*5 of 12*). A figure on a tile is a link to the rows behind it.

### 11.2 Adding and arranging

**Config → Widgets** lists your widgets. **Add a widget** opens the catalogue; the **Types** tab describes every kind with an *Add* button. The list has a search (title and type), a page picker (including **All pages**), a sort (grouped, page order, name, type) and a selection bar with **Show**, **Hide**, **Move to page…** and **Delete**.

Each widget has a title, a width (one or two columns), the page it counts, a row count and the settings of its kind. An **ℹ** explains the harder settings and **↺** resets them. The title and **Shown** save at once; the rest waits for **Save**.

Widgets are ordered with the categories under **Structure → Categories**, or dragged on the dashboard. On a one-column dashboard a wide widget narrows itself.

### 11.3 On the dashboard

- Click the title, or `Enter` on the header, to fold a widget. `.` folds everything. The state is kept per page.
- Right-click the title to rename, change the width, fold, open the settings or **close** it. Closing hides it and keeps its settings; Config → Widgets switches it back on.
- The arrow keys walk through a widget's rows; `Enter` does what a click does. See [§7.4](#74-acting-on-a-category-or-widget).
- Widgets that read something outside refresh on their own interval, and not at all while the tab is hidden.

**Calendar** — your server fetches the feed (the private ICS address from your calendar app, not its web page), shares one copy between widgets and refreshes it every 15 minutes. A recurring event shows its first stated occurrence. Changing the address redraws the widgets at once.

**RSS** — your server fetches each feed and caches it for 15 minutes. A headline shows the feed's summary on hover or focus. Rows past the row count fold into a **more** row. A feed that fails does not empty the tile.

### 11.4 System widgets and what they need

Processor, Memory, Disks and Containers report on the machine nextDash runs on. Running the binary directly needs no setup. In a container:

**Processor and Memory** usually work as they are — `/proc` is not namespaced. Mount it only to be explicit:

```yaml
volumes:
  - /proc:/host/proc:ro
environment:
  - NEXTDASH_HOST_PROC=/host/proc
```

**Disks** need a mount. Mount the disks under a prefix, keeping their names, and point `NEXTDASH_HOST_ROOT` at the prefix:

```yaml
volumes:
  - /mnt:/host/root/mnt:ro,rslave        # Unraid, most Linux
  # - /volume1:/host/root/volume1:ro,rslave   # Synology, QNAP
  # - /:/host/root:ro,rslave                  # everything
environment:
  - NEXTDASH_HOST_ROOT=/host/root
```

Name the disks in the widget as the machine knows them — `/mnt/user`, `/volume1`. Mounted, readable disks are offered under the field.

**Containers** need the Docker socket. Read-only still exposes the daemon's whole read API — every container, image, environment and mount. Use a socket proxy if that is too much.

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
environment:
  - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
```

| Variable | Needed for |
|---|---|
| `NEXTDASH_HOST_PROC` | Processor, Memory (optional; default `/proc`) |
| `NEXTDASH_HOST_ROOT` | Disks (required) |
| `NEXTDASH_DOCKER_SOCKET` | Containers (required; unset hides the widget) |

**On Unraid** these are rows in the container template (Docker → nextDash → Edit):

| Config Type | Name | Container Path / Key | Host Path / Value | Access Mode |
|---|---|---|---|---|
| Path | Host proc | `/host/proc` | `/proc` | Read Only |
| Path | Host disks | `/host/root/mnt` | `/mnt` | Read Only |
| Path | Docker socket | `/var/run/docker.sock` | `/var/run/docker.sock` | Read Only |
| Variable | Host proc | `NEXTDASH_HOST_PROC` | `/host/proc` | — |
| Variable | Host root | `NEXTDASH_HOST_ROOT` | `/host/root` | — |
| Variable | Docker socket | `NEXTDASH_DOCKER_SOCKET` | `/var/run/docker.sock` | — |

Then name `/mnt/user` and `/mnt/cache` in the Disks widget. A user share reports the pool total; `/mnt/diskN` reports one disk. Mount `/` instead of `/mnt` to reach disks outside the array.

**Good to know.** A source that is not mounted says so on the tile. The processor figure appears from the second reading on. Each widget has its own refresh interval with a sensible minimum. On Docker Desktop for Mac or Windows the figures describe Docker's Linux VM, not your computer.

### 11.5 The Custom widget

The Custom widget reads figures from any service that answers with JSON.

- **Address and method** — any `http`/`https` endpoint, `GET` or `POST`. Your server makes the request, so a machine on your network is reachable and no key reaches the browser. The widget only reads.
- **Sign-in** — an API key in a header, a key in the address (the stored address keeps a `YOUR_KEY` placeholder), a username and password, or a session sign-in for services such as qBittorrent. Secrets are stored in their own file and left out of backups unless you include stored tokens. A saved key shows as *Set*; the eye button reveals it. Stored sign-ins can also be used by health checks ([§13.1](#131-availability-modes)).
- **Paths** — `server.disk[0].used` walks objects and arrays; `sensor.p1_meter` finds a list entry by its own name; `[entity_id=sensor.p1_meter].state` is the explicit form. Up to eight figures. A path that stops matching is marked, not shown as zero.
- **Shape** — *Count*, *Size* (bytes), *Data size* (with the unit the service counts in), *Speed* (bits per second, `1.046 Gbps`), *Power* (`4.5 kW`), *Temperature* (in the unit set for the weather; not converted), *Percentage*, *Duration*, *Milliseconds*, *Time ago* or *Text*.
- **Decimals** — *Auto* or 0–3, also for numbers the service sends as text.
- **Size** — *Normal*, *Large*, *Small*, or *Bar* for a percentage.
- **Or a list** — point at an array and the tile shows up to twenty rows.
- **Refresh every** — 30 seconds to 24 hours, five minutes by default. One answer is shared by everyone viewing the dashboard.

**Try it.** **Ask now** makes the request as the panel stands — including a key you only just typed — and shows the answer (with a search box), what the tile would show, and the request's method, host, status, time, size and whether a sign-in was sent. The **Found** column shows what each path read. **Keep watching** repeats the request every 5–60 seconds for up to five minutes. Nothing is saved by asking.

**Refresh now** — right-click the tile's title to skip the cache. It needs the write token if the install has one.

An answer has eight seconds to arrive and is read up to one megabyte. There is no arithmetic.

**Twenty-eight services come filled in:**

| Group | Services |
|---|---|
| **Media & downloads** | Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Overseerr / Jellyseerr, Tautulli, Jellyfin / Emby, Plex, Immich, qBittorrent, SABnzbd, NZBGet |
| **Network** | Pi-hole (v6 and v5), AdGuard Home, Traefik, Speedtest Tracker |
| **System** | Proxmox VE, TrueNAS, Glances, Syncthing |
| **Apps** | Nextcloud, Paperless-ngx, Home Assistant, Grafana, ntfy |

A preset fills in a sample address, the useful path, the figures with labels and shapes, and the sign-in type, and says where to find the key. Where a header needs a word before the token (`Bearer `, `Token `), the preset puts it in the box. Everything stays editable.

---
## 12. 🎨 Appearance

**Config → Appearance** opens on five tiles, each showing what it is set to now: **Theme**, **Grid**, **Header & buttons**, **Date & weather** and **Custom themes**. Behind the tiles are seven tabs: Theme, Layout, Header and buttons, Action bar, Date & weather, Display and Custom themes.

### 12.1 Themes

nextDash ships **121 theme families**, each with a light and a dark half — 242 themes in all. A fresh install starts on **Retro CRT**.

- **The theme browser** — **Browse…** under Appearance → Theme, or **`Shift + A`** on the dashboard. One card per family with a light/dark switch, a search box, segments for *All*, *Favourites*, *Light* and *Dark*, and a star per family. Moving through it previews each theme on the real dashboard; nothing is saved until you pick one, and **Esc** puts back what you had.
- **Quick mode** — switches between the light and dark half of your family.
- **Follow system dark mode** — shows the light half by day and the dark half by night, following the operating system, also in a background tab.
- **Random theme** — **Off**, **On page refresh**, or **On view change** (switching between bookmarks, config, inbox, health or pages). Your saved theme stays underneath. With follow-system on, only halves that match the current mode are picked.
- **`:theme <name>`** and **`:dark`** switch from the command palette.

#### ✨ Gloss themes

Most themes are matte. Ten **Gloss** families catch the light, each in a light and a dark half:

| Family | Character |
|---|---|
| **Gloss Obsidian** | Black glass with a cyan accent |
| **Gloss Chrome** | Polished metal, cool greys |
| **Gloss Candy** | Lacquered pink |
| **Gloss Amber** | Warm amber |
| **Gloss Emerald** | Deep green |
| **Gloss Sapphire** | Deep blue |
| **Gloss Neon Tide** | Neon teal on deep blue |
| **Gloss Pearl** | Soft pearl and lilac tones |
| **Gloss Rose Gold** | Warm rose metal |
| **Gloss Ultraviolet** | Saturated violet |

Their surfaces carry a **lit band** and a brighter top edge, and they pair that with saturated accents, glass, rounder corners and a glow — lacquer rather than paint. Every name starts with *Gloss*, so they sort together; type `gloss` in the theme browser to see them all.

The shine is drawn with the glow. When you pick a Gloss theme while **Glow** is off, nextDash offers once to switch it on; with Glow off, a Gloss theme looks matte.

**Any theme can shine.** The **Gloss** slider in the theme editor (Custom themes) sets the sheen — how much light a raised surface catches — for a custom theme or a recoloured packaged theme. Zero draws no sheen.

### 12.2 Surfaces

These change how any theme is drawn.

| Setting | Choices |
|---|---|
| **Depth** | **Flat** (default) · Soft · Rich · Glass — Soft and Rich add a tint in the greys, raised surfaces and a faint wash of light behind the page; Glass blurs what is behind a surface. Menus are never blurred. |
| **Glow** | **Off** (default) · Soft · Full — how far the theme's colour carries around a surface. Flat has no glow. |
| **Text contrast** | Soft · Normal · High · Maximum — how far the fainter text sits from its surface |
| **Theme backdrop** | On · Off — the backdrop each theme builds from its own colours |
| **Backdrop** | Follow the theme · Dots · Grid · Lines · Hatch · None |
| **Favicon harmonization** | Off · On, with **Muted**, **Tinted** or **Overlay** and an intensity. Stored per theme, so the light and dark halves are set separately. |

`:depth`, `:glow`, `:contrast`, `:backdrop`, `:pattern` and `:harmonize` change these from the command palette.

### 12.3 Type and background

- **Typeface** — Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans or System UI — or **upload a font file**.
- **Weight** — Normal, Semi-bold or Bold. **Size** — seven steps from XS to XL; pointing at a size previews it.
- **Background** — **Auto** (follows the theme), **None**, **Gradient** or **Image URL**. **Opacity** fades it so the bookmarks stay readable. A background of your own is drawn over the theme backdrop.

### 12.4 Custom themes

**Appearance → Custom themes** builds your own theme.

- **Your themes** — add, edit, reorder, delete, **⤓ export** to a JSON file, and **Import theme…**.
- A custom theme can set everything a packaged theme can — colours, depth, glow, glass, corner radius and **Gloss** (the sheen) — and has a light and a dark half, like the built-in themes.
- A contrast check warns when text is too faint against its background.
- **Packaged themes** — recolour any theme that ships, or the base light and dark palettes. **Reset defaults** puts a theme back.
- Changes preview live on the dashboard behind config; leaving the tab drops an unsaved preview. On a phone the editor is read-only.

### 12.5 Grid: layout and display

**Layout**

| Setting | What it does |
|---|---|
| **Columns per row** | 1–6 |
| **Layout preset** | Default, compact, cards, masonry, list, launcher (large icon tiles) and more |
| **Density** | Auto, comfortable, compact, dense — one setting for the dashboard, health and the inbox |
| **Category spacing** | Snug · Balanced (default) · Airy — the gap between rows of categories |
| **Page margins** | Snug · Balanced (default) · Airy — the empty band left and right |
| **Pack columns tightly** | Categories fill the columns without waiting for a full row |
| **Hide empty categories** | |
| **Launcher icon size** | For the launcher preset |
| **Always collapse categories** | Every category starts folded |
| **Items per category** | How many bookmarks show before *+ N more* |
| **Categories across columns** | New categories spread or not; where *turn spreading off* applies |

Small drawings beside the shape settings show what a value looks like.

**Display**

| Setting | What it does |
|---|---|
| **Shortcut letters** | **Always** · **On the row I am on** · **Never** |
| **Row highlight** | How far a row lights up when you move to it: subtle (default) or strong |
| **Status and ping** | Status colours, a loading state, ping times |
| **Page name in the browser title** | |
| **Tags on rows** | And how many show before a count |
| **Link preview cards** | Off · On hover · Keyboard only, the hover delay, and which rows the card shows ([§4](#4-the-dashboard)) |
| **Branding** | The page title and favicon, also used when nextDash is installed as an app |

### 12.6 Header and action buttons

See [§4](#4-the-dashboard) for what each part does. The settings:

- **Header and buttons** tab — button style (plain or boxed), page tabs on/off, page names in tabs, page switcher style, page tabs before *+N*, the dashboard title, and the dashboard, inbox, health and config buttons.
- **Action bar** tab — where the fixed buttons stand (a column on the right by default), action buttons before *+N*, show the action buttons, show the key on each button, slide a docked bar away (2 seconds by default), and one switch per button. See [§4](#4-the-dashboard) for what sliding away looks like and how the bar comes back.

Each group has **Show all / Hide all**.

### 12.7 Date and weather

- **Date & time** — show date, show time, date format, 12- or 24-hour clock.
- **Header** — where the clock and weather stand: beside the view name, in a column of their own, or on their own line.
- **Weather** — on or off, browser location or a city, Celsius or Fahrenheit, refresh interval. The Weather widget reads the same settings.
- **Calendar** — **Calendar URL** (the link in the date popover) and **Calendar feed URL (.ics)** (what the Calendar widget reads).

### 12.8 Finding and resetting

Each tab has a filter beside **Only changed**. **More settings** in each group holds the less-used ones. **↺** resets one setting, **Reset panel** a whole group. `Ctrl/Cmd + Shift + K` finds any setting ([§15](#15-config)).

---

## 13. 💓 Health and monitoring

### 13.1 Availability modes

Every bookmark has one of three modes:

| Mode | What happens |
|---|---|
| **Off** | Never checked |
| **Periodic** | Checked now and then; flagged when broken |
| **Monitor** | Checked by the server on its own interval (5 minutes to 24 hours, default 15 minutes), with 30 days of history, uptime, outages and alerts. Includes everything Periodic does. |

Set the mode in the bookmark form, the side panel in Config → Bookmarks, the right-click menu, with **`Shift + C`**, or with **`c`** in the health view. On a monitored row the menu also shows the **check interval**: 5m, 15m, 30m, 1h, 6h or 24h.

**Behavior → Status & health** holds the rest:

| Group | Settings |
|---|---|
| **Checks in this browser** | How often, skip fast pings, retries for offline bookmarks |
| **Monitored bookmarks on the dashboard** | How much they stand out: only when there is a problem (default), always, or never |
| **Checks on the server** | Re-check in the background and how often, the **check timeout** (5–30 s), **spot pages that answer 200 but say "not found"**, and when certificate warnings start |
| **Downtime alerts** | See [§13.7](#137-alerts) |
| **Maintenance windows** | See [§13.8](#138-maintenance-windows) |
| **Browser notifications** | See [§13.7](#137-alerts) |

**What a check records.** A failure stores its cause — DNS, timeout, refused, TLS, redirect, content or an HTTP status. A failed check is tried again five seconds later and only counts if that fails too. A page that asks *are you a robot*, a rate limit or anything else unclear reads as **unknown**, not broken. Certificates are read from every HTTPS check.

**Services behind a sign-in.** In the health view, **Expected response** on a row offers:

- **Address to check instead** — for example a status endpoint, while the bookmark keeps its own address.
- **Sign in with** — a stored sign-in. Sign-ins are created in a Custom widget's settings and kept in their own file, outside backups unless you include stored tokens. A sign-in is never sent when a check is redirected to another host.
- **Accept a certificate this machine does not trust.**

### 13.2 The health view

Open it with **`Shift + H`**, the pulse icon, `:health` or `/#health`.

```
Left column                      Header (stays in place)
  Score · trend · broken           Work through · Rot report · ⋯ · ℹ · density
  Uptime 24h · report age
  Filters, each with a count       The list: score, status, last opened, actions
  Sections → All monitors          …or the panel about all monitors
```

**The left column.** At the top are readouts: the score, the trend with a sparkline, the broken count, uptime over 24 hours and the report's age. Below are the filters:

| Filter | Shows |
|---|---|
| **Broken** | Links that fail |
| **Content** | Pages that answer but fail an expected-response test |
| **Drift** | Pages that changed from their baseline |
| **Duplicates** | The same address more than once |
| **Shortcut conflicts** | Two bookmarks with the same shortcut |
| **Stale** | Not opened in over 30 days |
| **Unused** | Never opened |
| **Unchecked** | Never checked |
| **Missing preview** | No title, description or image |
| **Certificates** | On a host whose certificate expires soon |
| **Healthy** | Nothing to report |
| **Monitored** | Set to Monitor — red while one is down, green while all answer |
| **Ignored** | Conditions you set aside |
| **All** | Everything |

A filter with nothing in it hides until it fills; Broken, Content, Duplicates, Unchecked and All always show. A bookmark can match several filters. A sentence under the toolbar says what the active filter selects. **All monitors**, under *Sections*, swaps the list for the panel about all monitors ([§13.4](#134-monitoring-over-time)) and has its own address, `#health/monitors`.

**The header** holds **Work through**, **Rot report**, the **⋯** menu (Healthy over time and the exports), the **ℹ** explainer and the density buttons. It says how old the report is; **Retest all** rebuilds it. Your last filter and sort return on the next visit.

**Each row** shows a score (0–100), its status, the check mode as a button, when you last opened it, and how long it has been failing. **Group by site** folds rows by host. Rows you have acted on keep their place, dimmed and marked *handled*, until you change the filter or reload.

**The score.** Click the badge or press **`s`**. Every bookmark starts at 100: broken −60, duplicate −15, shortcut conflict −15, never checked −10, stale check −5, no preview −5. Not opening a bookmark costs nothing.

**Fixing a row.** The row menu (**`m`**, the ⋯ button, or a right-click) offers re-check, open, show on the dashboard, edit, **detect redirect**, refresh title, refresh favicon, **find in Web Archive** or point the bookmark at the last good copy (the old address goes into the note), save a local copy, copy URL, share and delete. **`n`** or **`z`** sets one condition aside for a bookmark you judged fine. **Merge** keeps one of two duplicates with both sets of tags and notes. On *Missing preview*, **Fetch previews** asks every page for its title, description and image.

**Keys:**

| Key | Action |
|---|---|
| `j` / `k`, arrows | Move |
| `g` / `G`, `Home` / `End` | First / last row |
| `Enter` / `Space` | Open the URL |
| `s` | Score breakdown |
| `p` | Re-check |
| `c` | Availability mode |
| `m` | More actions |
| `i` | Monitor statistics |
| `f` | Work through |
| `x` / `X` / `Ctrl+A` | Select one / all the filter shows (again to untick) |
| `n` / `z` | Ignore a condition |
| `R` or `?` | Reload the report |
| `Esc` | Close a menu, clear the selection, or leave |

### 13.3 Working through the list

**Several rows.** Tick rows (or `x`, or **Select all** in the ⋯ menu, which reads **Deselect all** once they all are). The bar offers **Set checking**, **Re-check**, **Open**, **Copy links**, **Mute alerts** / **Unmute**, **Follow redirects** (asks each row where it goes now and applies the answers after one confirmation), **Accept drift**, **Rebuild previews**, **Refresh favicons**, **Save a copy on this disk** and **Delete**. The slow ones run one page at a time behind a progress bar. A row that changed since the report was built is skipped rather than deleted. Ticks survive a filter change; the bar says how many are hidden. On a filtered list, a button switches all visible rows to Periodic or Monitor at once — never on the unfiltered list.

**Work through** (**`f`**) shows one row at a time with large actions: re-check (`p`), open (`Enter`), delete (`d`), **ignore for 30 days** (`z`), skip (`j`) and back (`k`). It starts at the row your cursor is on; `Esc` leaves and keeps your place.

**Ten links, two minutes.** When at least five links want attention, a card on the dashboard names them — *"10 links to review: 4 broken, 3 never opened, 3 not opened in a year"* — and **Start** runs a session over the worst ten. It ends with a count, offers **Another ten**, and **Done for today** puts it away until tomorrow.

**Rot report** lists what has gone, what has moved or been rewritten, what has failed for over a month, what is broken and never opened, and what broke this week.

**The tour.** The first visit to the health view plays a six-step tour around one worked example. Behavior → General → Onboarding can play it again.

**Deep links:**

| Parameter | Example | Effect |
|---|---|---|
| `hv_filter` | `/?hv_filter=broken#health` | Choose a filter |
| `hv_id` | `/?hv_id=1:4#health` | Select row 4 on page 1 |
| `hv_sort` | `/?hv_sort=name#health` | Sort |
| `hv_q` | `/?hv_q=github#health` | Search |
| `page` | `/?page=2#health` | Page context |
| `hv_refresh` | `/?hv_refresh=1#health` | Retest all on load |

### 13.4 Monitoring over time

**A monitored row** shows a heartbeat bar, uptime over 24 hours followed by the number of checks behind it, and a response-time sparkline. **⤢** or **`i`** opens the full picture: a response-time chart with minimum, average and maximum (point at it, or use `←`/`→`, to read one measurement), uptime over 24 hours, 7 and 30 days, the check interval and last check, and every outage with start, length and cause. A window without samples reads *no data*; a window the history cannot fill says how much it covers.

**All monitors** shows uptime pooled over every check (24 h, 7 d, 30 d), how many monitors answer now and the average response time. Below that: **Least available (7 days)**, **Slower than last week** and **Outages** across the collection.

**Healthy over time** (⋯ menu) draws a chart once the health view has been opened on two days. Buttons switch between healthy %, score, broken, monitors down, stale and unchecked. One point is kept per day for 90 days in `data/health-trend.json`; a missed day leaves a gap.

**Exports.** **Export** writes the filtered list as CSV (with interval, uptime, last response and check count for monitored rows). **Export history** (on *Monitored*) writes every check: time, up or down, ping and HTTP status. Both guard against spreadsheet formulas and carry a UTF-8 BOM. Check history is kept for 30 days in `data/health-history.json` and is part of backups.

### 13.5 Expected response

On a monitored row, **Expected response** opens a panel in the row:

- **Text the page must contain** — a phrase that only appears when the page works. **Fail if present instead** reverses it.
- **Status codes that count as healthy** — `200`, `200-299`, `200,301,401`. By default anything below 500 counts. A code that cannot be read is ignored.
- **Watch for redirects, retitling and rewrites** — drift ([§13.6](#136-drift)).
- **Do not alert me about this bookmark** — muting ([§13.7](#137-alerts)).

Failures of these tests go to the **Content** filter, not Broken. Clearing both test fields clears the failure.

**Pages that say "not found" with a 200.** With **Spot pages that answer 200 but say "not found"** on, a monitored check reads the title and opening text for a not-found message in five languages, and once a day per site asks the host what it does with an address that cannot exist. A site that sends everything to a sign-in page is left alone.

### 13.6 Drift

**Drift** notices a page that still answers but is no longer the page you saved. Tick **Watch for redirects, retitling and rewrites** on a monitored row. The next check becomes the **baseline**; every later check is compared with it.

- **Redirect drift** — the link lands somewhere else. http→https, `www.`, trailing slashes and tracking parameters are ignored.
- **Title drift** — the title changed. Titles like *Domain for sale* or *404* are named outright.
- **Content drift** — the text became a different page.

One finding per check, in that order. The row badge reads *Moved*, *Retitled* or *Changed*; the **Drift** filter lists them. A page that returns to its baseline clears itself. **Accept drift** on selected rows clears the finding and drops the baseline, so the next check records the page as it is now. Drift reads the page body, so it is opt-in and for monitored bookmarks only.

### 13.7 Alerts

**Downtime alerts** (Behavior → Status & health) post when a monitored bookmark goes down and again when it recovers, with how long it was down.

| Service | Needs |
|---|---|
| **Slack**, **Discord** | Webhook URL |
| **Telegram** | Bot URL and chat ID |
| **Gotify**, **ntfy** | URL |
| **Pushover** | Application token and user key |
| **Raw JSON** | Your own receiver's URL |

- **Alert after** — failures in a row before a bookmark counts as down (default 3, 1–10).
- **Send test alert** — sends one made-up failure the same way a real one goes.
- **ntfy** alerts carry **Open link** and **Health** buttons, and a failure is sent at a higher priority than a recovery. Fill in **Address of this dashboard** for the Health button.
- Local addresses are refused unless *Allow local bookmarks* is on.
- **Many at once** — when a host takes many bookmarks down together, the alerts are collapsed into one message. Certificate warnings are always separate.
- **Certificates** — warnings at 30, 7 and 3 days before expiry, through the same channels.

**Muting one bookmark.** Tick **Do not alert me about this bookmark** in its Expected response panel. It is still checked and shows as down with a *Muted* badge; only the message is held back. Un-muting during an outage still alerts. **Mute alerts** and **Unmute** in the selection bar change several rows at once.

**Browser notifications** reach a device even with nextDash closed. Switch them on from the dashboard card or under Behavior → Status & health, then press **Enable on this device** and allow notifications. A test notification follows.

| Notifies about | Default |
|---|---|
| Downtime and recovery | On once enabled |
| Automatic backup results | Off |
| A new release | Off |

They need a secure context: Safari and every browser on iPhone and iPad require HTTPS (not `http://localhost`); desktop Chrome, Edge and Firefox also accept `http://localhost`. On iPhone and iPad, add nextDash to the home screen first. Subscriptions live in `data/push-subscriptions.json`; deleting it unsubscribes every device. **Show the invitation again** brings the card back.

### 13.8 Maintenance windows

A window is a recurring period when downtime is expected — days, a start and an end. An end before the start runs past midnight. Windows apply to every monitor.

Inside a window, checks still run and the heartbeat still records them, but a failure opens no incident, does not count against uptime and sends no alert. A failure that continues after the window raises the alarm as usual.

### 13.9 Fresh

**Fresh** shows whether a bookmarked site has published something since you last opened it.

- Switch it on under **Behavior → Fresh**. It reads each saved page once for an RSS or Atom feed and remembers pages without one for a month. **Find feeds now** repeats the round and says how many bookmarks publish a feed.
- A bookmark with news carries a count on its row, and the **Fresh** collection lists them, newest first. Opening the bookmark clears the count.
- Feeds are polled on the background re-check interval with conditional requests. A feed that fails five times in a row is dropped.
- The bookmark editor shows a **Feed** line when there is one. `status:feed` / `-status:feed` search for them. **Mark rows that publish** (off by default) puts a quiet dot on those rows.
- Fresh stores no articles, only counts. It is off by default because it contacts other servers on a schedule. A walkthrough is under Config → Help → Monitoring.

### 13.10 Keeping a copy of a page

Set up under **Data & backups → Sources**.

- **Web Archive** — **Archive new bookmarks** asks the Internet Archive to keep a copy the day you save a link. An archive.org key pair ([archive.org/account/s3.php](https://archive.org/account/s3.php)) raises the daily allowance; **Save a copy…** tests it. The panel says what became of a capture.
- **Local copies** — saves a whole page (text, styling, images) as one file in your data directory, using [monolith](https://github.com/Y2Z/monolith), which the container includes. Pages up to 52 MB. **Bookmarks → Local copies** lists copies per bookmark, says why a copy failed or saved an empty page, and can remove them all (it says how much space that frees).
- **archive.today** — a second archive that keeps what it captured.

In the health view, **Find in Web Archive** reads the archive's index for the last capture that was a real page.

---

## 14. 📥 Inbox

The inbox holds links you want to keep before you decide where they go. Items live in `data/inbox.json`.

### 14.1 Getting links in

- **Paste** a URL on the dashboard and choose **Save to Inbox** — or set **Always save to Inbox** under Behavior → Inbox.
- **The extension** — **Save to Inbox** in its popup, the right-click entry, or `Ctrl/Cmd + Shift + U`.
- **The share sheet, the bookmarklet and `/add`** — see [§19](#19-browser-extension-and-capture).
- **The API** — `POST /api/inbox`.

A URL already in the inbox is not added again: a toast says *Already in Inbox* and the view jumps to it.

### 14.2 The view

Open it with **`Shift + I`**, **`0`**, the inbox icon or `:inbox`.

- **Filters** in a left column, each with its count: All (called *Active*), Unread, Snoozed and With note (the last two only when they hold something). *This week* is a readout above them.
- **Narrowing** — by site, by tag (click a tag chip) and by search. Every count follows what is shown, and *Mark all read* becomes *Mark shown read*.
- **Sort** — newest first (default), oldest first, title or site.
- **Rows** follow the app-wide density; the header stays in place.
- **The address** keeps filter, sort, site, tag and search (`ib_filter`, `ib_sort`, `ib_domain`, `ib_tag`, `ib_q`); filter, sort and site also return next time.
- The **ℹ** explains the inbox; a sentence under the toolbar explains the active filter.

### 14.3 Acting on links

| Key | Action |
|---|---|
| `j` / `k` | Move |
| `g` / `G` | First / last |
| `Enter` | Open |
| `p` | Promote to a bookmark |
| `r` | Mark read |
| `n` | Note |
| `z` | Snooze |
| `x` | Tick and move on |
| `Shift + ↑/↓`, `Ctrl/Cmd + A` | Extend / select all shown (again to untick) |
| `d` | Delete (undo in the toast) |
| `t` | Triage |
| `R` | Reload |
| `Esc` | Clear the selection |

- **Read** — a link is unread until opened or kept. Right-click to mark it unread again.
- **Snooze** — three hours, tomorrow, the weekend, next week, or a date (waking at 09:00). A snoozed link is left out of every count; a line under the list says how many are asleep. **Wake now** brings one back.
- **Notes and tags** — plain-text notes; tags from the capture show as chips, and can be edited from the right-click menu.
- **Promote** — opens the bookmark form filled in, with every page and category. The inbox entry goes when the bookmark is saved.
- **Several at once** — promote (to one page), open, copy links, mark read, snooze, delete. **Select all** in the ⋯ menu ticks every link the filters leave, and reads **Deselect all** once they all are.
- **Mark all read** and **Clear read** — for the whole (shown) list. Clear read leaves snoozed links alone.
- **Stats** — how many links were added, promoted and deleted, and how long links wait.
- **Export and import** — CSV and JSON of what is shown; **Import** reads a JSON export back and skips links already there.

### 14.4 Triage

**Triage** (the button, `t`, or `:inbox triage`) shows one link at a time: `j`/`k` move, `o` or `Enter` opens, `p` promotes, `r` or `Space` keeps, `d` or `Delete` removes, `Esc` returns to the list. It follows the filter and sort you had.

### 14.5 Settings

- **Behavior → Inbox → Enable the inbox** — off removes the inbox from the header, stops its keys and command, and adds pasted URLs as bookmarks.
- **Paste destination** — ask each time, always add a bookmark, or always save to the inbox.
- In `settings.json` only: `inboxMaxItems` (default 500; past it the oldest links are silently dropped) and deduplication by URL (on). Undoing a delete at the cap restores the link with its original date; with no room at all, the undo says the inbox is full.

The first visit plays a seven-step tour. Behavior → General → Onboarding can play it again.

---
## 15. ⚙️ Config

Config is a **view inside the dashboard**: same tab, no page load.

| To open | To leave |
|---------|----------|
| **`Shift + S`**, **`<`**, the gear, or `/#config` | **`Escape`** (when nothing is open on top and you are not typing), **`Shift + S`**, **`<`**, `0`–`9`, or the browser's Back button |

Config reopens on the section and tab you left, for five minutes after you leave. A link like `/#config/appearance/layout` opens a section and tab directly and wins over the remembered place; `/#config/bookmarks/<pageId>` opens Bookmarks for one page. Moving between sections is not a browser history step.

### 15.1 The sections

| Section | What lives there |
|---------|------------------|
| **Overview** | The figures of your collection (bookmarks, pages, categories, tags, monitored, with shortcut, pinned, last edited), **Needs attention** with a button per item, **How you use this collection**, the **cleanup score**, and **Health at a glance**. The running version is at the foot. |
| **Appearance** | Theme · Layout · Header and buttons · Action bar · Date & weather · Display · Custom themes ([§12](#12-appearance)) |
| **Bookmarks** | List · Tags · Tag suggestions · Your rules · Settings · Local copies ([§15.4](#154-bookmarks)) |
| **Structure** | Categories · Pages · Finders · Collections ([§9](#9-pages-categories-and-collections)) |
| **Behavior** | General · Search · Inbox · Fresh · Status & health · Privacy ([§15.5](#155-behavior)) |
| **Data & backups** | Backups & data · Sources · Webhooks · Icons & previews · Trash · Reset ([§17](#17-data-backups-and-import)) |
| **Widgets** | Widgets · Types ([§11](#11-widgets)) |
| **Statistics** | Overview · Activity · Content · Inbox · Health ([§16](#16-statistics)) |
| **Help** | The in-app guide |
| **Logs** | Server logs · Activity trail ([§18](#18-logs)) |
| **About** | About nextDash · News & features |

Old addresses still land in the right place — for example `/#config/pages-tags` opens Structure and `/#config/data-backups/logs` opens Logs.

### 15.2 Hubs, groups and saving

**Appearance** and **Behavior** open on **tiles**. Each tile names a group and shows what it is set to. Inside a group, the most-used settings come first and **More settings** holds the rest; the tab strip reaches the other groups without going back.

**Every change saves the moment you make it**, confirmed by a short message. The exceptions are forms with their own **Save** button — the bookmark form and a widget's settings. Config only writes what changed.

- **ℹ** beside a setting explains it.
- **↺** puts one setting back to its default; **Reset panel** puts a whole group back (it asks first).
- **Only changed** hides settings that are still on their default; the filter beside it narrows the tab by label, hint or option.

### 15.3 Finding a setting

**`Ctrl/Cmd + Shift + K`** — or **Find settings** below the section rail — searches every section, tab, setting and help topic. It also finds settings by related words (*uptime*, *wallpaper*, *hotkey*) and by their current value (*8099*, *Monitor*), and shows that value beside the result.

**Settings per device.** Settings live on the server, so every browser shows the same dashboard. **Keep settings on this device only** (Behavior → General) keeps appearance and layout in this browser instead. The few settings that stay shared — such as the custom favicon and font, collections and the action bar position — carry an **all devices** mark.

### 15.4 Bookmarks

**The list** is a workbench in three parts.

- **The rail** narrows the list: a search (`/`; it matches name, URL, category, note, shortcut and tags), **Views** (never opened, opened once, without tags, not on HTTPS, and more), **Pages**, **Categories**, **Tags** and **Health** (healthy, broken, monitor down, never checked), each with a count.
- **The list** shows what is left, grouped by page and category, with a sort (page order, last opened, most opened, pinned first and others). Rows show icon, name, host, tags, open count and last opened. Only the rows near the screen are drawn, so thousands of bookmarks stay fast.
- **The side panel** shows the bookmark in focus and edits it in place: name, URL, page, category, tags (with suggestions), shortcut, note, pin, availability checking and interval. Lists and checkboxes save on change, text fields when you leave them; `Escape` puts the old value back. It also shows health and usage, and offers **Open**, **Edit in dialog** (`Shift + E`), **Show on dashboard**, **Refresh favicon** and **Delete**.

**Several at once.** Tick rows and the side panel edits the selection: page, category, tags (add, replace, remove), pin all / unpin all, checking and interval. Fields that differ read *mixed*. **Apply to N** writes the changes; **Export CSV**, **Refresh favicons** and **Delete N** act on the selection. Bulk changes can be undone from the toast. A selection survives a filter change.

**Keys:** `j`/`k` or arrows move, `g`/`G` first and last, `x` ticks, `Enter` or `o` opens, `Shift + E` opens the dialog, `m` the row menu, `c` the checking menu, `/` the search.

**On a narrow window** the rail becomes a drawer and the side panel a sheet. **Hide details** folds the side panel away. What you filtered to is kept in the address, so a filtered list is a link.

**Add Bookmark** opens the full form, on the page the list is filtered to.

The other tabs:

- **Tags** — rename or delete a tag everywhere ([§10.3](#103-managing-tags)).
- **Tag suggestions** and **Your rules** — [§10.4](#104-tag-suggestions).
- **Settings** — what a new bookmark starts with (checking mode, monitor interval), how the list opens and how many rows load, when bulk actions ask first, the stale threshold, and the archive used for *See an old copy*.
- **Local copies** — [§13.10](#1310-keeping-a-copy-of-a-page).

### 15.5 Behavior

| Group | Settings |
|---|---|
| **General** | Language; remember where you were on a page; **Lock layout**; global shortcuts, shortcut tooltips, the key legend under the grid; open links in a new tab; allow localhost and private-network bookmarks; onboarding (keyboard tips, review cards, tours, *Show quick-start card again*); **Hypr mode**; **Keep settings on this device only** |
| **Search** | Typing a bookmark shortcut, switch search mode, include finders, fuzzy suggestions, prefer matches that start with the query, keep search open when empty, the search hint |
| **Inbox** | Paste to quick-add, enable the inbox, paste destination |
| **Fresh** | Show what is new since you last looked, mark rows that publish, find feeds now |
| **Status & health** | [§13.1](#131-availability-modes) |
| **Privacy** | Analytics, the daily release check, posts from nextdash.cc |

### 15.6 Overview, Help and About

**Overview** is about your collection: its figures, what needs attention, how you use it, how tidy it is and whether the links answer.

**Help** has thirteen tabs: Getting started, Tips, Configuring, Appearance, Structure & bookmarks, Widgets, Search & keyboard, Health, Monitoring, Inbox, Statistics, Data & hosting and Logs. The search above the tabs covers every tab and About. Each topic has a 🔗 button that copies a link to it (`/#config/help/monitoring/health-cert`). A topic about something that can be switched off says whether it is on for you, with a button to the setting. **Tips** lists every keyboard tip, grouped, with its own filter. **Saving a link from anywhere** (Inbox tab) builds a bookmarklet for this install.

**Guided tours.** Seven walkthroughs run over the real page rather than a picture of it: *What has changed*, *First steps*, *Health*, *Inbox*, *Fresh*, *Widgets* and *Spreading a category*. Replay any of them from **Help → Guided tours**, or by name from the command palette — `:changes` opens the first. *What has changed* is the one offered by a card in the corner after an upgrade that moved things: its eight steps say where the pages, the action buttons, config, the list, the widgets, the tags and the themes now are, and where a default changed the step hands the old arrangement back in one click. The release notes stay separate — see *What's new* below.

**About** has two tabs: **About nextDash** (what the project is, and links to nextdash.cc, GitHub, jordibrw.nl and Ko-fi) and **News & features** (every post from nextdash.cc, every release and every setting worth switching on, with source filters, and a button that bookmarks nextdash.cc so Fresh counts its posts).

**What's new.** After an upgrade the release notes open once. After that, the **★** button, `:whatsnew`, or *See what's new* under Help open them, newest first, with up to 50 earlier releases. A small release can count towards the version number without appearing in this window; the [changelog](CHANGELOG.md) always has everything. With **Check GitHub for new releases** on (Behavior → Privacy), a newer release adds a dot to ★ and a toast.

### 15.7 Config keys

| Keys | Action |
|------|--------|
| `Shift + S` or `<` | Toggle config |
| `0`–`9` | Leave for the inbox or a page |
| `j` / `k` | Previous / next section |
| `g` / `G` | First / last section |
| Arrows, `Home` / `End` (section rail focused) | Move between sections |
| `Alt + ←/→` or `[` / `]` | Previous / next tab |
| `←` / `→` (tab strip focused) | Move between tabs |
| `↑` / `↓`, `Enter`, `g` / `G` (Structure lists, Bookmarks → Tags) | Move, edit, first / last |
| `/` | Search in Bookmarks; tag filter in Bookmarks → Tags |
| `←` / `→`, `Space` (choice row) | Choose |
| `Home` / `End` (slider) | Minimum / maximum |
| `Ctrl/Cmd + Shift + K` | Find a setting |
| `Escape` | Close a dialog → clear the selection → leave config |

Keys do not fire while you type in a field, except where a list says so. A legend under each tab shows the keys that apply there.

---

## 16. 📊 Statistics

**Config → Statistics** counts what you have and what you use. Everything is worked out from the data on your server.

| Tab | Shows |
|---|---|
| **Overview** | Headline counts, and **What this says** — the few conclusions worth acting on, each with a button |
| **Activity** | What you open, over 7, 30 or 90 days or all time: top bookmarks, pages, categories and shortcuts, finders, and how concentrated your opening is |
| **Content** | How bookmarks spread over pages and categories, opens per bookmark by category, tags, **cleanup candidates** (never opened, opened once, untagged, still on http, without an icon — *Show* opens them in Config → Bookmarks), duplicates and shortcut conflicts, and **Beyond bookmarks** (widgets, feeds, sources, trash, backups) |
| **Inbox** | What is waiting, the oldest unread, and how links get handled over time (lifetime counts in `data/inbox-stats.json`) |
| **Health** | The healthy share over time, uptime pooled over every monitor (24 h, 7 d, 30 d), certificates close to expiry, and how much of the collection has a local copy |

- **Showing** narrows every figure to one page. The inbox and the health report cannot be narrowed, and say so. The choice is not remembered.
- Tiles show the direction since last week. A tag or a table row leads to the bookmarks behind it.
- Each tab has a 🔗 to copy a link to it.
- At the foot: when the figures were worked out, **Refresh**, and **Export as CSV** for every tab. Open Inbox and Health first to include their figures.
- A category is counted per page: the same name on two pages is two categories.

---

## 17. 📦 Data, backups and import

**Config → Data & backups** has six tabs.

### 17.1 Backups & data

**Last backup**, **Next** and **Stored backups** tiles sit at the top. The last-backup tile turns red when a scheduled run failed.

- **Download backup** — a ZIP of everything, to your computer.
- **Make a backup now** — stores one on the server.
- **Create a backup automatically** and **How often** — every day, week (default), two weeks or month. A run happens whenever the newest backup is older than that, so frequent restarts do not skip it. The newest **three** are kept; `NEXTDASH_AUTO_BACKUP_KEEP` (1–50) changes that and `NEXTDASH_AUTO_BACKUP_DIR` (an absolute path) stores them elsewhere. The default place is `data/auto-backups/`, which is left out of backups.
- **What a backup carries** — a backup holds the whole data directory: bookmarks, pages, categories, finders, the inbox, settings, custom themes, check history, icons and uploads. Two switches decide the rest:
  - **Local copies of pages** — the largest part of a backup.
  - **Tokens and passwords** — source tokens, stored sign-ins and webhook keys. With them in, a restore needs nothing typed again, and the ZIP itself becomes a secret. They are written back with owner-only permissions.
- Left out on purpose: cached previews and pictures, the health cache, and browser push subscriptions — all rebuilt or re-registered after a restore.
- **Stored backups** — each with its age, size and contents (*1.7 MB · 412 bookmarks on 5 pages*), and **Download**, **Restore** and **Delete**. **Download all** saves them all.
- **Full backup (zip)** → **Import backup…** — restores a ZIP.

**Restoring** replaces all current data. First, nextDash checks the archive and writes a backup of the current data, so a restore can be undone. An archive without any bookmark page is refused. The import is atomic. A ZIP without `finders.json` or `health-history.json` leaves your current ones in place. Bookmarks with an invalid address are skipped and counted; the imported `settings.json` decides whether local addresses are allowed.

> In Docker, keep `data/` on a mounted volume, or automatic backups are lost with the container.

**Import & export bookmarks:**

| Button | What it does |
|---|---|
| **Import browser bookmarks…** | Reads the HTML file every browser exports — and Pocket, Pinboard, Raindrop, linkding, Shiori, Linkwarden and Karakeep. Shows a preview (*12 new, 3 conflicts*), asks for a page, and imports. Folders become categories; tags, notes and dates come along; duplicates are skipped; missing icons are fetched afterwards. |
| **Export bookmarks (HTML)** | The same format, for a browser or another tool |
| **Export bookmarks (CSV)** | Name, URL, category, page, shortcut, tags and notes, with translated headers |
| **Import bookmarks (CSV)** | Reads that file back onto the current page. Columns are matched by name; rows without a URL and existing URLs are skipped. |

**Settings** exports or imports `settings.json` alone.

| Situation | Use |
|---|---|
| Disaster recovery, moving servers | ZIP backup |
| Leaving a browser or read-later tool | Import browser bookmarks |
| Moving your collection elsewhere | Export bookmarks (HTML) |
| Tidying in a spreadsheet | CSV export and import |
| Links that keep arriving | Sources |

### 17.2 Sources

A **source** is a service bookmarks keep arriving from. Each panel asks for its token, where the bookmarks go, and offers **import now** and the last result. Every run **previews** before it writes, and remembers where it got to.

| Source | Needs |
|---|---|
| **GitHub stars** | A personal access token |
| **Raindrop.io** | A test token |
| **Hacker News favorites** | Your username |
| **YouTube channel** | A handle or channel id |
| **Mastodon bookmarks** | An access token from your instance |

nextDash only reads from these services. Tokens are stored in `sources.json` with owner-only permissions and left out of backups unless you include tokens. The **Sources** widget shows the last result of each.

The **Web Archive** and **Local copies** panels live on this tab too ([§13.10](#1310-keeping-a-copy-of-a-page)).

### 17.3 Webhooks

Webhooks tell another program the moment something happens here. Add a receiver with a name and an address and tick its events; nothing ticked means all.

| Event | When |
|---|---|
| `bookmark.added` | A bookmark is added, from any route |
| `bookmark.updated` | Name, URL, tags, note, category or pin changes |
| `bookmark.deleted` | A bookmark is removed |
| `health.down` | A monitored bookmark stops answering |
| `health.up` | It comes back |

Every delivery is signed with the [Standard Webhooks](https://www.standardwebhooks.com/) scheme:

```
webhook-id: msg_2b7f…
webhook-timestamp: 1756253400
webhook-signature: v1,K5s0…
```

The signature is HMAC-SHA256 over `{id}.{timestamp}.{payload}`, base64. The signing key is shown once, when you save; afterwards the panel only says a key is set. Keys live in `webhooks.json` with owner-only permissions.

A failed delivery is retried twice and then dropped; a `4xx` is not retried; redirects are not followed. **Send a test** posts one delivery and shows the status. Addresses follow the same rules as bookmark checks, checked when saved and again at delivery. Reading the list of receivers needs the write token.

The MCP endpoint is switched on from this tab as well — see [§21.6](#216-the-mcp-endpoint).

### 17.4 Icons & previews

- **Refresh favicons** — never, monthly, weekly or on every load; **Refresh all favicons** now. `:favicons fetch` does the same from the dashboard.
- **Image cache size** — 50, 200 or 500 MB, with the current use. **Remove cached images** empties it.
- **Refresh all link previews** / **Clear all link previews** — the stored titles, descriptions and images. Refreshing is one request per bookmark and shows progress.
- **Forget the scanned keywords** — what *Read their pages* kept for tag suggestions.

### 17.5 Trash

Deleted **bookmarks, pages and categories** stay in the trash for **30 days** (at most 500 entries). `:trash` opens it. Every route into the trash — the dashboard, health, Config → Bookmarks, single or bulk — lands here.

- **Search** by name, URL, tag, category or page.
- **Restore** puts a bookmark back on its page, at its old position.
- A deleted **page** is one entry (*Page · 12 bookmarks*) and comes back with its categories and bookmarks, in its old place.
- A deleted **category** comes back at its old position; its bookmarks were never removed.
- **Restore selected** restores each ticked entry on its own.
- **Delete forever** and **Empty trash** ask first.

A restore that cannot go ahead is refused and the entry stays: a bookmark or category whose page is gone needs that page first, and a page whose place was taken by another page cannot replace it.

### 17.6 Reset

- **Delete all bookmarks** — keeps pages, categories and settings. Asks once.
- **Reset all data** — deletes pages, categories, bookmarks, finders, settings, custom themes, uploads, icons and caches, and brings back the example bookmarks and default settings. Asks twice; you type **RESET** (or the word in your language).

Make a backup first — neither can be undone.

---

## 18. 📜 Logs

**Config → Logs** has two tabs.

### 18.1 Server logs

What the server has been doing — background jobs, imports, checks and every request — without shell access. Tiles show the number of lines, warnings and errors, and how long lines are kept.

```
INFO   health   checked 110 bookmarks, 2 failed, 1.4s
WARN   archive  dash.example could not be saved: the page is behind a login
ERROR  store    bookmarks.json could not be written: no space left on device
```

| Control | What it does |
|---|---|
| **Collect server log** (⚙) | Off by default. While off, nothing is captured and nothing is written. Turning it off keeps what was collected. |
| **Detail level** | **Quiet** (problems only), **Normal** (default) or **Verbose** (every step). Applies to the next line, here and in `docker logs`, without a restart. |
| **Show** | Everything, warnings & errors, errors only, or activity only. Only changes what you see; a note says which level is recording. |
| **Search** | On the message and the component, across the whole log |
| **Keep the log** | By age (1 hour to 30 days, or until cleared) or by number of lines (100–5000) — one or the other |
| **Refresh** | Off, or every 2, 5, 15 or 30 seconds while the tab is open |
| **Follow** | Keeps the newest line in view until you scroll up |
| **Copy** / **Download** | The lines to the clipboard, or the log as a `.log` file |
| **Clear** | Empties the log and deletes `server.log` and its rotated copies. Asks first. |

Lines are kept in memory and in `server.log` in the data directory (2 MB, two rotated copies). The same lines go to stderr.

> Anyone who can open config can read this log, including full webhook addresses where they were logged.

### 18.2 Activity trail

The **activity trail** is a machine-readable record — one JSON line per event — kept apart from the readable log. **Logs → Activity trail** chooses what goes in.

| Group | Channels |
|---|---|
| **Changes** | Changes, Check results, Refused access, Health rounds, Imports, Feed polls, Saved copies, Backups, Failed writes, Widget requests, Alerts sent |
| **Usage** | Bookmarks opened, Searches, Keyboard shortcuts, Navigation, Dashboard loads |
| **Client** | Browser errors |

**Changes** and **Check results** are on by default; the rest are off. **Open detail** sets what a *bookmark opened* record holds: *Off* (just the open), *Basic* (how it was opened, the default) or *Full* (also its rank in the results and the wait). **Reset panel** restores the defaults.

```text
{"ts":"2026-07-03T12:00:00Z","event":"bookmark.add","pageId":1,"name":"GitHub","url":"https://github.com","source":"dashboard"}
```

The trail goes to the server log buffer (visible with **Show → Activity only** while collecting) and, with `NEXTDASH_ACTIVITY_LOG_PERSIST=1`, to `activity.log`. The container log gets a readable sentence for the same event. Verbose lines never enter the trail.

Environment variables set the same things for the whole server; a choice made in the app wins over them:

```bash
NEXTDASH_ACTIVITY_LOG=mutate,status,security      # channels, or off
NEXTDASH_ACTIVITY_LOG_PERSIST=1                    # write data/activity.log
NEXTDASH_ACTIVITY_LOG_FILE=/path/to/activity.log
NEXTDASH_ACTIVITY_LOG_FORMAT=json                  # text (default) or json on stdout
NEXTDASH_ACTIVITY_LOG_URLS=host                    # full (default), host or off
NEXTDASH_ACTIVITY_LOG_SAMPLE=open=0.1,keys=0.25    # sampling per channel
NEXTDASH_ACTIVITY_LOG_MAX_AGE_DAYS=30              # delete old rotated files
NEXTDASH_ACTIVITY_OPEN_DETAIL=basic                # off, basic or full
NEXTDASH_LOG_LEVEL=info                            # error, warn, info or debug
```

Channel names: `mutate`, `status`, `security`, `health`, `sources`, `feeds`, `archive`, `backup`, `store`, `widgets`, `notify`, `open`, `search`, `keys`, `nav`, `session`, `clienterror`. Status checks for the same URL and result are logged once per ten minutes. URLs and searches can appear in the trail; treat the files as private.

---

## 19. 🔌 Browser extension and capture

### 19.1 The extension

The **nextDash Bookmark Saver** in `extension/` saves the current tab to a page or to the inbox (Chrome and Chromium).

**Install:** open `chrome://extensions/`, switch on **Developer mode**, click **Load unpacked** and choose the `extension/` folder.

**Set up:** extension icon → **Settings** → your nextDash address, the write token if the server has one, and a default page.

**Save:**

- The title and URL are filled in. Add a shortcut (empty = a suggested free letter), a page and category, tags and a note, and save — or press **Save to Inbox**.
- An address you already have is reported, with **Save anyway**.
- After saving: **Open in nextDash** or **Open Inbox in nextDash**. An open dashboard tab refreshes itself.
- **Right-click** a page or link → *Save to nextDash* or *Save to nextDash Inbox*.
- **Keyboard** — `Ctrl/Cmd + Shift + Y` saves as a bookmark, `Ctrl/Cmd + Shift + U` to the inbox. The icon badge reports **+** saved, **D** already there, **?** no server set, **!** failed.

The extension needs no CORS setting: its origin is always allowed. Errors: **401** wrong or missing write token, **403** origin not allowed, **409** shortcut already used on that page.

### 19.2 Capture without the extension

**From a phone.** Install nextDash as an app and it appears in the share sheet. Sharing a link saves it to the inbox and opens nextDash. Android sometimes sends the address inside the text; it is found either way. On iPhone, use the Apple Shortcut in `integrations/`, because Safari does not support the app's share target.

**From any browser.** **Config → Help → Inbox → Saving a link from anywhere** builds a bookmarklet with this install's address (and capture token). Drag it to the bookmarks bar.

**From a script or launcher.** One route does it:

```
GET /add?url=<address>&title=<optional title>[&token=<capture token>]
```

It saves to the inbox with the usual duplicate check and answers with a readable page.

```sh
curl -s --get --data-urlencode "url=https://example.com/article" \
     --data-urlencode "title=An article" \
     https://nextdash.example.com/add >/dev/null
```

Use `--data-urlencode`: an address with its own `?a=1&b=2` breaks a hand-built query.

[`integrations/`](integrations/) holds a shell script (`nextdash-add <url> [title]`), two Raycast commands, a Dropzone action, a Ulauncher extension, and recipes for Alfred and Apple Shortcuts. They read `NEXTDASH_URL` (default `http://localhost:8080`) and `NEXTDASH_TOKEN`. See [`integrations/README.md`](integrations/README.md).

**Tokens.** With no write token set, capture is open like everything else. With one set, `/add` and the share route need a token in the address: the write token, or better `NEXTDASH_CAPTURE_TOKEN`, which opens capture and nothing else.

---

## 20. 📱 Phones, tablets and the installed app

nextDash adapts to touch screens (a touch device without a hover pointer) rather than to window width alone.

| | Phone | Tablet and desktop |
|---|---|---|
| **Header** | Page switcher and destinations, folded to fit | Full header |
| **Action buttons** | Search | As configured |
| **Commands and finders** | The `:` and `?` tabs in the search panel | Buttons or keys |
| **Tag filter** | `tag:` in search, or `:tag` | The tag cloud (`/`) |
| **Preview cards** | Off | As configured |
| **Categories** | One column each | Can spread |
| **Config** | All sections; the section list scrolls sideways | Rail and content side by side |
| **Bookmarks list** | Rail as a drawer, side panel as a sheet | Rail, list and panel |
| **Theme editor** | Read-only | Full |
| **Quick-start card** | Skipped | Shown on first visit |

A dismissible banner explains the limits once.

**Touch gestures:**

| Gesture | Action |
|---|---|
| Long-press a bookmark | Edit in place |
| Long-press a category header | Rename |
| Swipe sideways | Change page |
| Tap search | The search panel, with its mode tabs |

**Install as an app.** *Add to Home Screen* (or the install button in your browser) uses `/manifest.webmanifest`; the custom title and favicon from Branding are used for the app. Behavior → General shows install steps for your platform. **Hypr mode** makes a click open the bookmark in a browser tab and then close the app window.

---
## 21. 🔐 Security and self-hosting

nextDash has **no user accounts**. Anyone who can reach the address can read your bookmarks and change them, unless you put something in front of it.

| Setup | When |
|-------|------|
| **Tailscale or another private network** | Access from your own devices only |
| **Reverse proxy with authentication** | Caddy, Traefik or nginx with basic auth, OAuth2 Proxy or SSO |
| **localhost and an SSH tunnel** | A single machine |

**Do not** expose plain HTTP to the internet without authentication.

### 21.1 Production Docker

`docker-compose.prod.yml` mounts only `./data`; CSS and JavaScript are built into the binary. The container starts as root so host Docker hooks can run, then switches to the `nextdash` user (`NEXTDASH_RUN_AS_ROOT=1` keeps root). The compose file sets a 256 MB memory limit. For TLS and long-lived static caching in front of the app, use `docker-compose.proxy.yml` with `deploy/Caddyfile`.

A reasonable environment for a LAN or VPS:

```yaml
environment:
  - PORT=8080
  - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
  - NEXTDASH_CORS_ORIGINS=https://dash.example.com
  - NEXTDASH_ACTIVITY_LOG=mutate,status,security
  - NEXTDASH_ACTIVITY_LOG_PERSIST=1
  # Optional:
  # - NEXTDASH_OUTBOUND_REQUESTS_PER_MIN=120
  # - NEXTDASH_SSRF_API_RATE_PER_MIN=60
  # - NEXTDASH_STATUS_PING_RATE_PER_MIN=300
  # - NEXTDASH_CSP=off
  # - NEXTDASH_DISABLE_PREFETCH=1
```

Before it listens, the server checks that `PORT` is valid and that the data directory can be created and written; otherwise it stops with a clear error. The full list of environment variables is in the [README](README.md#environment-variables-reference).

### 21.2 The write token

Set `NEXTDASH_WRITE_TOKEN` and every write or destructive API call — saves, imports, deletes, uploads, resets, backups, retests, preview fetches — needs the header `X-NextDash-Token`. The dashboard supplies it automatically for pages served by the same install. Unset, nothing needs a token.

Read-only routes (bookmarks, settings, the health list, ping) stay open. The extension stores the token under **Settings → Write token**. `GET /api/backup` and the automatic-backup routes need the token, because a backup is the whole library.

**The data directory is not served.** Only `data/icons/` and an uploaded favicon or font are published, with a long cache lifetime. Settings, bookmark files, the inbox, the trash and stored backups are reachable only through the API.

`NEXTDASH_CAPTURE_TOKEN` opens only the two capture routes ([§19.2](#192-capture-without-the-extension)).

### 21.3 Local addresses and outgoing requests

**Allow localhost & private-network bookmarks** (Behavior → General) is on by default. Turn it off when nextDash is reachable on a shared network.

With it off, the server's pings, previews, icon downloads, redirect detection, alerts and webhooks only reach public hosts. Redirects are only followed to hosts that pass the same rule. Addresses are checked again when the connection is made, and a resolved public address is pinned for about two minutes, so a host name cannot switch to a private address in between (DNS rebinding).

**Rate limits** apply per client to the requests the server makes for you:

```bash
NEXTDASH_OUTBOUND_REQUESTS_PER_MIN=120   # previews, pings, favicons, redirect detection
NEXTDASH_SSRF_API_RATE_PER_MIN=60        # /api/bookmark-preview, icon uploads, archives, /api/health/check-url, alert tests
NEXTDASH_STATUS_PING_RATE_PER_MIN=300    # /api/ping, the browser's own status checks
```

Above the limit the API answers **429**, and the `security` channel records it.

### 21.4 CORS

By default only a browser extension's origin (`chrome-extension://…`, `moz-extension://…`, `safari-web-extension://…`) receives `Access-Control-Allow-Origin`. Any other web page cannot read the API.

`NEXTDASH_CORS_ORIGINS` is a comma-separated allowlist for pages of your own. Extension origins never need an entry. `*` answers every origin.

```bash
NEXTDASH_CORS_ORIGINS=https://dash.example.com
```

### 21.5 Content-Security-Policy

HTML pages send a strict Content-Security-Policy. `NEXTDASH_CSP=off` switches it off when a proxy or integration requires that.

### 21.6 The MCP endpoint

nextDash can answer MCP clients (the Model Context Protocol) at `/mcp`, for example `http://your-host:8080/mcp`. It is **off** until you tick **Answer assistants at this address** under **Data & backups → Webhooks**, which then shows the address.

| Tool | What it does |
|---|---|
| `search_bookmarks` | Search by name, URL, tag or note; each result names its page and category |
| `get_bookmark` | Everything stored about one bookmark |
| `list_tags` | Every tag with its count |
| `add_bookmark` | Add a bookmark, with the usual duplicate check |

It starts closed because it answers questions about every bookmark. The `Origin` of every request is checked against the host it arrived on, and with `NEXTDASH_WRITE_TOKEN` set, adding needs the token.

### 21.7 What nextDash contacts

| What | When | Switch |
|---|---|---|
| Your bookmarks' sites | Checks, previews, icons, Fresh, archives | Per feature |
| GitHub Releases API | Once a day, to see whether a newer release exists | Behavior → Privacy → *Check GitHub for new releases*; `DISABLE_UPDATE_CHECK=true` for the whole server |
| nextdash.cc feed | Every 90 minutes, by the server, for News & features | Behavior → Privacy → *Show posts from nextdash.cc*; `DISABLE_NEWS_FEED=true` |
| Weather and calendar providers | For the header and widgets | Appearance → Date & weather |
| Your own services | Custom widgets, webhooks, alerts | Per widget or receiver |
| Analytics | Only when switched on | See below |

### 21.8 Analytics

nextDash can send **anonymous usage statistics** to a self-hosted [Umami](https://umami.is) instance at `stats.nextdash.cc`. It is **off until you turn it on**. The aim is to learn which features are used and what can be improved.

- **Turning it on or off** — the card on the dashboard (*Turn on*, *What is recorded?*, *No thanks*), **Config → Behavior → Privacy → Privacy-friendly analytics**, or `:telemetry on` / `:telemetry off`. The page reloads, because the tracker script is only added to the page when analytics is on. Closing the card without answering asks again later; an answer is final.
- **For the whole server** — `DISABLE_TELEMETRY=true` (also `1`, `yes`, `on`) turns it off for everyone and greys out the switch.
- **When off** — the tracker is not in the page, nothing is downloaded and nothing is sent.

**What is recorded** — event names from a fixed list, with a few properties:

| Area | Recorded |
|---|---|
| Views and navigation | Opening views and config sections and tabs, switching pages by position |
| Panels | Opening search, commands, finders, the cheat sheet, the tag cloud, what's new and the bookmark form |
| Actions | Which command ran (by name), which menu entry was picked, bookmark opens and where from, edits, moves, deletes, checking changes, inbox and health actions |
| Outcomes | Whether adding or editing succeeded, or hit a duplicate, conflict or error |
| First-run help | Tours and tips shown and finished |
| Settings | The **name** of a setting you change, and on/off for toggles; once per load, which features are on and the release you run |
| Size | Once per load, bucketed counts (for example `500+` bookmarks) |

Every count is rounded into a band. **Never recorded:** bookmark names, URLs, search text, page or category names, notes or tag names. No cookies, no profile, no cross-site tracking. This is separate from the open counts in [§6](#6-opening-and-editing-bookmarks), which never leave your server.

### 21.9 Operations

- `GET /version` — version and commit.
- `GET /api/data-revision` — a hash of the bookmark data; open dashboard tabs poll it and refresh when something changes elsewhere.
- Preview data is kept in memory and written to disk every 30 seconds and on shutdown.
- `NEXTDASH_DATA_DIR` sets the data directory; `NEXTDASH_DISABLE_PREFETCH=1` skips the icon prefetch at start-up.

---

## 22. 🛠️ Troubleshooting

### The dashboard is empty after install

The example bookmarks may have been removed. Add bookmarks with **&** or **+**, or import a browser file under Config → Data & backups.

### The dashboard does not load

A toast offers **Reload**. Check that the server runs and that `/api/pages`, `/api/settings` and `/api/bookmarks` answer. Broken device settings in the browser fall back to the server's settings.

### A change in another tab does not show

Open dashboard tabs poll `GET /api/data-revision` and refresh when bookmarks change. If a sync fails, use **Retry** on the toast.

### A shortcut does not open its bookmark

- Another bookmark may use the same shortcut — the health view lists shortcut conflicts.
- With the cursor on the grid, `g`, `j`, `k`, `t` and `x` keep their grid meaning; use search for those shortcuts.
- Check **Typing a bookmark shortcut** under Behavior → Search — it may be set to wait for a pause or for Enter.
- Focus must not be in a text field.

### Bookmarks seem to be missing

Usually a filter: a tag filter on the dashboard (`Escape` clears it), `Shift + F`, a filter in the Config → Bookmarks rail, or a limit on items per category. Deleted bookmarks are in the trash for 30 days.

### An import says "0 new"

Every address already exists on the chosen page, or the file has no http(s) links.

### A bookmark with a private address is refused

The address is `localhost`, `192.168.x.x` or another private host while **Allow localhost & private-network bookmarks** is off (Behavior → General).

### A self-hosted service shows as broken

It probably needs a sign-in, or answers 401. In the health view choose **Expected response** on its row: add `401` to the healthy status codes, or pick a stored sign-in ([§13.1](#131-availability-modes)).

### The colours look wrong after the system switched to dark

Hard-refresh once (`Ctrl + Shift + R` / `Cmd + Shift + R`) to drop JavaScript from an older release.

### A new release does not seem to have arrived

An open tab keeps the files it loaded. Reload once.

### The quick-start card does not appear

It shows once per install, and not on phones. After finishing or dismissing it, **Show quick-start card again** (Behavior → General → Onboarding) brings it back.

### The weather does not show

Set a city or allow location access under Appearance → Date & weather, and check that weather is switched on. The Weather widget says so when no location is set.

### The Calendar widget shows nothing

- Set **Calendar feed URL (.ics)** under Appearance → Date & weather. Use the private ICS address from your calendar app, not the calendar's web page.
- The server fetches the feed, so it must be reachable from the machine nextDash runs on.
- The feed is cached for 15 minutes; changing the address redraws at once.

### The RSS widget shows nothing

- Give the widget at least one feed address (RSS or Atom), one per line.
- A web page instead of a feed is reported as such.
- The server fetches the feeds; each is cached for 15 minutes.

### A system widget shows no figures

The tile names the missing step — usually a mount or an environment variable ([§11.4](#114-system-widgets-and-what-they-need)).

### Browser notifications do not arrive

They need HTTPS in Safari and on iPhone and iPad, and nextDash on the home screen on iPhone and iPad. Permission is per browser.

### The extension cannot save

- Check the server address and that nextDash runs.
- **401** — set the write token in the extension's settings.
- **409** — the shortcut is already used on that page.
- Refused writes and rate limits are logged when the **Refused access** channel is on (Logs → Activity trail, or `NEXTDASH_ACTIVITY_LOG=security`).

---

## 23. 📌 Quick reference

### Most-used keys

```
type        search              Enter       open top result
>  :  ?     search · commands · finders     @  all pages
+  &        add · quick add     Ctrl+V      paste a URL
1-9  ,      pages · pages panel             *  recent   /  tags   !  cheat sheet
arrows j k  move                Esc         back / home
Shift+E edit   Shift+M move   Shift+T tags   Shift+D delete   Shift+C checking
Shift+H health   Shift+I inbox   Shift+S config   Shift+A themes
```

### Config

```
Shift+S or <        open or close config
Ctrl/Cmd+Shift+K    find a setting
j / k               previous / next section
Alt+← / →  or [ ]   previous / next tab
Escape              close, then leave
```

### Addresses

| Address | Opens |
|-----|------|
| `/` | The dashboard |
| `/#config`, `/#config/<section>/<tab>` | Config |
| `/#config/help/<tab>/<topic>` | A help topic |
| `/#health`, `/#health/monitors` | Health |
| `/#inbox` | The inbox |
| `/#search?q=…` | A search |
| `/add?url=…` | Save to the inbox |
| `/opensearch.xml` | The browser search engine description |
| `/manifest.webmanifest` | The installed app |

### Data location

Docker: the mounted volume (for example `./data`, mounted at `/app/data`). Binary: `./data` next to it, or `NEXTDASH_DATA_DIR`.

---

## 📖 Further reading

| | Document | Contents |
|---|----------|----------|
| 🚀 | [README.md](README.md) | Install, security, environment variables, features |
| 📋 | [CHANGELOG.md](CHANGELOG.md) | Every release, new and fix |
| 🧩 | [integrations/README.md](integrations/README.md) | Scripts and launchers that save to nextDash |
| 🔌 | [extension/README.md](extension/README.md) | Developing the browser extension |
| 💬 | **Config → Help** | The same topics in the app, in six languages |
| ★ | **What's new** | The latest release notes, with earlier releases below |
