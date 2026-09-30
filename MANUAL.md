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

<a id="table-of-contents"></a>

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
11. [The Bookmarks view](#11-the-bookmarks-view)
12. [Checks & health](#12-checks-health)
13. [Inbox](#13-inbox)
14. [Containers](#14-containers)
15. [Widgets](#15-widgets)
16. [Appearance](#16-appearance)
17. [Config](#17-config)
18. [Statistics](#18-statistics)
19. [Data, backups and import](#19-data-backups-and-import)
20. [Logs](#20-logs)
21. [Browser extension and capture](#21-browser-extension-and-capture)
22. [Phones, tablets and the installed app](#22-phones-tablets-and-the-installed-app)
23. [Security and self-hosting](#23-security-and-self-hosting)
24. [Troubleshooting](#24-troubleshooting)
25. [Quick reference](#25-quick-reference)

---

<a id="1-what-is-nextdash"></a>

## 1. ✨ What is nextDash?

nextDash is a **self-hosted bookmark dashboard** you open in your browser.

- **No accounts.** One installation, one set of data on disk.
- **No cloud.** Your bookmarks live as plain JSON files in a directory you control.
- **Keyboard first.** Search, switch pages, add, edit and run commands without the mouse.

Bookmarks are grouped by **page** (Work, Home) and **category** (Dev, News). Around that sit search, a command palette, a Bookmarks view with link health checks and uptime monitoring, an inbox for links you have not filed yet, a Containers view for the machine's own Docker containers, and widgets that show something other than links.

<a id="what-you-can-do"></a>

### ✅ What you can do

| Area | Examples |
|------|----------|
| **Organise** | Pages, categories, drag and drop, pins, tags, notes, smart collections |
| **Find** | Type to search, filters, a command palette, finders for other sites |
| **Add** | One-line quick add, the full form, paste a URL, browser extension, share sheet, bookmarklet, imports |
| **Watch** | Broken links, uptime monitoring, certificate expiry, page drift, alerts |
| **Show** | Widgets for health, inbox, feeds, weather, calendar, your machine, your containers and your own services |
| **Customise** | 155 theme families, surfaces, layout, header and action buttons, six languages |
| **Keep** | Automatic backups, a 30-day trash, local copies of pages, HTML and CSV export |

<a id="what-nextdash-is-not"></a>

### 🚫 What nextDash is not

- Not a multi-user service. Anyone who can reach the address can read and change the data — see [Security and self-hosting](#23-security-and-self-hosting).
- Not a feed reader. Fresh and the RSS widget tell you what is new; they do not store articles.

---

<a id="2-installation-and-first-launch"></a>

## 2. ⚙️ Installation and first launch

<a id="docker-compose-recommended"></a>

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

From a git checkout, `docker-compose.prod.yml` is the production file (only `./data` is mounted; the assets are built into the binary) and `docker-compose.yml` is for development (it mounts `./static`, `./locales` and `./templates`). The development file ships with `NEXTDASH_DOCKER_CONTROL=0` and `NEXTDASH_RUN_AS_ROOT=0` and the Docker socket commented out. Put your own mounts and variables in a `docker-compose.override.yml` beside it: Compose reads that file on its own, and your changes stay out of the checkout.

<a id="build-from-source"></a>

### 🧱 Build from source

```sh
go build -o nextDash && ./nextDash
```

Data is stored in `./data` next to the binary. `NEXTDASH_DATA_DIR` points it elsewhere.

<a id="which-branch-to-clone"></a>

### 🌿 Which branch to clone

| Branch | Use it for |
|--------|------------|
| **`main`** (default) | Self-hosting and Docker builds — the released code |
| **`dev`** | Contributing — tests, scripts and work in progress |

<a id="first-launch"></a>

### 🚦 First launch

1. **Quick-start card.** A small card asks for your language and dark mode, your column layout and your weather location. Skip it whenever you like; every setting stays in config. It then becomes a short checklist — add a bookmark, tag one, open config, see the cheat sheet — that closes itself when done.
2. **Example bookmarks.** A new install starts with a few example bookmarks and a Health widget, so there is something to try the keys on.
3. **Your own bookmarks.** Import your browser's bookmark file under **Config → Data & backups** ([§19](#19-data-backups-and-import)), or add them with **+** and **&** ([§5](#5-adding-bookmarks)).
4. **Config.** Press **`Shift + S`** or click the gear. Config is a view inside the dashboard; **`Escape`** takes you back.

**The first hour.** Split your bookmarks across a few pages, give the ten you open daily a shortcut, and switch on link checking under Config → Behavior → Status & alerts. Everything else can wait until you know what you want.

---

<a id="3-core-concepts"></a>

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
| **Availability checking** | **Off**, **Periodic** or **Monitor** — see [§12](#12-checks-health) |

nextDash also records when a bookmark was added and last changed, how often it was opened and when last, and its preview (title, description, image) and health.

### 3.4 The inbox

The **inbox** holds links you want to keep before you know where they belong. It is a list of its own, not a page. **Keep** sends a link to **Bookmarks → Unsorted** rather than filing it, for a link worth holding on to with no page yet. See [§13](#13-inbox).

### 3.5 Views

The dashboard has five views: the **dashboard grid**, the **Bookmarks view**, the **inbox**, the **Containers view** and **config**. They are all part of one page — switching never reloads. **`Escape`** backs out to the dashboard grid, and the browser's **Back** button returns to the view you came from. Changing a filter inside a view is not a history step.

This manual calls the page of categories and widgets the **dashboard grid**, to keep it apart from the **Bookmarks view** — the library of every bookmark, with its own rail, list and side panel ([§11](#11-the-bookmarks-view)).

---
<a id="4-the-dashboard"></a>

## 4. 🖥️ The dashboard

```
┌───────────────────────────────────────────────────────────────────────────┐
│ It's 09:12 · Thursday          1  2  3  4  +5   ⌂  📚  📥  🐳  ⚙          │
│ Leiden, rain, 16°C                                                        │
│ main                                                                      │
├───────────────────────────────────────────────────────────────────────────┤
│ // today (15)        // other            // vps             // weather     │
│   bookmark rows        bookmark rows       bookmark rows      widget       │
│                                                                           │
│                        [ + ] [ > ]   ← action buttons (dock)               │
└───────────────────────────────────────────────────────────────────────────┘
```

<a id="the-header"></a>

### 🧭 The header

The header has three zones.

- **Left — clock, weather and name.** The time and date, the weather line, and the name of the page or view (*main*, *config*). Click the date for a week overview; a **Calendar URL** (Appearance → Date & weather) adds an *Open calendar* link. **Clock and weather** chooses where they stand: beside the view name (the default), in a column of their own, or on their own line with the name underneath.
- **Middle — the page switcher.** See [below](#the-page-switcher).
- **Right — the destinations.** **Dashboard** (⌂), **Bookmarks** (a badge for a broken link or another problem), **Inbox** (an unread count), **Containers** (a badge for updates waiting) and **config** (the gear). Each destination can be switched off; its key keeps working. There is no Health icon — its badge and its list live on the Bookmarks icon now.

**Button style** draws the header controls plain (underlined when current) or each in its own box. As the window narrows, the header folds its parts away in a fixed order, so the switcher and the destinations stay reachable.

<a id="the-page-switcher"></a>

### 🔢 The page switcher

| Style | What it looks like |
|-------|--------------------|
| **Numbers beside the destinations** (default) | `1 2 3 4 +5` |
| **One segmented control** | The pages as one joined control |
| **Plain text, underlined** | The page names as tabs |
| **One button with a list** | The current page, with a list of the rest |

**Page tabs shown before "+N"** (3–9, default 4) sets how many pages show before the rest fold into a **+N** list. Every page keeps its digit key. **Show page names in tabs** and **Show the dashboard title** sit in the same group. Double-click a page tab to rename it and give it an emoji and a colour dot.

`:switcher`, `:maxtabs` and `:buttonstyle` change these from the command palette.

<a id="the-action-buttons"></a>

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

**A bar that slides away.** **Slide a docked bar away after** takes *always in view*, 2 (default), 5, 10 or 30 seconds, and applies to the three docked positions. The bar comes back when the pointer touches that edge or when focus moves into it, and then slides away again after the delay. Brought back with **`'`** or **`Shift + O`** it stays until you press the key again, or until the pointer has passed over it and left — from then on the delay runs as usual. Switching page or view leaves it where it is. A bar in use — the pointer over it, the keyboard in it, or a menu of its own open — never leaves while you are using it.

While it is away, a small **handle** stands on that edge, so the place it came from stays visible. It grows and brightens as the pointer comes near, and a click on it brings the bar back. There is no handle for a bar in the header or behind the menu, and none on a touch screen, where nothing hovers.

**The keys.** **Show the key on each button** adds a key chip to every button. It starts **on** for a new install and **off** on a dashboard that already existed — a bar of nine chips is a lot to meet on upgrade. With the chips off, resting on a button for a moment shows that button's key beside it, so the key is still there to find.

`:buttons` and `:maxactions` change these from the command palette.

The **★** button in the bottom-right corner opens the release notes. It is left out on a window as narrow as a phone; `:whatsnew` and Help still open them.

<a id="the-grid"></a>

### 🗂️ The grid

Categories and widgets stand in columns — as many as **Columns per row** allows and the window has room for, and one on a phone held upright. Each category header shows `//`, its icon and name, a count, and chips for sorting (manual, **A–Z**, **Recent**), a **+** to add a category and a **⋯** menu. Click the header to fold the category. A spread category shows **↔ N** with the number of columns it takes. Smart collections (*Today*, *Recently opened*, …) and custom collections appear as groups among your categories.

A bookmark row shows its icon, name, optional tags, the shortcut letters and, when checked, its status and ping. How the row looks is set under **Appearance → Rows** ([§16](#16-appearance)).

**A key legend** under the grid shows the four most useful keys once you start moving with the keyboard; switch it under Behavior → Keyboard & search.

**Occasional tips.** Now and then the dashboard shows one keyboard tip, never the same one twice. Switch them off under Behavior → Privacy & sync → Onboarding.

**Corner cards** offer things once, one card at a time: a round of link review, a round of tag suggestions, browser notifications, the theme browser, Fresh, spreading a category. Each can be dismissed, and each review card has a switch under Behavior → Privacy & sync → Onboarding.

<a id="the-link-preview-card"></a>

### 🃏 The link preview card

Hovering a bookmark — or pressing **`Shift + V`** on the selected row — opens a card in a fixed order:

1. **What the page is** — icon, title, one address and a status pill.
2. **What it says** — image, description, publisher, author and date where the page declares them, your note and tags. A bookmark that is a video — YouTube, Vimeo, Dailymotion, or a file that ends in `.mp4` — carries a small **▶** on the corner of its icon (beside the name when icons are off), and the card opens on the thumbnail with a play button over it.
3. **What you know about it** — last check and ping, uptime, certificate expiry, the Fresh count, opens and last opened, shortcut and location.

A row with nothing to say is left out. **Config → Appearance → Rows → Link preview cards** offers **Off**, **On hover** (default) and **Keyboard only**, a hover delay, and a checklist of rows — the player is the **Video player** row in that list. `Shift + V` works in every mode and keeps the card open with **Copy**, **Refresh** and **Edit**.

**Playing a video.** Nothing reaches YouTube or Vimeo while you hover: the poster is the picture your own server already fetched, and the player is built when you press it. From the keyboard, `Shift + V` puts the cursor on the play button and `Enter` starts it. `Esc` closes the card and ends the video, and so do the **✕** over the player and a click anywhere else — a click inside the player hands the keyboard to the provider, so `Esc` only works again once your pointer leaves the card.

The picture and the site icon are fetched **by your server** and stored under `data/preview-images/`, so hovering never tells the site you looked. The first hover shows the text at once and the picture a moment later. Untick **Image** and no picture is fetched or stored; set the cards to **Off** and nothing is fetched for them at all. **Data & backups → Icons & previews** caps the stored pictures at 50, 200 or 500 MB and can remove them all. Pictures are left out of backups; they are fetched again when needed.

---

<a id="5-adding-bookmarks"></a>

## 5. ➕ Adding bookmarks

<a id="51-quick-add"></a>

### 5.1 Quick add (`&`)

Press **`&`**, type one line — `name | url | shortcut` (shortcut optional) — and press **Enter**.

```
GitHub | https://github.com | gh
```

<a id="52-the-full-form-shift-b-ctrl-shift-a"></a>

### 5.2 The full form (`+`, `Shift + B`, `Ctrl + Shift + A`)

One bookmark form is used everywhere: the dashboard, the Bookmarks view, the inbox, config and `:new`.

- **`+`** on the dashboard, or the add button.
- **`Shift + B`** from anywhere on the dashboard, unless you are typing in a field.
- **`Ctrl + Shift + A`** from anywhere.

The form is one column, in the order you fill it in: **address**, **name**, the **preview card**, **tags**, **page › category** and **shortcut**, **pin** and **availability checking**, and the **note**. It opens with the cursor in the address field, adding and editing alike.

**One read of the page.** When you leave the address field, the page is read once, and that one read fills in the rest:

- **The icon** — with a **✎** on it for **Upload…**, **Fetch again** and **Clear**. An icon you uploaded, or one the bookmark already had, is kept when the address changes; a fetched one is replaced.
- **A name** — left empty, the name field shows the page's own title, *Suggested from the page · Clear*; a name you typed stays, with *Page: … · Use* under it to take the page's title instead.
- **The card** — the page's host, its own line and its picture. It says **Reading the page…** while a slow site answers, and **No preview** with **Try again** when the page could not be read; the bookmark saves fine without one.
- **Suggested tags** — chips under the tags field, from the same sources as Tag suggestions ([§10.4](#104-tag-suggestions)). **+** adds one, **✕** turns it down for that site everywhere, and **↻** asks again. Editing a bookmark shows its suggestions straight away, from the words stored for it.

Change the address and the whole read starts again; only the latest one counts.

- **Page › category** is one field. It opens the same list as **Move to…** (`Shift + M`), with a filter at the top: type to narrow it, arrows and `Enter` to pick. Its first rows are **New category on …** and **New page…**; after a new page, the form asks for its first category.
- **ⓘ** beside **Tags**, **Shortcut** and the checking choice explains each one.
- **Availability** is the same **Off / Periodic / Monitor** choice as everywhere, with the interval for Monitor.
- The **shortcut** field warns when a shortcut is taken, and says which letters the grid itself uses.
- **Save** or **`Ctrl + Enter`** saves. **Create + New** saves and clears the form for the next one, keeping page and category.
- **Before it saves**, the form asks: with no page it says a bookmark needs one; with no category it asks **Save without** or **Choose a category**; a link already on another page is named, with **Save anyway**; a link already on the same page is refused, naming the bookmark that has it.
- **The keyboard alone** fills in the whole form: `Tab` walks the fields in order and wraps round inside the form, and `Escape` closes the innermost thing first — the tag list, the icon menu, the page list — and the form last. The dashboard behind it does not scroll.
- On a phone the form leaves out the icon and note fields; existing values are kept.

This same form, titled **Promote bookmark**, is how an Unsorted bookmark from the inbox or the Bookmarks view gets a page ([§11.11](#1111-unsorted-and-promote)).

<a id="53-paste-a-url-ctrl-v"></a>

### 5.3 Paste a URL (`Ctrl + V`)

With no field active, paste a URL on the dashboard. A dialog offers **Save to Inbox** (`1`) or **Add bookmark** (`2`). Set a fixed answer under **Config → Inbox → Collecting → Paste destination** — *Ask each time*, *Always add bookmark* or *Always save to Inbox*.

### 5.4 Other routes

- **Browser extension** — saves the current tab ([§21](#21-browser-extension-and-capture)).
- **Share sheet and bookmarklet** — save to the inbox from a phone or any browser ([§21](#21-browser-extension-and-capture)).
- **Import** — a browser bookmark file, a CSV file, or a source such as GitHub stars ([§19](#19-data-backups-and-import)).
- **Add bookmark** in the Bookmarks view's toolbar — the same form, on the page the list is filtered to ([§11](#11-the-bookmarks-view)).
- **`:new`** and **`:add`** in the command palette.

<a id="a-link-you-already-have"></a>

### ♻️ A link you already have

nextDash compares addresses loosely: a trailing slash, a `#fragment`, the case of the host and a default port do not make a link different.

- **Same page** — refused. Two identical rows on one page are never intended.
- **Another page** — you are asked, and told where it is: *"You already saved this on Work · Docs"*, with a link. **Save anyway** keeps the second copy.

The form, quick add and the extension all ask. Imports skip duplicates and say how many.

---

<a id="6-opening-and-editing-bookmarks"></a>

## 6. 🔖 Opening and editing bookmarks

<a id="with-the-mouse"></a>

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

<a id="the-right-click-menu"></a>

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
| Show in Health | `Shift + R` | Opens the bookmark in the Bookmarks view, on its Health tab |
| Select / Select all in category | `x` / `X` | Starts a selection |
| Delete | `Shift + D` | Asks first; undo in the toast; the trash keeps it 30 days |

The menu also opens with **`Shift + F10`** or the **Menu** key, beside the row.

<a id="editing-in-place"></a>

### ✏️ Editing in place

**`Shift + E`**, a long press, or **Edit** opens the bookmark form over the row, with the page dimmed behind it. **Save** or **`Ctrl + Enter`** writes it; **`Esc`** or a click outside closes it, asking first when something changed. While it is open, the grid keys, swiping and paste are paused. Deleting from the form asks first and offers undo.

<a id="usage"></a>

### 📈 Usage

Every open — from the grid, search, the recent panel or the Bookmarks view — adds one to the bookmark's open count and records the time. This feeds *Recently opened*, *Most used*, *Stale*, statistics and the Bookmarks view's Health tab. Opening the same site from the browser's address bar does not count. The counts are in your data files and travel with backups.

<a id="recent-bookmarks"></a>

### 🕘 Recent bookmarks (`*`)

A narrow panel with what you opened recently on this page: one row per bookmark, with its category, when and how often. The arrow keys move, `Enter` opens. `:open last 5` opens several at once.

<a id="hypr-mode"></a>

### 🪟 Hypr mode

**Behavior → General → Hypr mode** makes a click open the bookmark in a new browser tab and then close the installed app's window, the way an app launcher works. It pairs with nextDash installed as an app ([§22](#22-phones-tablets-and-the-installed-app)).

---
<a id="7-keyboard"></a>

## 7. ⌨️ Keyboard

Every action on a bookmark is **`Shift` plus a letter**. Bare letters belong to search until the cursor is on the grid, and then to the grid. The right-click menu shows each key, and the cheat sheet (**`!`** or **`F1`**) lists all of them.

### 7.1 Views and panels

| Keys | Action |
|------|--------|
| `1`–`9` | Go to a page |
| `Shift + ←` / `Shift + →` | Previous / next page |
| `Shift + I` | Inbox |
| `Shift + H` | The Bookmarks view, on the broken ones |
| `Shift + U` | The Bookmarks view, on Unsorted |
| `Shift + Y` | Containers |
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

The Containers view has no key of its own — open it from its header icon or with `:docker`.

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
| `Shift + R` | Open the bookmark in the Bookmarks view, on its Health tab |
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

A toolbar appears with **Move**, **Tags**, **Pin**, **Checking**, **Open**, **Copy links** and **Delete**. The tag picker shows a **✓** for tags the whole selection has and *on 2 of 3* for tags only some have. Above them, **Suggested** lists up to three tags the selection is likely to want ([§10.4](#104-tag-suggestions)); a suggestion that fits only some of the rows says *on 1 of 3*, and choosing it tags only those rows. While a selection is open, a plain click clears it instead of opening a bookmark. A bulk change can be undone from its toast for eight seconds, and deleted bookmarks stay in the trash for 30 days.

### 7.6 The cheat sheet

**`!`** or **`F1`** opens the cheat sheet with a filter box. It opens on the section for the view you are in, and lists more than 200 keys and commands across Navigation, Bookmarks, Widgets, Selecting several, the **Bookmarks view**, the **Inbox view** and **Inbox triage**, the **Containers view**, the Config view, search modes and every command. A printable version is linked at the top of Config → Help and at the top of this manual. Keys cannot be rebound.

While a panel is open, the grid behind it does not react. `Tab` stays inside the panel, and `Escape` closes it and puts focus back where it was.

---

<a id="8-search-commands-and-finders"></a>

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

**Typing a bookmark shortcut** (Behavior → Keyboard & search) has three answers:

| Setting | What happens |
|---------|--------------|
| **Open the moment it matches** (default) | The bookmark opens as soon as what you typed equals its shortcut. Fastest; can cut off an ordinary word that starts with those letters. |
| **Open after a short pause** | The shortcut waits until you stop typing. |
| **Press Enter to open** | Typing only narrows the list; the shortcut leads it. |

**Switch search mode** (Behavior → Keyboard & search, or **`Shift + Q`**) decides whether bare letters look for a shortcut or a name. When one finds nothing and the other would, the panel adds a row that searches the other way.

**Behavior → Keyboard & search** also holds fuzzy suggestions for near-misses, *include finders in search*, *keep search open when empty* and the search hint. *Search unsorted bookmarks* (on by default) lets search reach links kept on **Bookmarks → Unsorted** ([§11.11](#1111-unsorted-and-promote)); they stay out of every other list.

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

<a id="85-commands"></a>

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
| `:goto <url>` · `:goto config\|stats\|docker` | Go somewhere |
| `:inbox` · `:inbox triage` | The inbox |
| `:health [broken\|duplicate\|stale\|unused\|unchecked\|missing-preview\|shortcut-conflict\|healthy\|all\|refresh]` | Opens the Bookmarks view on that filter, and re-scans on `refresh` |
| `:health page <name>` | The Bookmarks view on one page |
| `:docker` | The Containers view |
| `:docker <name> open` · `:docker <name> logs` · `:docker <name> start\|stop\|restart\|pause\|update\|remove` | One container: `open` goes to its web UI, or to the view when it has none; the actions need `NEXTDASH_DOCKER_CONTROL=1` |
| `:monitor` · `:monitor off` | How many bookmarks are checked · switch checking off everywhere (asks first) |
| `:config [section]` | A config section, for example `:config appearance` |
| `:backup` · `:export` · `:trash` | Backups · download a backup · the trash |
| `:favicons fetch` · `:favicons on\|off` | Download every icon again · show icons |
| `:metadata` | Bookmarks without a preview |
| `:theme <name>` · `:dark` | Theme · flip light and dark |
| `:depth` · `:glow` · `:contrast` · `:backdrop` · `:pattern` · `:harmonize` | Surfaces ([§16](#16-appearance)) |
| `:layout <preset>` · `:density` · `:columns <1-6>` · `:width on\|off\|all` · `:rows` · `:packed` · `:fontsize` | Grid |
| `:switcher` · `:buttonstyle` · `:maxtabs` · `:maxactions` · `:buttons` · `:header` | Header and action buttons |
| `:preview` · `:title` · `:opacity` · `:animations` · `:status` · `:shortcuts` · `:lang` | Display toggles |
| `:locklayout` | Lock or unlock drag and drop |
| `:collections` | Smart collections on or off |
| `:telemetry on\|off` | Analytics (reloads the page) |
| `:cheat` · `:help` · `:whatsnew` · `:reload` | Cheat sheet · release notes · reload |

<a id="86-finders"></a>

### 8.6 Finders (`?`)

`?shortcut query` sends the query to another site: `?g nextdash` searches Google. A fresh install has DuckDuckGo on `du`. `?w` without a query opens the site's own search page.

**Structure → Finders** manages them: a name, a shortcut and a URL with `%s` where the query goes (for example `https://github.com/search?q=%s`). Names and shortcuts must be unique. Rows can be dragged or moved with `↑`/`↓`, carry tags, and show how often each finder was used. **Include finders in search** (Behavior → Keyboard & search) shows them among ordinary results.

---

<a id="9-pages-categories-and-collections"></a>

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

Each category header has a **⋯** menu with **Manual**, **A–Z**, **Last opened**, **Newest** and **Most opened**. The chosen sort shows as a short chip in front of the ⋯ (*A–Z*, *Rec*, *New*, *Top*); click it to go back to manual order. **Last opened** and **Most opened** put bookmarks never opened last. Pinned bookmarks always stay on top. A sorted category cannot be dragged — the cursor and a short note say so. Sorting is only a view; the stored order changes when you drag.

Click a header, or press `Enter` on it, to fold the category. **`.`** folds or unfolds everything on the page, widgets included; the state is kept per page. **Start with categories collapsed** (Appearance → Grid) starts every category folded.

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

The column count of the grid is the ceiling. Spreading needs a limit on items per category and at least two columns. With **Pack columns tightly** on, the categories after a spread one fill in beside and below it. On a phone held upright every category is one column wide. **Appearance → Grid → Categories across columns** holds the limit, whether new categories start spread, and whether *turn spreading off everywhere* covers this page or all pages. A walkthrough is under Config → Help → Structure & bookmarks.

### 9.6 Smart collections

**Structure → Collections** turns them on. Each has its own item limit (0 = unlimited) and can be limited to certain pages.

| Collection | Shows |
|------------|-------|
| **Today** | What you tend to open at this time, tuned by keywords for office hours, evenings and weekends |
| **Recently opened** | What you opened last |
| **Recently added** | What you saved last (off by default) |
| **Most used** | Ranked by opens; appears once you have opened bookmarks from the dashboard |
| **Stale** | Not opened within the stale threshold |
| **Fresh** | Bookmarks whose site published since you last opened them ([§12.6](#126-fresh)) |

Editing or deleting a bookmark inside a collection changes the real bookmark.

### 9.7 Custom and tag collections

**Custom collections** (Structure → Collections) take a name, an icon and rules on tag, category or shortcut, combined with AND or OR, including *excludes*. The value fields suggest what is already in use.

**Tag collections** turn each tag used by enough bookmarks into its own group; raise the minimum to keep one-off tags out.

---

<a id="10-tags"></a>

## 10. 🏷️ Tags

### 10.1 Tags on a bookmark

- Set them in the bookmark form, the side panel in the Bookmarks view, with `Shift + T`, or with `:tag +name`. The form, the side panel, `Shift + T` and the selection's tag picker each show the tags this bookmark is likely to want, under **Suggested**; `Shift + T` opens at the top of its list, with those first.
- Stored in lower case, trimmed, without duplicates. Autocomplete offers the tags you already use.
- **Tags on rows** (Appearance → Rows) shows them as chips on the dashboard — the first few, then a count. Click a chip to filter.

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

The same proposals appear, one bookmark at a time, in the bookmark form, the Bookmarks view's side panel, `Shift + T` and the selection's tag picker ([§10.1](#101-tags-on-a-bookmark)). Turning one down there counts as **No thanks** here, and the list on this tab follows.

A corner card offers a round when ten proposals are waiting; it can be switched off under Behavior → Privacy & sync → Onboarding.

### 10.5 Notes

Notes are plain text. Edit them in the form, the side panel or with `:note`. Search matches them, and the preview card shows them.

---

<a id="11-the-bookmarks-view"></a>

## 11. 📚 The Bookmarks view

The **Bookmarks view** is the library: every bookmark on every page, in one workbench with a rail of filters, a list and a side panel. It replaced Config → Bookmarks → List, and it is where availability checking, uptime and drift are watched.

Open it with **`Shift + H`** (on the broken ones), **`Shift + U`** (on Unsorted), the Bookmarks icon, `:health`, or `/#bookmarks`. Old `/#health` and `/#health/monitors` addresses, and `:health`, still land here, on the matching filter; a search that came with them (`hv_q`) comes along, and `hv_refresh` still re-scans on arrival. See [§11.13](#1113-addresses) for the current address scheme.

### 11.1 The rail

A summary at the top shows the score, the trend, the broken count and uptime over 24 hours — the same readouts the old health view carried, plus how many bookmarks nothing checks at all. Below it, filter groups (each block can be switched off under Config → Bookmarks → View → Rail):

| Group | Shows |
|---|---|
| **Views** | **All**, and questions about the filed library: never opened, not checked, opened once, untagged, not on HTTPS, no icon, duplicates, changed recently — plus **Unsorted** (✻), always shown, which swaps the pool for links kept from the inbox with no page yet |
| **Health** | Broken, Content, Duplicates, Stale, Unused, Unchecked, Monitored, Certificates, Healthy |
| **Pages** | Every page, with a **Manage** link to the pages & categories modal |
| **Categories** | Every category, narrowed to the selected page once one is picked |
| **Tags** | Every tag in use, with an **all** link once there are more than a dozen |

Active filters show as removable tokens above the groups, with **Clear filters** to drop them all at once.

### 11.2 The toolbar and the list

The toolbar sits above the list: a **search** field (`/`) that matches name, URL, category, note, shortcut and tags; a count of what is shown; **Group** (No groups, Page, Category, Site, Status, Tag); **Sort** (Page order, Name A–Z, URL, Category, Recently added, Last opened, Most opened, Pinned first, Tags, Shortcut, Usage, Health score); the row-density toggle shared with the other list views; and **Add bookmark**, which opens the full form on the page the list is filtered to.

Rows show icon, name, host, tags, open count and last opened, plus a score column and status glow once Health has joined in. Only the rows near the screen are drawn, so thousands of bookmarks stay fast.

**Column headings** name the columns View shows and stay in place while the list scrolls (not at phone width). Every heading with a value under it sorts: a click sorts by that column in its natural order — Name and Tags A to Z (by the first tag, untagged last), Shortcut the keyed ones first, Usage the most opens in the sparkline's window first, Opens, Last opened and Added highest or newest first, Pinned the pinned ones first, Score the worst first — and a second click turns it round. An arrow on the heading shows which way the list runs; **Sort** follows, and picking from **Sort** starts afresh in the natural order. `Enter` or `Space` on a focused heading does the same.

### 11.3 The side panel

Focusing a row opens the side panel: **Details**, **Health** and **Usage**, switched with **`1`/`2`/`3`** or **`[`/`]`**, or **`i`** to open or close the panel itself.

- **Details** edits the bookmark in place — name, URL, page, category, tags (with autocomplete and suggestions), shortcut, note, pin, availability checking and interval. Lists and checkboxes save on change, text fields when you leave them; `Escape` puts the old value back. It also offers **Open**, **Edit in dialog** (`Shift + E`), **Show on dashboard**, **Refresh favicon** and **Delete**. An **Unsorted** bookmark shows a primary **Promote** button here instead of a page and category ([§11.11](#1111-unsorted-and-promote)).
- **Health** shows the availability mode and interval, **Expected response** ([§12.2](#122-expected-response)), and the reasons a bookmark is flagged, each with the score it costs.
- **Usage** shows opens, last opened and the same activity the dashboard counts.

On a narrow window the rail becomes a drawer and the side panel a sheet. What you filtered to is kept in the address, so a filtered list is a link.

### 11.4 Selecting several

Tick rows (`x` / `X` for the whole page shown, or **Select all** in the ⋯ menu) to open the selection bar: page, category, tags (add, replace, remove), pin all / unpin all, checking and interval, **Mute alerts** / **Unmute**, **Re-check**, **Follow redirects**, **Accept drift**, **Rebuild previews**, **Refresh favicons**, **Save a copy on this disk**, **Export CSV**, and **Delete**. Fields that differ read *mixed*. The slow ones run one page at a time behind a progress bar, wait out a rate limit, and can be stopped. A selection survives a filter change; bulk changes and moves can be undone from the toast.

### 11.5 The row menu

The row menu (right-click, `Shift + F10`, or `m`) offers open, copy URL, share, **Promote…** (only on an Unsorted bookmark), edit, checking, health details, **Health charts…** (the bookmark's health in large, [§11.9](#119-a-bookmarks-health-in-large)), **Merge…** on a duplicate, filters (only this category, page or tag), and delete.

### 11.6 Keys

| Key | Action |
|---|---|
| `j` / `k`, arrows | Move |
| `g` / `G` | First / last row |
| `Enter` / `o` | Open the bookmark under the cursor |
| `i` | Open or close the side panel |
| `1` / `2` / `3`, `[` / `]` | Details, Health or Usage in the side panel |
| `e` / `Shift + E` | Edit in the side panel / in the full dialog |
| `x` / `Shift + X` | Select a row / a range |
| `d` | Delete (undo is offered) |
| `/` | Search the list |
| `f` | Work through the list |
| `h` | Collection health |
| `Shift + H` (on a row) | That bookmark's health in large |
| `p` | Re-check |
| `s` / `c` | Score / checking, in the Health tab |
| `n` / `z` | Ignore / snooze what the report says |
| `m` | The row menu |
| `Shift + R` | Refresh the health report |
| `Shift + P` / `Shift + C` | Pages and categories over the list |
| `Esc` | Clear the selection, close the panel, then leave the view |

### 11.7 Work through and the header band

Above the list, **Work through** (**`f`**) takes you through the bookmarks that need a decision, one at a time.

**1. Choose a pile.** It opens on a list of piles, each with its count and a line on what it holds. The pile that needs you most comes first:

| Pile | Holds |
|---|---|
| **Broken links** | Down, refused or not found — fix the address or let them go |
| **Changed or wrong content** | Moved, retitled, or no longer the page you saved |
| **Stale** | Not opened within **count as neglected after** — still worth keeping? |
| **Never opened** | Saved and never used |
| **This list, as it is filtered now** | Every bookmark the list shows, in its order — always last |

`↑`/`↓` choose, `Enter` starts, `Esc` leaves. Empty piles are left out.

**2. One bookmark at a time.** The card shows the pile and your place in it (*Broken links · 3 of 12*), the bookmark with its page and category, when it was last opened, its preview, and **Why it is here**: the reasons from the health report. The main button follows from the reason:

| Key | Action | What it does |
|---|---|---|
| `p` | **Re-check now** | Main button for broken and changed links. Checks it again; when the problem is gone it counts as *fixed* and leaves the pile |
| `o` | **Open it and decide** | Main button for stale and never-opened links. Opens it in a new tab; also the **Open** button and the title |
| `e` | **Fix the address** | Opens the bookmark form over the card. A save checks the new address, so a link that answers there leaves the pile |
| `d` | **Delete** | Asks first, then moves it to the trash |
| `y` | **Keep** | Fine as it is: this reason will not come up again for this bookmark. Undo it from the side panel's Health tab |
| `z` | **Ignore 30d** | Silences the reason for 30 days, as the row menu's `z` does |
| `j` / `k` | **Skip** / back | Next or previous card, without a decision |
| `Esc` | | Leaves; the list stays as it was |

Re-check stays in the row beside the main button when that button is Open. Keep and Ignore appear only when there is a reason to silence.

**3. The end of a pile.** Work through counts what the run did — fixed, deleted, kept, snoozed — and offers the next pile that still has bookmarks (**Start: …**), or **Back to the list**.

When the row has a preview nextDash could fetch but the bookmark does not store, its reason reads *"Preview fetched, not saved yet"* and a **Save preview** button (**`s`**) writes it onto the bookmark.

Beside it, the **Collection ▾** menu gathers what a whole-collection toolbar used to hold, in groups:

- **Look at** — **Collection health** (`h`, [§11.8](#118-collection-health)) and **Rot report**.
- **Organise** — **Pages & categories** (`Shift + P`), **Merge duplicate group…** when exactly one group exists, **Turn on checking…** for everything still Off.
- **Checks** — **Retest all**, **Open broken links…**, **Fetch previews…**, **Checking off…**.
- **Export CSV**, **Refresh report** (`Shift + R`), and **Health settings**.

An **ⓘ** beside the menu explains the view.

### 11.8 Collection health

**`h`**, or **Collection health** in the menu, opens a modal over the list with two tabs:

- **Overview** — the score over time, where bookmarks stand, what is wrong by kind, the score distribution, health by page, checking coverage, monitors and certificates.
- **Monitors & trend** — a trend chart over 90 days with series pills (healthy %, score, broken, monitors down, stale, unchecked), and fleet cards: uptime across all monitors, the least available over 7 days, what got slower than last week, and outages.

It fits one screen, and steps its cards down on a small window.

### 11.9 A bookmark's health in large

**`Shift + H`** on a row, or **Health charts…** from the row menu, opens that bookmark's own health in large, with two tabs:

- **Overview** — uptime, response time, days, status codes, outages and the score.
- **Checks** — checks by hour as a heatmap, the certificate, **Kept copies** (how long checks are retained), checks in the last 24 hours, and **Every check**: every check in the period with a search, **Only failures**, and **Export CSV**.

A period select (today, 7, 14, 30 or 90 days) applies across the panel.

### 11.10 Rot report

**Rot report**, under the Collection menu, lists what has gone, what has moved or been rewritten, what has failed for over a month, what is broken and never opened, and what broke this week.

### 11.11 Unsorted and Promote

**Unsorted** holds bookmarks kept from the inbox with no page yet ([§13.5](#135-keeping-a-link-unsorted-and-promote)). They stay off the dashboard, the tag cloud, smart collections and the health summary, but the **Views** block in the rail always shows the Unsorted count, and search reaches them while *Search unsorted bookmarks* is on.

- Opening the Unsorted view swaps the pool: the filters, the search box and the bulk actions work on it exactly as they do on the filed library.
- An Unsorted bookmark's side panel shows a primary **Promote** button in place of a page and category; the row menu has the same entry. Both open the bookmark form, titled **Promote bookmark**, on the last page of the dashboard — pick a page and category and **Save** files it there.
- The **Unsorted widget** ([§15.1](#151-the-kinds)) also opens the Bookmarks view on Unsorted, with that bookmark's side panel already open.

<a id="1112-pages-categories-modal"></a>

### 11.12 Pages & categories modal

**`Shift + P`** / **`Shift + C`**, **Manage** beside Pages or Categories in the rail, or **Pages & categories** in the Collection menu opens a modal over the list for dragging, moving, merging and tidying pages and categories without leaving the Bookmarks view.

### 11.13 Addresses

```
#bookmarks[/<page>]?q=&cat=&filter=&health=&tag=&sort=&rev=&group=
#unsorted
#health                      → redirects here, on Broken
```

`health=` takes one of the Health filter keys (`broken`, `content`, `duplicate`, `stale`, `unused`, `unchecked`, `monitored`, `certificates`, `healthy`, and a few more reachable only from Collection health, such as `drift`); `q=` is a search term; `rev=1` turns the sort round. `Shift + U` and the address `#unsorted` open the view on Unsorted directly.

---

<a id="12-checks-health"></a>

## 12. 💓 Checks & health

### 12.1 Availability modes

Every bookmark has one of three modes:

| Mode | What happens |
|---|---|
| **Off** | Never checked |
| **Periodic** | Checked now and then; flagged when broken |
| **Monitor** | Checked by the server on its own interval (5 minutes to 24 hours, default 15 minutes), with 30 days of history, uptime, outages and alerts. Includes everything Periodic does. |

Set the mode in the bookmark form, the Bookmarks view's side panel, the right-click menu, with **`Shift + C`**, or with **`c`** in the Bookmarks view. On a monitored row the menu also shows the **check interval**: 5m, 15m, 30m, 1h, 6h or 24h.

**Nothing checked at all?** Once 20 or more bookmarks are set to **Off**, a card in the bottom-left corner offers to switch them all to **Periodic** in one go, naming the count. It shows at most once a month; declining once brings it back next month, declining a second time offers to stop asking for good.

**Behavior → Status & alerts** holds the rest:

| Group | Settings |
|---|---|
| **Checks in this browser** | How often, skip fast pings, retries for offline bookmarks |
| **Monitored bookmarks on the dashboard** | How much they stand out: only when there is a problem (default), always, or never |
| **Checks on the server** | Re-check in the background and how often, the **check timeout** (5–30 s), **spot pages that answer 200 but say "not found"**, and when certificate warnings start |
| **Downtime alerts** | See [§12.4](#124-alerts) |
| **Maintenance windows** | See [§12.5](#125-maintenance-windows) |
| **Browser notifications** | See [§12.4](#124-alerts) |

**What a check records.** A failure stores its cause — DNS, timeout, refused, TLS, redirect, content or an HTTP status. A failed check is tried again five seconds later and only counts if that fails too. A page that asks *are you a robot*, a rate limit or anything else unclear reads as **unknown**, not broken. Certificates are read from every HTTPS check.

**Services behind a sign-in.** On a bookmark's Health tab, **Expected response** offers:

- **Address to check instead** — for example a status endpoint, while the bookmark keeps its own address.
- **Sign in with** — a stored sign-in. Sign-ins are created in a Custom widget's settings and kept in their own file, outside backups unless you include stored tokens. A sign-in is never sent when a check is redirected to another host.
- **Accept a certificate this machine does not trust.**

### 12.2 Expected response

On a monitored bookmark, **Expected response** opens a panel:

- **Text the page must contain** — a phrase that only appears when the page works. **Fail if present instead** reverses it.
- **Status codes that count as healthy** — `200`, `200-299`, `200,301,401`. By default anything below 500 counts. A code that cannot be read is ignored.
- **Watch for redirects, retitling and rewrites** — drift ([§12.3](#123-drift)).
- **Do not alert me about this bookmark** — muting ([§12.4](#124-alerts)).

Failures of these tests go to the **Content** filter, not Broken. Clearing both test fields clears the failure.

**Pages that say "not found" with a 200.** With **Spot pages that answer 200 but say "not found"** on, a monitored check reads the title and opening text for a not-found message in five languages, and once a day per site asks the host what it does with an address that cannot exist. A site that sends everything to a sign-in page is left alone.

### 12.3 Drift

**Drift** notices a page that still answers but is no longer the page you saved. Tick **Watch for redirects, retitling and rewrites** on a monitored bookmark. The next check becomes the **baseline**; every later check is compared with it.

- **Redirect drift** — the link lands somewhere else. http→https, `www.`, trailing slashes and tracking parameters are ignored.
- **Title drift** — the title changed. Titles like *Domain for sale* or *404* are named outright.
- **Content drift** — the text became a different page.

One finding per check, in that order. The row badge reads *Moved*, *Retitled* or *Changed*; the **Drift** filter (reached from Collection health → what is wrong, by kind, or `#bookmarks?health=drift`) lists them. A page that returns to its baseline clears itself. **Accept drift** on selected rows clears the finding and drops the baseline, so the next check records the page as it is now. Drift reads the page body, so it is opt-in and for monitored bookmarks only.

### 12.4 Alerts

**Downtime alerts** (Behavior → Status & alerts) post when a monitored bookmark goes down and again when it recovers, with how long it was down.

| Service | Needs |
|---|---|
| **Slack**, **Discord** | Webhook URL |
| **Telegram** | Bot URL and chat ID |
| **Gotify**, **ntfy** | URL |
| **Pushover** | Application token and user key |
| **Raw JSON** | Your own receiver's URL |

- **Alert after** — failures in a row before a bookmark counts as down (default 3, 1–10).
- **Send test alert** — sends one made-up failure the same way a real one goes.
- **ntfy** alerts carry **Open link** and **Health** buttons, and a failure is sent at a higher priority than a recovery. Fill in **Address of this dashboard** for the Health button; it links to `/#health`, which redirects into the Bookmarks view.
- Local addresses are refused unless *Allow local bookmarks* is on.
- **Many at once** — when a host takes many bookmarks down together, the alerts are collapsed into one message. Certificate warnings are always separate.
- **Certificates** — warnings at 30, 7 and 3 days before expiry, through the same channels, and to any webhook subscribed to `health.cert-expiring` ([§19.3](#193-webhooks)).

**Muting one bookmark.** Tick **Do not alert me about this bookmark** in its Expected response panel. It is still checked and shows as down with a *Muted* badge; only the message is held back. Un-muting during an outage still alerts. **Mute alerts** and **Unmute** in the Bookmarks view's selection bar change several rows at once.

**Browser notifications** reach a device even with nextDash closed. Switch them on from the dashboard card or under Behavior → Status & alerts, then press **Enable on this device** and allow notifications. A test notification follows.

| Notifies about | Default |
|---|---|
| Downtime and recovery | On once enabled |
| Automatic backup results | Off |
| A new release | Off |

They need a secure context: Safari and every browser on iPhone and iPad require HTTPS (not `http://localhost`); desktop Chrome, Edge and Firefox also accept `http://localhost`. On iPhone and iPad, add nextDash to the home screen first. Subscriptions live in `data/push-subscriptions.json`; deleting it unsubscribes every device. **Show the invitation again** brings the card back.

### 12.5 Maintenance windows

A window is a recurring period when downtime is expected — days, a start and an end. An end before the start runs past midnight. Windows apply to every monitor.

Inside a window, checks still run and the heartbeat still records them, but a failure opens no incident, does not count against uptime and sends no alert. A failure that continues after the window raises the alarm as usual.

### 12.6 Fresh

**Fresh** shows whether a bookmarked site has published something since you last opened it.

- Switch it on under **Behavior → Fresh**. It reads each saved page once for an RSS or Atom feed and remembers pages without one for a month. **Find feeds now** repeats the round and says how many bookmarks publish a feed.
- A bookmark with news carries a count on its row, and the **Fresh** collection lists them, newest first. Opening the bookmark clears the count.
- Feeds are polled on the background re-check interval with conditional requests. A feed that fails five times in a row is dropped.
- The bookmark editor shows a **Feed** line when there is one. `status:feed` / `-status:feed` search for them. **Mark rows that publish** (off by default) puts a quiet dot on those rows.
- Fresh stores no articles, only counts. It is off by default because it contacts other servers on a schedule. A walkthrough is under Config → Help → Monitoring.

### 12.7 Keeping a copy of a page

Set up under **Data & backups → Sources**.

- **Web Archive** — **Archive new bookmarks** asks the Internet Archive to keep a copy the day you save a link. An archive.org key pair ([archive.org/account/s3.php](https://archive.org/account/s3.php)) raises the daily allowance; **Save a copy…** tests it. The panel says what became of a capture.
- **Local copies** — saves a whole page (text, styling, images) as one file in your data directory, using [monolith](https://github.com/Y2Z/monolith), which the container includes. Pages up to 52 MB. **Bookmarks → Local copies** lists copies per bookmark, says why a copy failed or saved an empty page, and can remove them all (it says how much space that frees).
- **archive.today** — a second archive that keeps what it captured.

On a bookmark's Health tab, **Find in Web Archive** reads the archive's index for the last capture that was a real page.

---

<a id="13-inbox"></a>

## 13. 📥 Inbox

The inbox holds links you want to keep before you decide where they go. Items live in `data/inbox.json`.

### 13.1 Getting links in

- **Paste** a URL on the dashboard and choose **Save to Inbox** — or set **Always save to Inbox** under Config → Inbox → Collecting → Paste destination.
- **The extension** — **Save to Inbox** in its popup, the right-click entry, or `Ctrl/Cmd + Shift + U`.
- **The share sheet, the bookmarklet and `/add`** — see [§21](#21-browser-extension-and-capture).
- **The API** — `POST /api/inbox`.

A URL already in the inbox is not added again: a toast says *Already in Inbox* and the view jumps to it.

### 13.2 The view

Open it with **`Shift + I`**, the inbox icon or `:inbox`.

- **A rail of filters** on the left, each with its count: **All**, **Unread**, **Snoozed** and **With note** (the last two only when they hold something) — it can fold behind a **Filters** button (Config → Inbox → Panel & clicks). *This week* is a readout above them.
- **Narrowing** — by site, by tag (click a tag chip) and by search. Every count follows what is shown, and *Mark all read* becomes *Mark shown read*.
- **Sort** — newest first (default), oldest first, title or site. The column headings sort too: **Title** and **Site** A to Z, a second click Z to A; **Added** switches between newest and oldest first. Under Snoozed, which keeps its wake order, the headings do not sort.
- **Rows** are one line each and follow the app-wide density; the header stays in place. There are no tabs — a kept link goes straight to Bookmarks → Unsorted, not to a second list here ([§13.5](#135-keeping-a-link-unsorted-and-promote)).
- **The side panel**, in the same style as the Bookmarks view's, shows the link in focus: Open, Promote, Keep, note, tags — suggested tag chips live in its Tags section — details and delete.
- **The address** keeps filter, sort, site, tag and search (`ib_filter`, `ib_sort`, `ib_dir`, `ib_domain`, `ib_tag`, `ib_q`); filter, sort and site also return next time.
- The **ℹ** explains the inbox; a sentence under the toolbar explains the active filter.

### 13.3 Acting on links

| Key | Action |
|---|---|
| `j` / `k` | Move |
| `g` / `G` / `Home` / `End` | First / last |
| `Enter` | Open the side panel |
| `o` / `Space` | Open the link |
| `p` | Promote to a bookmark |
| `n` | Note |
| `r` | Mark read |
| `Shift + K` | Keep — to Bookmarks → Unsorted (undo in the toast) |
| `z` | Snooze |
| `x` | Tick and move on |
| `Shift + ↑/↓`, `Ctrl/Cmd + A` | Extend / select all shown (again to untick) |
| `d` | Delete (undo in the toast) |
| `u` | Mark unread |
| `l` | Edit tags |
| `t` | Triage |
| `R` | Reload |
| `Esc` | Clear the selection, then back to the queue, then back to the bookmarks |

- **Read** — a link is unread until opened or marked read. `u`, or the right-click menu, marks it unread again.
- **Snooze** — three hours, tomorrow, the weekend, next week, or a date (waking at 09:00). A snoozed link is left out of every count; a line under the list says how many are asleep. **Wake now** brings one back.
- **Notes and tags** — plain-text notes; tags from the capture show as chips in the side panel's Tags section, and can be edited from there or the right-click menu.
- **Promote** — opens the bookmark form filled in, with every page and category. The inbox entry goes when the bookmark is saved.
- **Keep** — takes a link out of the queue for good, with its note and tags, and puts it on Bookmarks → Unsorted. A toast says *"Kept — in Bookmarks → Unsorted"*, with **Undo**; the row flies toward the Bookmarks icon.
- **Several at once** — promote (to one page and category), keep, tags, open, copy links, mark read, snooze, delete — each with undo. **Select all** in the ⋯ menu ticks every link the filters leave, and reads **Deselect all** once they all are.
- **Mark all read** and **Clear read** — for the whole (shown) list. Clear read leaves snoozed links alone.
- **Stats** — how many links were added, promoted and deleted, and how long links wait.
- **Export and import** — CSV and JSON of what is shown; **Import** reads a JSON export back and skips links already there.

### 13.4 Triage

**Triage** (the button, `t`, or `:inbox triage`) takes you through unread links one at a time, in the same shape as Work through ([§11.7](#117-work-through-and-the-header-band)).

**1. Choose a pile.** Triage counts unread links that are not snoozed. The fullest pile comes first:

| Pile | Holds |
|---|---|
| **Waiting longest** | Unread for over a week, oldest first |
| **New this week** | Saved in the last week, newest first |
| **With a note** | Links you left yourself a reason on |
| **This list, as filtered now** | Every unread link the list shows, in its order — always last |

`↑`/`↓` choose, `Enter` starts, `Esc` leaves. Empty piles are left out; with nothing unread, triage says *Nothing to triage*.

**2. One link at a time.** The card shows the pile and your place in it (*Waiting longest · 1 of 3*), the link, its preview, and **Where it came from**: how it arrived (the browser extension, a paste, another app, an import, or by hand), how long ago, whether it was ever opened, and your note.

| Key | Action | What it does |
|---|---|---|
| `p` | **Promote to a page** | The main button. Opens the bookmark form to file it on a page; after the save, triage carries on at the next link |
| `Shift + K` | **Keep in Unsorted** | Makes it a bookmark in **Bookmarks → Unsorted** without a page ([§13.5](#135-keeping-a-link-unsorted-and-promote)) |
| `n` | **Note** | Adds or edits the note; the card stays |
| `d` / `Delete` | **Delete** | Removes it from the inbox |
| `z` | **Snooze** | Picks when it comes back; it leaves the pile until then |
| `r` | **Mark read** | Marks it read and moves on |
| `o` / `Enter` / `Space` | **Open** | Opens it in a new tab and marks it read |
| `j` / `k` | **Skip** / back | Next or previous card |
| `Esc` | | Back to the list |

**3. The end of a pile.** Triage counts what the run did — promoted, kept, deleted, snoozed, read — and offers the next pile that still has links, or **Back to the inbox**.

### 13.5 Keeping a link: Unsorted and Promote

There is no Kept tab any more. **Keep** — `Shift + K`, the row button, or the right-click menu — takes a link straight to a hidden page called **Unsorted**, in the Bookmarks view, rather than to a second inbox list. **`Shift + U`** or the address `#unsorted` opens the Bookmarks view there directly.

An Unsorted bookmark stays off the dashboard, the tag cloud, smart collections and the health summary. It is promoted onto a real page from its **side panel** (a primary **Promote** button) or its **row menu**, in the Bookmarks view — the same bookmark form Inbox's Promote uses, titled **Promote bookmark**, opening on the last page of the dashboard. Search still reaches Unsorted bookmarks while **Search unsorted bookmarks** (Behavior → Keyboard & search) is on, and the **Unsorted widget** shows them on a dashboard page, newest first, at random or by tag; its overflow row reads **Open Unsorted**. See [§11.11](#1111-unsorted-and-promote) for the full picture from the Bookmarks view's side.

### 13.6 Settings

Inbox settings moved to their own config section — **Config → Inbox** ([§17.6](#176-config-inbox)): whether the inbox is on at all, showing it in the header, quick-adding a pasted URL, keeping links without filing them, filing a kept link where its neighbours already are, the paste destination, and removing an inbox entry once it is promoted.

The first visit plays a five-step tour: the waiting room the inbox is, the three ways a link leaves (promote, keep, delete), where a kept link goes (Bookmarks → Unsorted), how to keep one, and the keys. **Tour**, above the list, plays it again; so does Behavior → Privacy & sync → Onboarding.

---

<a id="14-containers"></a>

## 14. 🐳 Containers

The **Containers view** shows the Docker containers on the machine nextDash runs on — the same connection the Containers widget and system widgets use. It needs the Docker socket ([§14.6](#146-what-it-needs)).

> [!IMPORTANT]
> It needs setting up first: the Docker socket, `NEXTDASH_DOCKER_CONTROL=1` for actions, a write token, and on some hosts `NEXTDASH_RUN_AS_ROOT=1`. See [§14.6](#146-what-it-needs).

### 14.1 Opening it

Open it with **`Shift + Y`**, the Containers icon in the header, `:docker`, or `/#docker`. Search also finds containers by name, and the **Containers** widget's tile opens the view. Two tabs sit above the list: **Containers** and **Disk** ([§14.7](#147-disk)).

### 14.2 The list

| Filter | Shows |
|---|---|
| **All** | Every container |
| **Running** | Containers that are up |
| **Stopped** | Containers that are down or paused |
| **Updates** | Containers with a newer image waiting |

**Group by status** folds the list under Updates, Running, Paused and Stopped, each band with its count (*Updates · 9*); **group by project** folds it under each compose project, and a project's row has **Start**, **Stop** and **Restart** for the whole stack, and **Update (n)** for the *n* containers in it with an update waiting — not a skipped or held version, not an image no check has looked at. Stop and Update ask first, naming the containers, and they go one at a time.

Each row shows its name, image, status, **CPU** and **RAM**, its **Size** — what the container wrote, with the size including its image on hover — a link to its web UI and its ports. A container with an update waiting has an orange **↑** in front of its name. Name and image stay on one line, cut short with the whole text on hover, and the image drops its registry host and a `:latest` tag (`lscr.io/linuxserver/sonarr:latest` reads `linuxserver/sonarr`). The first three published ports show in the row; more go behind **+N**, which opens a list of all of them with the port inside the container and tcp or udp. A port published for both counts once in the row. Sizes are measured in the background every half hour (the Docker daemon takes a while to work them out) and when Disk is refreshed; a container not measured yet shows —. CPU and RAM are the last reading, taken every 30 seconds; they are there while **Config → Containers → Keep the last hour of CPU and memory** is on. On a narrower screen the Image column goes first (below 1100 pixels), then CPU, RAM and Size (below 900). Click **Name** or **Status** to sort, and again to turn the order round; the sort menu also offers uptime, CPU and memory, highest first.

The web UI link is the address you set in the side panel's **Custom** section, else the one the container's own labels offer (Unraid's template), else its first published TCP port. A local address shows as its port (`:8123`), another as its host. A port link goes to the host you opened nextDash on unless **Config → Containers → Docker host address** names the server — its LAN address or name only, without `http://` or a port, for example `192.168.1.10` or `tower.local`, so port 8080 opens `http://192.168.1.10:8080`. A line under the field checks what you type and cuts a full `http://…:8080` down to its host when it is saved; opened through a domain — a reverse proxy — that is rarely right. While the address is empty the view says where port links point, above the list, with a button to that setting and one to dismiss the note; an address of your own has a dot in front of it, and a long one is cut short, with the whole address on hover.

**Selecting several.** Tick containers with the box in front of the name, `x` or `Space`; `Shift`-click a box, `Shift + X` or `Shift + ↑/↓` ticks a run, and `Ctrl/Cmd + A` ticks everything the filter shows (again to clear). A bar above the list then offers **Start**, **Stop**, **Restart**, **Update**, **Remove** and **Mute notifications** for the lot, one container at a time with a count, and ends with one notice such as *3 restarted, 1 failed*. **Remove** asks once, naming the ones that still run, and stops those first; `⌫` or `Delete` with containers ticked does the same, and so does a right-click on one of the ticked rows, whose menu then offers the bar's actions for all of them. The container nextDash runs in is left out. Without actions switched on ([§14.6](#146-what-it-needs)) the bar offers only muting. **Clear selection** or `Esc` lets go. The header badge counts containers with an update waiting; a skipped or held update does not count.

### 14.3 The side panel

Selecting a container opens its side panel, with four tabs. Its head shows the container's web UI address under the name, tagged **Custom** when it is one you set; the tag opens the Custom section. A click beside the panel closes it, one on another row moves it there (**Config → Containers → Close on a click beside it**).

- **Overview** — an accordion of **Details**, **Health**, **Updates**, **Timeline**, **Network**, **Custom**, **Volumes** and **Environment**. **Health**, for a container with a healthcheck, shows its status, how many checks failed in a row, the command, and the last five checks with their exit code and output. **Updates** is [§14.5](#145-actions-and-updates). **Timeline** is what happened to the container, newest first: starts and stops (by you or by nextDash), crashes with their exit code, out-of-memory kills, a run of crashes as one *Kept restarting* line, health changes, pauses, updates and rollbacks. nextDash writes these down from Docker's own events, whatever the notices are set to — a hundred per container, for thirty days, from the moment this version runs. **Details** also gives its size (written, and with its image) and says whether its notices are on, muted or off. **Custom** holds the container's **Web UI address**: an `http://` or `https://` address of your own, where `[IP]` stands for this server. Empty uses the container's default. The address is used everywhere the web UI opens: the list, the Container list widget and `:docker <name> open`. **Back to the default** removes it.
- **Resources** — CPU, memory and I/O for that container, with two charts under them: CPU and memory over the last hour. nextDash samples the running containers every 30 seconds and keeps the samples in memory, so a restart starts the charts again. **Config → Containers → Keep the last hour of CPU and memory** switches the sampling and the charts off.
- **Logs** — the last lines, with **Refresh** and **Open logs window** ([§14.8](#148-the-logs-window)).
- **What’s new** — the release notes behind an available update.

### 14.4 Keys

| Key | Action |
|---|---|
| `↑` / `↓` | Move through the containers |
| `x` / `Space` | Tick or untick the selected container |
| `Shift + X` / `Shift + ↑/↓` | Tick a run of containers |
| `Ctrl/Cmd + A` | Tick every container the filter shows; again to clear |
| `Enter` | Open the side panel |
| `/` | Search the containers |
| `s` | Start or stop the selected container |
| `r` | Restart it |
| `p` | Pause it |
| `u` | Update it |
| `⌫` / `Delete` | Remove it (asks first; a running one is stopped first); with containers ticked, the ticked ones |
| `l` | Open its logs window |
| `m` | Mute or unmute its notices |
| `d` | Switch between the list and Disk |
| `Esc` | Clear the ticks, then the selection, close the panel, then leave the view |

The legend above the list names them; **Config → Containers → The key legend** puts it below the list or hides it. Without actions switched on, the legend leaves out the keys that act on Docker.

### 14.5 Actions and updates

Starting, stopping, pausing, restarting, updating and removing a container are all behind **`NEXTDASH_DOCKER_CONTROL=1`**, on top of the write token if the install has one — read-only access to the socket is not enough by itself. Update and remove always ask first; **Config → Containers → Safety** can add the same confirmation to stop and restart.

Image update checks run on request and on an interval (Config → Containers → Updates: off, 6, 12 or 24 hours), asking the image's registry whether a newer tag is available. An optional GitHub token (Config → Containers) raises the rate limit for images hosted there. The container nextDash itself runs in refuses stop, pause, restart, remove and update.

The side panel's **Updates** part says where the image stands and keeps your say over it:

- **Skip this version** — the version on offer stops counting as an update: no badge, no count, and an update of a selection leaves it out. A newer version counts again. **Undo skip** takes it back.
- **Hold updates** — the image never counts as having one until you choose **Resume updates**; the row shows a quiet *held* label.
- **History** — what updates did, newest first, with the versions where the image names them.
- **Roll back to …** — while the image the last update replaced is still on the host, this puts the container back on it after asking: the old image gets its tag back and the container is recreated on it, without a download. The version it leaves is skipped, so it is not offered straight back. Pruning dangling images ([§14.7](#147-disk)) removes the images a rollback needs.

Updating by hand still works on a skipped or held image.

### 14.6 What it needs

> [!IMPORTANT]
> **Nothing in this chapter works until the container can reach Docker.** Four settings decide what the view can do:
>
> | Setting | Needed for | Why |
> |---|---|---|
> | Mount `/var/run/docker.sock` and set `NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock` | Seeing anything at all | nextDash talks to Docker through its socket. Without it the view shows a setup card and the Containers widget is hidden. `:ro` is enough to look. |
> | `NEXTDASH_DOCKER_CONTROL=1` | Start, stop, pause, restart, update, remove | Off by default, so a mounted socket only reads. |
> | `NEXTDASH_WRITE_TOKEN` | Keeping other sites and scripts out | Access to the socket is root on the host: `:ro` on the mount does not stop the Docker API from accepting writes. The token refuses requests that do not carry it — another website, a script that only knows the address. It is not a login: the dashboard gives it to every browser that opens the page. Keeping the actions yours also needs a gate in front — Tailscale, or a reverse proxy with authentication ([§23](#23-security-and-self-hosting)). |
> | `NEXTDASH_RUN_AS_ROOT=1` | Only when the socket belongs to gid 0 | See below. |

**Why root is sometimes needed.** The container starts as root, fixes the ownership of `/app/data`, then drops to its own `nextdash` user. Before it does, it looks at the group that owns the socket and adds `nextdash` to it — the `docker` group, gid 281 on Unraid — so the unprivileged user can read the socket. When the socket is owned by root's own group (gid 0), as on Docker Desktop and some NAS systems, joining that group would amount to root anyway, so the entrypoint does not; the log then says `nextdash: /var/run/docker.sock is owned by gid 0; set NEXTDASH_RUN_AS_ROOT=1 to use it`, and Config → Containers shows **No access to the socket**. `NEXTDASH_RUN_AS_ROOT=1` keeps the whole app running as root. Set it only in that case.

**Docker Compose:**

```yaml
services:
  nextdash:
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
      - NEXTDASH_DOCKER_CONTROL=1
      - NEXTDASH_WRITE_TOKEN=change-me-to-a-long-random-string
      # - NEXTDASH_RUN_AS_ROOT=1        # only if the log says "owned by gid 0"
```

**Unraid** (Docker → nextDash → Edit):

| Config Type | Name | Container Path / Key | Host Path / Value |
|---|---|---|---|
| Path | Docker socket | `/var/run/docker.sock` | `/var/run/docker.sock` |
| Variable | Docker socket variable | `NEXTDASH_DOCKER_SOCKET` | `/var/run/docker.sock` |
| Variable | Write token | `NEXTDASH_WRITE_TOKEN` | a long random string |
| Variable | Docker actions | `NEXTDASH_DOCKER_CONTROL` | `1` (the template starts at `0`) |
| Variable | Run as root | `NEXTDASH_RUN_AS_ROOT` | leave at `0` |

All five are in the template. **Docker actions** starts at `0`, so the view only reads until you set it to `1`. Unraid's socket belongs to the `docker` group, so **Run as root** stays at `0` there.

**Synology and QNAP** use the same `/var/run/docker.sock` path. If the log names gid 0, add `NEXTDASH_RUN_AS_ROOT=1`.

**Checking it.** Config → Containers shows the connection as the server sees it: whether the socket answers, whether actions are on, whether a write token is set, and whether nextDash recognises the container it runs in. [§15.4](#154-system-widgets-and-what-they-need) covers the same socket for the Containers widget and the other system widgets.

### 14.7 Disk

**Disk** (the tab beside Containers, `d`, or `/#docker/~disk`) shows what images, volumes and the build cache take up. Measuring is slow on a large host, so it happens when you open the tab and on **Refresh**; after that the rail shows **Disk used** and **Reclaimable**.

| Tile | Clears |
|---|---|
| **Unused images** | Every image no container uses — a container that needs one later downloads it again |
| **Dangling images** | Untagged images — among them the ones a rollback would go back to; the tile names those containers |
| **Build cache** | What `docker build` left behind |
| **Unused volumes** | Nothing in bulk: volumes hold data, so they go one at a time |

Every clean-up asks first and says how much it frees. Below the tiles, the images and volumes are listed biggest first, with what uses them; an untagged image that is still a container's way back says *rollback for …*. An unused volume has **Remove…** on its row: type **delete** to go on. A volume a container holds — a stopped one included — cannot be removed.

**Bind mounts** lists the host folders containers mount, with which container mounts each where (`sonarr → /config`). On Unraid that is where container data lives — `/mnt/user/appdata/…` — so the Volumes list is mostly empty there, or holds anonymous volumes (long hex names) that containers left behind. A folder is not a volume: Docker neither measures nor removes it, so the list has no size and no **Remove…**. The Docker socket and host files such as `/etc/localtime` are left out. All of it needs `NEXTDASH_DOCKER_CONTROL=1`; without it, Disk shows the sizes only.

### 14.8 The logs window

**Show logs** in the row menu, `l` on the selected row, `:docker <name> logs`, or **Open logs window** in the side panel opens a window over most of the page (the whole screen on a phone) that follows the container's log as it is written.

- **Following** — scroll up and it pauses, counting what arrives meanwhile; **Jump to latest** catches up. `f` does the same.
- **Search** marks every match; `Enter` and `Shift + Enter` step through them. **Filter** keeps only the matching lines.
- **All / stdout / stderr**, how many lines to start with (100 to 1000), timestamps and wrapping — remembered in this browser. stderr lines are red.
- **Copy** takes the lines on screen; **Download** saves the loaded lines as a `.log` file.
- When the container stops the stream ends; **Resume** picks up after the last line.

`/` searches, `Esc` closes. Reading logs sits behind the write token, as the side panel's Logs does.

### 14.9 Notices

When a container **stops unexpectedly**, **keeps restarting** (three crashes in ten minutes) or **turns unhealthy**, nextDash sends a notice — and a second one when it recovers. A stop you or nextDash asked for is not a notice, and neither is a crash the restart policy fixes within 30 seconds. One notice per incident; four or more at once become one message.

They go where Health's downtime alerts go: the alert webhook under **Behavior → Status & alerts → Downtime alerts** (with its presets), and browser notifications with **Notify when a container stops, keeps restarting or turns unhealthy** switched on. **Config → Containers → Notifications** switches them off. Mute a single container from its row menu, its side panel's ⋯ menu, or `m`; **Muted containers** lists them and says where notices go. Hidden containers and nextDash's own raise nothing.

---

<a id="15-widgets"></a>

## 15. 🧩 Widgets

A page holds categories and, beside them, **widgets**: blocks that show something other than links. Categories and widgets share one order.

### 15.1 The kinds

*Are the links still good?*

| Kind | Shows |
|---|---|
| **Health** | Broken, down, changed and fine; each figure opens its filter |
| **Uptime** | Monitored bookmarks, worst first, with a heartbeat |
| **Certificates** | Certificates close to expiry, per host |
| **Health trend** | How the collection's health has moved, drawn like the summary in Collection health |

*What is arriving?*

| Kind | Shows |
|---|---|
| **Inbox** | How much is waiting, and how old the oldest is |
| **Unsorted** | Links kept from the inbox without a page yet — newest first, at random, by one tag or grouped under every tag, with each address under its title. A row opens the Bookmarks view on Unsorted, with that bookmark's side panel; the overflow row reads **Open Unsorted**. |
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
| **Containers** | Running and total containers, failing healthchecks and recent restarts; opens the Containers view, and its update figure links to `#docker?filter=updates`. The figures you tick can add **updates waiting** (a skipped or held one does not count), **reclaimable** disk space — what the Disk tab last measured, measured again in the background once it is six hours old, a dash before the first — and **incidents** in the last 24 hours (crashes and turns unhealthy, from the timeline). **Name the three busiest by CPU** lists them under the figures. Nothing ticked means every figure. |
| **Container list** | The containers themselves, one row each: one column on a narrow tile, two on a wide one. Its settings choose **running only** or **all**, the order (**problems first**, name, longest or shortest uptime, CPU or memory — busiest first), what stands on the right of a row (uptime, the image tag, CPU and memory, or nothing) and where a click goes: the container in the Containers view, or its web UI. A problem — unhealthy, stopped, an update — replaces the uptime on its row. |

*What is happening around you?*

| Kind | Shows |
|---|---|
| **Weather** | Current conditions and a forecast (3 days, 5 days or 24 hours), from the settings under Appearance → Date & weather; wide, it adds what it feels like, the wind, the humidity and the chance of rain |
| **Calendar** | What is coming up, from the **Calendar feed URL (.ics)** under Appearance → Date & weather |
| **RSS** | The newest articles from up to ten feed addresses set on the widget, merged newest first |

And the **Custom** widget, which reads any service that answers with JSON ([§15.5](#155-the-custom-widget)).

A tile with a row limit shows what it left out (*5 of 12*). A figure on a tile is a link to the rows behind it.

### 15.2 Adding and arranging

**Config → Widgets** lists your widgets. **Add a widget** opens the catalogue; the **Types** tab describes every kind with an *Add* button. The list has a search (title and type), a page picker (including **All pages**), a sort (grouped, page order, name, type) and a selection bar with **Show**, **Hide**, **Move to page…** and **Delete**.

Each widget has a title, a width (one or two columns), the page it counts, a row count and the settings of its kind. An **ℹ** explains the harder settings and **↺** resets them. The title and **Shown** save at once; the rest waits for **Save**.

Widgets are ordered with the categories under **Structure → Categories**, or dragged on the dashboard. On a one-column dashboard — and on a phone — a wide widget narrows itself and keeps the important half.

**Two columns say more, not the same thing larger.** A tile drawn wide adds the readings a narrow one leaves out: the load average behind the processor's percentage, the container that is failing by name, used and total beside free space, what the weather feels like, the date a certificate expires, when an import last ran. Lists of rows run in two files instead of one. This follows the width the tile actually got, so narrowing the dashboard takes it back at once.

### 15.3 On the dashboard

- Click the title, or `Enter` on the header, to fold a widget. `.` folds everything. The state is kept per page.
- Right-click the title to rename, change the width, fold, open the settings or **close** it. Closing hides it and keeps its settings; Config → Widgets switches it back on.
- The arrow keys walk through a widget's rows; `Enter` does what a click does. See [§7.4](#74-acting-on-a-category-or-widget).
- Widgets that read something outside refresh on their own interval, and not at all while the tab is hidden.

**Calendar** — your server fetches the feed (the private ICS address from your calendar app, not its web page), shares one copy between widgets and refreshes it every 15 minutes. A recurring event shows its first stated occurrence. Changing the address redraws the widgets at once.

**RSS** — your server fetches each feed and caches it for 15 minutes. A headline shows the feed's summary on hover or focus. Rows past the row count fold into a **more** row. A feed that fails does not empty the tile.

### 15.4 System widgets and what they need

Processor, Memory, Disks, Containers and Container list report on the machine nextDash runs on. The Containers view shares the same connection. Running the binary directly needs no setup. In a container:

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

**Containers** need the Docker socket, for the widget and the Containers view alike. Read-only still exposes the daemon's whole read API — every container, image, environment and mount. Use a socket proxy if that is too much.

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
environment:
  - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
```

A read-only mount is enough to look. Starting, stopping, updating and removing containers from the Containers view needs a writable socket and `NEXTDASH_DOCKER_CONTROL=1` — `:ro` on the mount does not stop the daemon's API from accepting writes on a socket that is otherwise reachable, so treat a writable socket as root on the host regardless of the mount flag. On Docker Desktop the socket is `root:root`, so the container may also need `NEXTDASH_RUN_AS_ROOT=1` to reach it.

| Variable | Needed for |
|---|---|
| `NEXTDASH_HOST_PROC` | Processor, Memory (optional; default `/proc`) |
| `NEXTDASH_HOST_ROOT` | Disks (required) |
| `NEXTDASH_DOCKER_SOCKET` | Containers widget and view (required; unset hides both) |
| `NEXTDASH_DOCKER_CONTROL` | Containers view: start, stop, pause, restart, update and remove (`1`; needs a writable socket) |

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

### 15.5 The Custom widget

The Custom widget reads figures from any service that answers with JSON.

- **Address and method** — any `http`/`https` endpoint, `GET` or `POST`. Your server makes the request, so a machine on your network is reachable and no key reaches the browser. The widget only reads.
- **Sign-in** — an API key in a header, a key in the address (the stored address keeps a `YOUR_KEY` placeholder), a username and password, or a session sign-in for services such as qBittorrent. Secrets are stored in their own file and left out of backups unless you include stored tokens. A saved key shows as *Set*; the eye button reveals it. Stored sign-ins can also be used by health checks ([§12.1](#121-availability-modes)).
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
<a id="16-appearance"></a>

## 16. 🎨 Appearance

**Config → Appearance** opens straight on its settings, on the tab you used last. Six tabs: **Look**, **Grid**, **Rows**, **Header**, **Action bar** and **Date & weather**. Every setting of a tab is on it, with a short line under each saying what it does.

**The preview.** Beside the settings stands a small drawing of your dashboard — header, grid, a few rows and the action dock. It follows every change as you make it, in your own theme and font, and marks the part the open tab is about: the grid on Grid, the rows on Rows, the header on Header, the clock on Date & weather, the buttons on Action bar. On a narrow window it moves above the settings.

### 16.1 Themes

nextDash ships **155 theme families**, each with a light and a dark half — 310 themes in all. A fresh install starts on **Matrix Bluepill**, cyan code on deep blue, with depth, glow and effects on **Follow the theme**, so the theme draws itself the way it was made.

**Theme** on the Look tab lists every theme by name. Beside it:

- **The theme browser** — **Browse…**, or **`Shift + A`** on the dashboard. One card per family, with a light/dark switch and the line that says what the theme is like to sit in front of. At the top: a search box, the segments *All*, *Favourites*, *Light* and *Dark*, and a row of **character chips** ([§16.2](#162-character)). *Light* and *Dark* turn every card to that half, so moving through the grid previews light or dark themes only; a card can still be switched by hand. Search matches a family's name, its character and the words of its line. The 34 newest families wear a **new** badge, and searching `new` finds them. A star keeps up to 24 families under *Favourites*. Moving through the grid previews each theme on the real dashboard, at the surfaces that theme was drawn for; nothing is saved until you pick one, and **Esc** puts back what you had.
- **Quick mode** — switches between the light and dark half of the family you are on.
- **Follow system dark mode** — shows the light half by day and the dark half by night, following the operating system, also in a background tab.
- **Random theme** — **Off**, **On page refresh**, or **On view change** (switching between the dashboard grid, config, the inbox, the Bookmarks view, Containers or pages). Your saved theme stays underneath and comes back when you turn it off. With follow-system on, only halves that match the current mode are picked.
- **Theme editor** — **Open the theme editor…** recolours any theme, or builds one of your own ([§16.5](#165-custom-themes)).
- **`:theme <name>`** and **`:dark`** switch from the command palette.

<a id="themes-that-catch-the-light"></a>

#### ✨ Themes that catch the light

How a theme catches the light is part of its character, not a group of themes of its own. The shine — a lit band across each surface and a brighter top edge — belongs to the **Lacquer** character; **Enamel** is glazed and rounder, and **Neon** lets the accent leave the surface as a halo. The **Lacquer** chip in the theme browser shows every family that shines.

Ten families still carry *Gloss* in their name, from when they were the only ones that shone: **Gloss Obsidian**, **Chrome**, **Candy**, **Amber**, **Sapphire** and **Rose Gold** are Lacquer; **Gloss Emerald** and **Pearl** are Enamel; **Gloss Neon Tide** and **Ultraviolet** are Neon. Searching `gloss` finds them by name.

The shine is drawn with the glow. When you pick a theme that shines while **Glow** is off, nextDash offers once to turn Glow to *Soft*; with Glow off, it looks matte. **Effects** set to *Off* also leaves the shine out ([§16.3](#163-surfaces)).

**Any theme can shine.** The **Gloss** slider in the theme editor sets how much light a raised surface catches, for a theme of your own or a recoloured packaged one ([§16.5](#165-custom-themes)).

### 16.2 Character

Every packaged theme names one of twelve archetypes. The archetype decides what
kind of surface a theme draws, which is the part a palette cannot say.

| Archetype | What it draws |
|---|---|
| **Lacquer** | A band of light across a polished surface |
| **Glass** · **Frost** | You look through it; frost has stopped being clear |
| **Aurora** | About the page behind everything, rather than the surfaces on it |
| **Neon** | The accent leaves the surface as a halo |
| **Velvet** | Deep and unlit; the light goes into the shadow beneath |
| **Enamel** | Round and glazed at once |
| **Brushed** · **Carbon** | A grain, in one direction or woven |
| **Paper** · **Terminal** · **Ink** | Matte, square-ish, and carried by the type |

The chips in the theme browser filter on it, and searching finds an archetype
by name — or a word from the line each family carries.

A theme's character is editable in the theme editor, for packaged themes as
well as your own: the archetype, the grain's angle and strength, the shine, the
roundness, and the surfaces the theme asks to be drawn at.

### 16.3 Surfaces

These change how any theme is drawn. The first three start on **Follow the
theme**: each theme states what it was drawn for, and picking a theme brings
its answer with it.

| Setting | Choices |
|---|---|
| **Depth** | **Follow the theme** (default) · Flat · Soft · Rich · Vivid · Glass — the steps add a tint in the greys, raised surfaces and a faint wash of light behind the page; Glass blurs what is behind a surface and sits beside the ladder rather than on it. Menus are never blurred. |
| **Glow** | **Follow the theme** (default) · Off · Soft · Full — how far the theme's colour carries around a surface. Flat has no glow. |
| **Effects** | **Follow the theme** (default) · Off · Held back · Full — how loudly the character is drawn: the shine, the glow, the grain, and how round the corners are. Off leaves the palette and nothing else. |
| **Enable animations** | On · Off — off stills the motion across the app |
| **Use these for every theme** | Off (default), the three above belong to the theme you are on and each theme keeps its own; on, they hold across the whole install and a theme brings nothing of its own. |
| **This theme** | **Back to the theme's own** puts the three back to what the theme asks for. |
| **Text contrast** | Soft · Normal · High · Maximum — how far the fainter text sits from its surface |
| **Theme backdrop** | On · Off — the backdrop each theme builds from its own colours |
| **Backdrop** | Follow the theme · Dots · Grid · Lines · Hatch · None |
| **Favicon harmonization** | Off · On, with **Muted**, **Tinted** or **Overlay** and an intensity. Stored per theme, so the light and dark halves are set separately. |

While Depth, Glow and Effects say *Follow the theme*, changing one belongs to
the theme on screen: switch away and back and it is still there, and every
other theme keeps its own.

`:depth`, `:glow`, `:contrast`, `:backdrop`, `:pattern` and `:harmonize` change these from the command palette.

### 16.4 Type and background

- **Typeface** — Source Code Pro, JetBrains Mono, IBM Plex Mono, Inter, IBM Plex Sans, DM Sans or System UI — or **upload a font file**.
- **Weight** — Normal, Semi-bold or Bold. **Size** — seven steps from XS to XL; pointing at a size previews it.
- **Background** — **Auto** (follows the theme), **None**, **Gradient** or **Image URL**. **Opacity** (65–100%) fades it so the bookmarks stay readable. A background of your own is drawn over the theme backdrop.

### 16.5 Custom themes

**Open the theme editor…** on the Look tab opens the editor as a page of its own; **← Look** above it goes back. A link to `/#config/appearance/custom-themes` opens it directly.

- **Your themes** — **Add custom theme**, edit, reorder (↑ ↓), delete, **⤓** export to a JSON file, and **Import theme…**. A theme you make appears in the theme list beside the packaged ones.
- A custom theme can set everything a packaged theme can: its colours, and under **Shape & character** its character, corner roundness, surface opacity, blur, glow, the **Gloss** slider (how much light a surface catches), the grain's direction and strength, the category titles, the backdrop pattern, and the depth and effects it asks to be drawn at. It has a light and a dark half, like the built-in themes.
- A contrast check warns when text is too faint against its background.
- **Packaged themes** — recolour any theme that ships, or the base light and dark palettes. **Reset defaults** puts a theme back.
- Changes preview live on the dashboard behind config; leaving the tab drops an unsaved preview. On a phone the editor is read-only.

### 16.6 Grid and rows

**Grid**

| Setting | What it does |
|---|---|
| **Columns per row** | 1–6 — the most the grid uses. A narrower window takes as many as fit, and one only when two no longer fit; a phone held upright always shows one |
| **Layout preset** | Default, Compact, Cards, Terminal-ish, Masonry, List, Widgets and Launcher (large icon tiles) |
| **Density** | Comfortable, Compact, Dense or Auto — one setting for the dashboard, the Bookmarks view, the inbox and the Containers view |
| **Category spacing** | Snug · Balanced (default) · Airy — the gap between rows of categories |
| **Page margins** | Snug · Balanced (default) · Airy — the empty band left and right |
| **Pack columns tightly** | Categories fill the columns without waiting for a full row |
| **Hide empty categories** | |
| **Launcher icon size** | Small, Normal or Large, for the Launcher preset |
| **Start with categories collapsed** | Every category starts folded |
| **Items per category** | 10–50 or Unlimited: how many bookmarks show before *+ N more*. Unlimited is not available while a category spreads |
| **New categories spread across columns** | Only for categories made from now on ([§9.5](#95-spreading-a-category-across-columns)) |
| **Turning spreading off covers** | The current page or every page — what **Turn off** acts on; it puts every category back to one column |

Small drawings beside the shape settings show what a value looks like.

**Rows**

| Setting | What it does |
|---|---|
| **Show favicons** | Bookmark icons on or off. With icons on, a video's **▶** sits on the corner of its icon; with them off, beside the name |
| **Change bookmark color when offline** | A broken row takes the status colour |
| **Shortcut letters on rows** | **Always** (default; a column down the right of each category) · **Only on the row you are on** · **Never** — the shortcuts keep working in every mode |
| **How a row lights up** | **Subtle** (default) or **Strong** — how far the accent carries across the row you are on |
| **Show online/offline status** | Status colours on the rows; with it, **Show a loading state while checking** and **Show ping times** |
| **Show tags on bookmark rows** | And **Tags shown before "+N"** |
| **Link preview cards** | Off · On hover (default) · Keyboard only, a hover delay (Fast, Balanced, Calm) and **What the card shows**: image, site, author & date, video player, description, your note, tags, status & uptime, opens, Fresh count, shortcut & location ([§4](#4-the-dashboard)) |

### 16.7 Header and action buttons

See [§4](#4-the-dashboard) for what each part does. The settings:

- **Header** tab — button style (plain or boxed), page tabs on/off, page names in tabs, page switcher style, page tabs before *+N*, the dashboard title, and toggles for the dashboard, inbox and config buttons (the Bookmarks and Containers icons are switched under Config → Bookmarks → View and Config → Containers). Also **Clock & weather** — where they stand: beside the view name, in a column of their own, or on their own line — and **Browser tab**: the page name in the browser title, and **Branding**, the page title and favicon, also used when nextDash is installed as an app.
- **Action bar** tab — where the fixed buttons stand (a column on the right by default), action buttons before *+N*, show the action buttons, show the key on each button, slide a docked bar away (2 seconds by default), and one switch per button. See [§4](#4-the-dashboard) for what sliding away looks like and how the bar comes back.

Each group has **Show all / Hide all**.

### 16.8 Date and weather

- **Date & time** — show date, show time, date format, 12- or 24-hour clock. Where the clock and weather stand in the header is set on the Header tab ([§16.7](#167-header-and-action-buttons)).
- **Weather** — on or off, **Location source** (a city you type, or *Automatic (by IP)*), Celsius or Fahrenheit, refresh interval. The Weather widget reads the same settings.
- **Calendar** — **Calendar URL** (the link in the date popover) and **Calendar feed URL (.ics)** (what the Calendar widget reads).

### 16.9 Finding and resetting

Each tab has a filter beside **Only changed**. When the filter — or **Only changed** — finds something on another tab too, the line under the list names that tab with a count (*Also found on: Header 2*); a click opens it and keeps the filter. **↺** resets one setting, **Reset panel** a whole group. `Ctrl/Cmd + Shift + K` finds any setting ([§17](#17-config)).

---

<a id="17-config"></a>

## 17. ⚙️ Config

Config is a **view inside the dashboard**: same tab, no page load.

| To open | To leave |
|---------|----------|
| **`Shift + S`**, **`<`**, the gear, or `/#config` | **`Escape`** (when nothing is open on top and you are not typing), **`Shift + S`**, **`<`**, `0`–`9`, or the browser's Back button |

Config reopens on the section and tab you left, for five minutes after you leave; after that, Appearance and Behavior still open on the tab you used last. A link like `/#config/appearance/layout` opens a section and tab directly and wins over the remembered place; `/#config/bookmarks/<pageId>` opens Bookmarks for one page. Moving between sections is not a browser history step.

### 17.1 The sections

| Section | What lives there |
|---------|------------------|
| **Overview** | The figures of your collection (bookmarks, pages, categories, tags, monitored, with shortcut, pinned, last edited), **Needs attention** with a button per item, **How you use this collection**, the **cleanup score**, and **Health at a glance**. The running version is at the foot. |
| **Appearance** | Look · Grid · Rows · Header · Action bar · Date & weather ([§16](#16-appearance)) |
| **Bookmarks** | View · Tags · Tag suggestions · Your rules · Settings · Local copies ([§17.4](#174-config-bookmarks)) |
| **Inbox** | Collecting · List · Panel & clicks · Header icon ([§17.6](#176-config-inbox)) |
| **Structure** | Categories · Pages · Finders · Collections ([§9](#9-pages-categories-and-collections)) |
| **Behavior** | General · Keyboard & search · Fresh · Status & alerts · Privacy & sync ([§17.5](#175-behavior)) |
| **Data & backups** | Backups & data · Sources · Webhooks · Icons & previews · Trash · Reset ([§19](#19-data-backups-and-import)) |
| **Widgets** | Widgets · Types ([§15](#15-widgets)) |
| **Containers** | Connection · View · Updates · Safety · Notifications · Muted containers · Hidden containers · GitHub token ([§17.7](#177-config-containers)) |
| **Statistics** | Overview · Activity · Content · Inbox · Health ([§18](#18-statistics)) |
| **Help** | The in-app guide |
| **Logs** | Server logs · Activity trail ([§20](#20-logs)) |
| **About** | About nextDash · News & features |

Old addresses still land in the right place — for example `/#config/pages-tags` opens Structure, `/#config/data-backups/logs` opens Logs, and `/#config/behavior/fresh` opens Behavior → Fresh. The tab ids in addresses did not always change when tabs were renamed: Look is `general`, Grid `layout`, Rows `display`, Action bar `buttonbar`.

### 17.2 Tabs and saving

**Appearance** and **Behavior** open straight on their settings, in tabs, on the tab you used last. Every setting of a tab is on it — the ones that change most first — with a short line under each saying what it does. Appearance keeps a live preview of the dashboard beside its tabs ([§16](#16-appearance)).

**Every change saves the moment you make it**, confirmed by a short message. The exceptions are forms with their own **Save** button — the bookmark form and a widget's settings. Config only writes what changed.

- **ℹ** beside a setting explains it.
- **↺** puts one setting back to its default; **Reset panel** puts a whole group back (it asks first).
- **Only changed** hides settings that are still on their default; the filter beside it narrows the tab by label, hint or option. Both name the other tabs of the section where they find something, and a click goes there.

### 17.3 Finding a setting

**`Ctrl/Cmd + Shift + K`** — or **Find settings** below the section rail — searches every section, tab, setting and help topic. It also finds settings by related words (*uptime*, *wallpaper*, *hotkey*) and by their current value (*8099*, *Monitor*), and shows that value beside the result.

**Settings per device.** Settings live on the server, so every browser shows the same dashboard. **Keep settings on this device only** (Behavior → Privacy & sync) keeps appearance and layout in this browser instead. The few settings that stay shared — such as the custom favicon and font, collections and the action bar position — carry an **all devices** mark.

<a id="174-config-bookmarks"></a>

### 17.4 Config → Bookmarks

**View** is the Bookmarks view's own settings, with a live preview (a fixed GitHub example):

| Group | Settings |
|---|---|
| **The list** | Group by (as last chosen, or fixed), open sorted by, rows per load, address in the row (full, domain, hidden), colour rows by health |
| **Columns** | Which columns show — tags, shortcut, pinned, opens, last opened, added, usage, score — and how many days *usage* covers |
| **Rail** | Open or folded to start; which blocks show — Views, Health, Pages, Tags |
| **Side panel** | Opens on the last tab, Details, Health or Usage; close on a click beside it; width (normal or wide) |
| **Clicking** | A click opens the panel or only selects; a double click opens the bookmark or edits it |
| **Health** | Health in large opens on today, 7, 14, 30 or 90 days; a count on the Bookmarks icon, and whether it shows the most urgent kind or every problem added up |
| **Keys** | The key legend below the list, above it, or hidden |

There is no row-height setting here any more — the Bookmarks view follows the app-wide density ([§16.6](#166-grid-and-rows)).

The other tabs:

- **Tags** — rename or delete a tag everywhere ([§10.3](#103-managing-tags)).
- **Tag suggestions** and **Your rules** — [§10.4](#104-tag-suggestions).
- **Settings** — what a new bookmark starts with (checking mode, monitor interval), when bulk actions ask first, the stale threshold, and the archive used for *See an old copy*.
- **Local copies** — [§12.7](#127-keeping-a-copy-of-a-page).

### 17.5 Behavior

| Tab | Settings |
|---|---|
| **General** | Language; remember where you were on a page; **Lock layout**; open links in a new tab; allow localhost and private-network bookmarks; **Hypr mode** |
| **Keyboard & search** | Typing a bookmark shortcut, switch search mode, include finders, search unsorted bookmarks, fuzzy suggestions, prefer matches that start with the query, keep search open when empty, the search hint; and the keys: global shortcuts, shortcut hints on header links, the key legend under the grid |
| **Fresh** | Show what is new since you last looked, mark rows that publish, find feeds now ([§12.6](#126-fresh)) |
| **Status & alerts** | [§12.1](#121-availability-modes) |
| **Privacy & sync** | Analytics, the daily release check, posts from nextdash.cc; **Keep settings on this device only**; onboarding (keyboard tips, review cards, tours, *Show quick-start card again*) |

Paste-to-quick-add, the inbox and how a kept link is filed moved to **Config → Inbox** ([§17.6](#176-config-inbox)).

<a id="176-config-inbox"></a>

### 17.6 Config → Inbox

| Tab | Settings |
|---|---|
| **Collecting** | Enable the inbox, show it in the header, quick-add a pasted URL, keep links without filing them, file a kept link where its neighbours are, paste destination (ask each time, always add bookmark, always save to inbox), remove from the inbox once promoted |
| **List** | Opens on a filter, sorted by, address in the row, mark unread rows, the key legend — with a live preview |
| **Panel & clicks** | The rail open or folded, side panel width, close on a click beside it, a click opens the panel or only selects, a double click opens the link or edits the note — with a live preview |
| **Header icon** | A count on the Inbox icon, and whether it shows what is unread or everything awake |

<a id="177-config-containers"></a>

### 17.7 Config → Containers

No tabs — one page of panels:

| Panel | Shows |
|---|---|
| **Connection** | The Docker socket, actions, the write token and whether this is the container nextDash itself runs in, as the environment set them — nothing here is editable |
| **View** | Show the Containers view, refresh the list every 2, 5, 10 or 30 seconds, log lines to show (100, 200, 500 or 1000), keep the last hour of CPU and memory for the CPU and RAM columns and the charts, close the side panel on a click beside it, and the key legend: above the list, below it, or hidden |
| **Updates** | Check for image updates: off, every 6, 12 or 24 hours |
| **Safety** | Also confirm stop and restart (update and remove always ask first) |
| **Notifications** | Notify about containers — on by default ([§14.9](#149-notices)) |
| **Muted containers** | Where notices go, or that nothing receives them yet, and the containers you muted — × lets one back in |
| **Hidden containers** | Containers kept out of the view, search and the widget count — they keep running |
| **GitHub token** | Raises the rate limit for images hosted on GHCR |

### 17.8 Overview, Help and About

**Overview** is about your collection: its figures, what needs attention, how you use it, how tidy it is and whether the links answer.

**Help** covers Getting started, Tips, Configuring, Appearance, Structure & bookmarks, the **Bookmarks view**, Widgets, Search & keyboard, **Checks & health**, Monitoring, Inbox, **Containers**, Statistics, Data & hosting and Logs. The search above the tabs covers every tab and About. Each topic has a 🔗 button that copies a link to it. A topic about something that can be switched off says whether it is on for you, with a button to the setting. **Tips** lists every keyboard tip, grouped, with its own filter. **Saving a link from anywhere** (Inbox tab) builds a bookmarklet for this install.

**Guided tours.** Six walkthroughs run over the real page rather than a picture of it: *What has changed*, *First steps*, *Inbox*, *Fresh*, *Widgets* and *Spreading a category*. Replay any of them from **Behavior → Privacy & sync → Onboarding**, or by name from the command palette — `:changes` opens the first. *What has changed* is the one offered by a card in the corner after an upgrade that moved things: its steps say where things now are, and where a default changed the step hands the old arrangement back in one click. The release notes stay separate — see *What's new* below.

**About** has two tabs: **About nextDash** (what the project is, and links to nextdash.cc, GitHub, jordibrw.nl and Ko-fi) and **News & features** (every post from nextdash.cc, every release and every setting worth switching on, with source filters, and a button that bookmarks nextdash.cc so Fresh counts its posts).

**What's new.** After an upgrade the release notes open once. After that, the **★** button, `:whatsnew`, or *See what's new* under Help open them, newest first, with up to 50 earlier releases. A small release can count towards the version number without appearing in this window; the [changelog](CHANGELOG.md) always has everything. With **Check GitHub for new releases** on (Behavior → Privacy & sync), a newer release adds a dot to ★ and a toast.

### 17.9 Config keys

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

<a id="18-statistics"></a>

## 18. 📊 Statistics

**Config → Statistics** counts what you have and what you use. Everything is worked out from the data on your server.

Every tab opens with a line on what it is about and a row of **six figures**. Below them the panels stand in two columns, and in one on a narrow window. An **i** beside a panel title explains what it counts.

| Tab | Six figures | Panels |
|---|---|---|
| **Overview** | Bookmarks, healthy share, used in the last 30 days, inbox unread, uptime over 30 days, cleanup score | **Needs attention** — only what is above zero, each line with its button: links not answering (the longest-broken named), a certificate close to expiry or expired, unread inbox items older than 30 days, bookmarks never opened or opened once. **Cleanup score** and what lowers it. **Bookmarks last used, 30 days** and **Healthy share**, each with a link to its own tab |
| **Usage** | Opens all time, used in 30 days, last 48 hours, top 10 share, never opened, opened once | **Bookmarks used over time** (7 days, 30 days, 90 days or 1 year; opens or last used), **When you open bookmarks** (shows from 20 opens), **How concentrated your use is**, **Last opened**, **Times opened**, **Most opened**, **Most used tags**, **Shortcuts**, **Opens by page**, **Finders** |
| **Collection** | Bookmarks, pages, categories, distinct tags, unique hosts (and how many are self-hosted), without a preview | **Coverage** (with a shortcut, an icon, checking, tags, a note), **Categories: size and use**, **How the collection grew**, **Age of the collection**, **Top domains**, **Tags per bookmark**, **Bookmarks per page**, **Beyond bookmarks** (widgets, feeds switched off, import sources, trash, backups), **Cleanup candidates** (untagged, opened once, without an icon, never opened, still on http — *Show* opens them in the Bookmarks view) |
| **Inbox** | Inbox items, unread older than 30 days, oldest unread, backlog over 30 days, converted, time to triage | **Inbox flow per day** (7, 30 or 90 days: added, dealt with, the running backlog), **Where everything went**, **How long unread items have waited**, **Inbox by source**, **How complete the items are**. Lifetime counts live in `data/inbox-stats.json` |
| **Health** | Healthy share, broken, uptime over 30 days, average response, certificates expiring within 30 days, health score | **Status now and over time** (with **Open Health**), **Certificates**, **Issues by type**, **Archive coverage** |

- **Showing** narrows every figure to one page. It appears only when there is more than one page. The inbox and the health report cannot be narrowed, and say so. The choice is not remembered.
- Tiles show the direction since last week. A tag or a table row leads to the bookmarks behind it.
- **Stale** follows **count as neglected after** under Config → Bookmarks, the same threshold the Bookmarks view uses.
- Each tab has a 🔗 to copy a link to it.
- At the top: when the figures were worked out, **Refresh**, and **Export CSV** for every tab. The export fetches the inbox and health figures itself.
- A category is counted per page: the same name on two pages is two categories.

---

<a id="19-data-backups-and-import"></a>

## 19. 📦 Data, backups and import

**Config → Data & backups** has six tabs.

<a id="191-backups-data"></a>

### 19.1 Backups & data

**Last backup**, **Next** and **Stored backups** tiles sit at the top. The last-backup tile turns red when a scheduled run failed.

- **Download backup** — a ZIP of everything, to your computer.
- **Make a backup now** — stores one on the server.
- **Create a backup automatically** and **How often** — every day, week (default), two weeks or month. A run happens whenever the newest backup is older than that, so frequent restarts do not skip it. The newest **three** are kept; `NEXTDASH_AUTO_BACKUP_KEEP` (1–50) changes that and `NEXTDASH_AUTO_BACKUP_DIR` (an absolute path) stores them elsewhere. The default place is `data/auto-backups/`, which is left out of backups. **The panel names the directory it is actually using**, and warns when that is inside the data directory — backups kept there are lost with the thing they back up.
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

### 19.2 Sources

A **source** is a service bookmarks keep arriving from. Each panel asks for its token, where the bookmarks go, and offers **import now** and the last result. Every run **previews** before it writes, and remembers where it got to.

| Source | Needs |
|---|---|
| **GitHub stars** | A personal access token |
| **Raindrop.io** | A test token |
| **Hacker News favorites** | Your username |
| **YouTube channel** | A handle or channel id |
| **Mastodon bookmarks** | An access token from your instance |

nextDash only reads from these services. Tokens are stored in `sources.json` with owner-only permissions and left out of backups unless you include tokens. The **Sources** widget shows the last result of each.

The **Web Archive** and **Local copies** panels live on this tab too ([§12.7](#127-keeping-a-copy-of-a-page)).

### 19.3 Webhooks

Webhooks tell another program the moment something happens here. Add a receiver with a name and an address and tick its events; nothing ticked means all.

| Event | When |
|---|---|
| `bookmark.added` | A bookmark is added, from any route |
| `bookmark.updated` | Name, URL, tags, note, category or pin changes |
| `bookmark.deleted` | A bookmark is removed |
| `health.down` | A monitored bookmark stops answering |
| `health.up` | It comes back |
| `health.cert-expiring` | A TLS certificate is about to run out ([§12.4](#124-alerts)) |

Every delivery is signed with the [Standard Webhooks](https://www.standardwebhooks.com/) scheme:

```
webhook-id: msg_2b7f…
webhook-timestamp: 1756253400
webhook-signature: v1,K5s0…
```

The signature is HMAC-SHA256 over `{id}.{timestamp}.{payload}`, base64. The signing key is shown once, when you save; afterwards the panel only says a key is set. Keys live in `webhooks.json` with owner-only permissions.

A failed delivery is retried twice and then dropped; a `4xx` is not retried; redirects are not followed. **Send a test** posts one delivery and shows the status. Addresses follow the same rules as bookmark checks, checked when saved and again at delivery. Reading the list of receivers needs the write token.

The MCP endpoint is switched on from this tab as well — see [§23.6](#236-the-mcp-endpoint).

<a id="194-icons-previews"></a>

### 19.4 Icons & previews

- **Refresh favicons** — never, monthly, weekly or on every load; **Refresh all favicons** now. `:favicons fetch` does the same from the dashboard.
- **Image cache size** — 50, 200 or 500 MB, with the current use. **Remove cached images** empties it.
- **Refresh all link previews** / **Clear all link previews** — the stored titles, descriptions and images. Refreshing is one request per bookmark, shows progress, waits out a rate limit and can be stopped.
- **Forget the scanned keywords** — what *Read their pages* kept for tag suggestions.

### 19.5 Trash

Deleted **bookmarks, pages and categories** stay in the trash for **30 days** (at most 500 entries). `:trash` opens it. Every route into the trash — the dashboard, the Bookmarks view, single or bulk — lands here.

- **Search** by name, URL, tag, category or page.
- **Restore** puts a bookmark back on its page, at its old position.
- A deleted **page** is one entry (*Page · 12 bookmarks*) and comes back with its categories and bookmarks, in its old place.
- A deleted **category** comes back at its old position; its bookmarks were never removed.
- **Restore selected** restores each ticked entry on its own.
- **Delete forever** and **Empty trash** ask first.

A restore that cannot go ahead is refused and the entry stays: a bookmark or category whose page is gone needs that page first, and a page whose place was taken by another page cannot replace it.

### 19.6 Reset

- **Delete all bookmarks** — keeps pages, categories and settings. Asks once.
- **Reset all data** — deletes pages, categories, bookmarks, finders, settings, custom themes, uploads, icons and caches, and brings back the example bookmarks and default settings. Asks twice; you type **RESET** (or the word in your language).

Make a backup first — neither can be undone.

---

<a id="20-logs"></a>

## 20. 📜 Logs

**Config → Logs** has two tabs.

### 20.1 Server logs

What the server has been doing — background jobs, imports, checks and every request — without shell access. Tiles show the number of lines, warnings and errors, and how long lines are kept.

```
INFO   health   checked 110 bookmarks, 2 failed, 1.4s
WARN   archive  dash.example could not be saved: the page is behind a login
ERROR  store    bookmarks.json could not be written: no space left on device
```

| Control | What it does |
|---|---|
| **Record server log** (toolbar) | Off by default. While off, nothing is captured and nothing is written. Turning it off keeps what was collected. |
| **Detail level** | **Quiet** (problems only), **Normal** (default) or **Verbose** (every step). Applies to the next line, here and in `docker logs`, without a restart. |
| **Show** | Everything, warnings & errors, errors only, or activity only. Only changes what you see; a note says which level is recording. |
| **Search** | On the message and the component, across the whole log |
| **Keep the log** | By age (1 hour to 30 days, or until cleared) or by number of lines (100–5000) — one or the other |
| **Refresh** | Off, or every 2, 5, 15 or 30 seconds while the tab is open |
| **Follow** | Keeps the newest line in view until you scroll up |
| **Copy** / **Download** | The lines to the clipboard, or the log as a `.log` file |
| **Clear** | Empties the log and deletes `server.log` and its rotated copies. Asks first. |

Every line carries its own sequence number from the server. With **Refresh** off, a note says the view does not update by itself; press ↻ for the newest lines.

Lines are kept in memory and in `server.log` in the data directory (2 MB, two rotated copies). The same lines go to stderr.

> Anyone who can open config can read this log, including full webhook addresses where they were logged.

### 20.2 Activity trail

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

<a id="21-browser-extension-and-capture"></a>

## 21. 🔌 Browser extension and capture

### 21.1 The extension

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

### 21.2 Capture without the extension

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

<a id="22-phones-tablets-and-the-installed-app"></a>

## 22. 📱 Phones, tablets and the installed app

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
| **Bookmarks view** | Rail as a drawer, side panel as a sheet | Rail, list and panel |
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
<a id="23-security-and-self-hosting"></a>

## 23. 🔐 Security and self-hosting

nextDash has **no user accounts**. Anyone who can reach the address can read your bookmarks and change them, unless you put something in front of it.

| Setup | When |
|-------|------|
| **Tailscale or another private network** | Access from your own devices only |
| **Reverse proxy with authentication** | Caddy, Traefik or nginx with basic auth, OAuth2 Proxy or SSO |
| **localhost and an SSH tunnel** | A single machine |

**Do not** expose plain HTTP to the internet without authentication.

### 23.1 Production Docker

`docker-compose.prod.yml` mounts only `./data`; CSS and JavaScript are built into the binary. The container starts as root so host Docker hooks can run, then switches to the `nextdash` user (`NEXTDASH_RUN_AS_ROOT=1` keeps root — also needed when the Docker socket is `root:root`, as on Docker Desktop). The compose file sets a 256 MB memory limit. For TLS and long-lived static caching in front of the app, use `docker-compose.proxy.yml` with `deploy/Caddyfile`.

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
  # - NEXTDASH_TRUSTED_PROXIES=10.0.0.0/8
  # - NEXTDASH_CSP=off
  # - NEXTDASH_DISABLE_PREFETCH=1
  # Containers view — add these only once you also mount the Docker socket:
  # - NEXTDASH_DOCKER_CONTROL=1
```

Before it listens, the server checks that `PORT` is valid and that the data directory can be created and written; otherwise it stops with a clear error. The full list of environment variables is in the [README](README.md#environment-variables-reference).

### 23.2 The write token

Set `NEXTDASH_WRITE_TOKEN` and every write or destructive API call — saves, imports, deletes, uploads, resets, backups, retests, preview fetches, container actions — needs the header `X-NextDash-Token`. The dashboard supplies it automatically for pages served by the same install. Unset, nothing needs a token.

**What it stops, and what it does not.** The dashboard gets the token from the page it loads, so every browser that opens nextDash has it. The token keeps out requests that do not come from that page: another website firing requests at your network from a tab you have open, and scripts or scanners that only know the address. It does not keep out a person who can open the dashboard — that is what Tailscale or a reverse proxy with authentication is for. With container actions on, put one in front.

**Choosing one.** Use a long random string, such as the output of `openssl rand -hex 32`. At startup the server logs a warning when `NEXTDASH_WRITE_TOKEN` or `NEXTDASH_CAPTURE_TOKEN` is shorter than 16 characters or still one of the example values from these docs. It still starts.

Read-only routes (bookmarks, settings, the health list, ping) stay open. The extension stores the token under **Settings → Write token**. `GET /api/backup` and the automatic-backup routes need the token, because a backup is the whole library.

**The data directory is not served.** Only `data/icons/` and an uploaded favicon or font are published, with a long cache lifetime. Settings, bookmark files, the inbox, the trash and stored backups are reachable only through the API.

`NEXTDASH_CAPTURE_TOKEN` opens only the two capture routes ([§21.2](#212-capture-without-the-extension)).

### 23.3 Local addresses and outgoing requests

**Allow localhost & private-network bookmarks** (Behavior → General) is on by default. Turn it off when nextDash is reachable on a shared network.

With it off, the server's pings, previews, icon downloads, redirect detection, alerts and webhooks only reach public hosts. Redirects are only followed to hosts that pass the same rule. Addresses are checked again when the connection is made, and a resolved public address is pinned for about two minutes, so a host name cannot switch to a private address in between (DNS rebinding).

**Rate limits** apply per client to the requests the server makes for you:

```bash
NEXTDASH_OUTBOUND_REQUESTS_PER_MIN=120   # previews, pings, favicons, redirect detection
NEXTDASH_SSRF_API_RATE_PER_MIN=60        # /api/bookmark-preview, icon uploads, archives, /api/health/check-url, alert tests
NEXTDASH_STATUS_PING_RATE_PER_MIN=300    # /api/ping, the browser's own status checks
```

Above the limit the API answers **429**, and the `security` channel records it.

**Who a request is counted against.** By default, the address the connection comes from. Behind a reverse proxy that is the proxy for everyone, so the limits are shared by every reader — which is deliberate: `X-Forwarded-For` can be set by anyone, and believing it would let a client hand itself a fresh allowance simply by inventing a new value. Name your proxy to have the header believed:

```bash
NEXTDASH_TRUSTED_PROXIES=10.0.0.0/8, 192.168.1.5   # addresses and ranges, comma-separated
```

Only a request arriving from one of these is taken at its word, and only its first `X-Forwarded-For` entry — the client the proxy saw — is used.

### 23.4 CORS

By default only a browser extension's origin (`chrome-extension://…`, `moz-extension://…`, `safari-web-extension://…`) receives `Access-Control-Allow-Origin`. Any other web page cannot read the API.

`NEXTDASH_CORS_ORIGINS` is a comma-separated allowlist for pages of your own. Extension origins never need an entry. `*` answers every origin.

```bash
NEXTDASH_CORS_ORIGINS=https://dash.example.com
```

### 23.5 Content-Security-Policy

HTML pages send a strict Content-Security-Policy. `NEXTDASH_CSP=off` switches it off when a proxy or integration requires that.

### 23.6 The MCP endpoint

nextDash can answer MCP clients (the Model Context Protocol) at `/mcp`, for example `http://your-host:8080/mcp`. It is **off** until you tick **Answer assistants at this address** under **Data & backups → Webhooks**, which then shows the address.

| Tool | What it does |
|---|---|
| `search_bookmarks` | Search by name, URL, tag or note; each result names its page and category |
| `get_bookmark` | Everything stored about one bookmark |
| `list_tags` | Every tag with its count |
| `add_bookmark` | Add a bookmark, with the usual duplicate check |

It starts closed because it answers questions about every bookmark. The `Origin` of every request is checked against the host it arrived on, and with `NEXTDASH_WRITE_TOKEN` set, adding needs the token.

### 23.7 What nextDash contacts

| What | When | Switch |
|---|---|---|
| Your bookmarks' sites | Checks, previews, icons, Fresh, archives | Per feature |
| GitHub Releases API | Once a day, to see whether a newer release exists | Behavior → Privacy & sync → *Check GitHub for new releases*; `DISABLE_UPDATE_CHECK=true` for the whole server |
| nextdash.cc feed | Every 90 minutes, by the server, for News & features | Behavior → Privacy & sync → *Show posts from nextdash.cc*; `DISABLE_NEWS_FEED=true` |
| Weather and calendar providers | For the header and widgets | Appearance → Date & weather |
| Container image registries and GitHub | Image update checks, when switched on | Config → Containers → Updates |
| Your own services | Custom widgets, webhooks, alerts | Per widget or receiver |
| Analytics | Only when switched on | See below |

### 23.8 Analytics

nextDash can send **anonymous usage statistics** to a self-hosted [Umami](https://umami.is) instance at `stats.nextdash.cc`. It is **off until you turn it on**. The aim is to learn which features are used and what can be improved.

- **Turning it on or off** — the card on the dashboard (*Turn on*, *What is recorded?*, *No thanks*), **Config → Behavior → Privacy & sync → Privacy-friendly analytics**, or `:telemetry on` / `:telemetry off`. The page reloads, because the tracker script is only added to the page when analytics is on. Closing the card without answering asks again later; an answer is final.
- **For the whole server** — `DISABLE_TELEMETRY=true` (also `1`, `yes`, `on`) turns it off for everyone and greys out the switch.
- **When off** — the tracker is not in the page, nothing is downloaded and nothing is sent.

**What is recorded** — event names from a fixed list, with a few properties:

| Area | Recorded |
|---|---|
| Views and navigation | Opening views and config sections and tabs, switching pages by position |
| Panels | Opening search, commands, finders, the cheat sheet, the tag cloud, what's new and the bookmark form |
| Actions | Which command ran (by name), which menu entry was picked, bookmark opens and where from, edits, moves, deletes, checking changes, inbox, health and container actions |
| Outcomes | Whether adding or editing succeeded, or hit a duplicate, conflict or error |
| First-run help | Tours and tips shown and finished |
| Settings | The **name** of a setting you change, and on/off for toggles; once per load, which features are on and the release you run |
| Size | Once per load, bucketed counts (for example `500+` bookmarks) |
| Widgets | Once per load, how many widgets of each type, bucketed |
| Containers | Once per load, how the Containers view is set up: which options are on, whether a socket and control are configured, and bucketed counts of hidden containers, custom addresses and waiting updates. Docker itself is not asked. Per action (start, stop, restart, update, mute and the like): which one, whether it worked, where it came from (row, side panel, menu, key, command, selection bar) and, for a selection, a bucketed count |
| Health, Inbox, Bookmarks view | Once per load, bucketed counts (checked, down, certificates due, unread, snoozed) and the layout options chosen in their Config tabs |

Every count is rounded into a band. **Never recorded:** bookmark names, URLs, search text, page or category names, notes or tag names, container, image or widget names, or any address. No cookies, no profile, no cross-site tracking. This is separate from the open counts in [§6](#6-opening-and-editing-bookmarks), which never leave your server.

### 23.9 Operations

- `GET /version` — version and commit.
- `GET /api/data-revision` — a hash of the bookmark data; open dashboard tabs poll it and refresh when something changes elsewhere.
- Preview data is kept in memory and written to disk every 30 seconds and on shutdown.
- `NEXTDASH_DATA_DIR` sets the data directory; `NEXTDASH_DISABLE_PREFETCH=1` skips the icon prefetch at start-up.

---

<a id="24-troubleshooting"></a>

## 24. 🛠️ Troubleshooting

### The dashboard is empty after install

The example bookmarks may have been removed. Add bookmarks with **&** or **+**, or import a browser file under Config → Data & backups.

### The dashboard does not load

A toast offers **Reload**. Check that the server runs and that `/api/pages`, `/api/settings` and `/api/bookmarks` answer. Broken device settings in the browser fall back to the server's settings.

### A change in another tab does not show

Open dashboard tabs poll `GET /api/data-revision` and refresh when bookmarks change. If a sync fails, use **Retry** on the toast.

### A shortcut does not open its bookmark

- Another bookmark may use the same shortcut — the Bookmarks view's Health filters list shortcut conflicts.
- With the cursor on the grid, `g`, `j`, `k`, `t` and `x` keep their grid meaning; use search for those shortcuts.
- Check **Typing a bookmark shortcut** under Behavior → Keyboard & search — it may be set to wait for a pause or for Enter.
- Focus must not be in a text field.

### Bookmarks seem to be missing

Usually a filter: a tag filter on the dashboard (`Escape` clears it), `Shift + F`, a filter in the Bookmarks view's rail, or a limit on items per category. Deleted bookmarks are in the trash for 30 days.

### An import says "0 new"

Every address already exists on the chosen page, or the file has no http(s) links.

### A bookmark with a private address is refused

The address is `localhost`, `192.168.x.x` or another private host while **Allow localhost & private-network bookmarks** is off (Behavior → General).

### A self-hosted service shows as broken

It probably needs a sign-in, or answers 401. On the bookmark's Health tab in the Bookmarks view, choose **Expected response**: add `401` to the healthy status codes, or pick a stored sign-in ([§12.1](#121-availability-modes)).

### The colours look wrong after the system switched to dark

Hard-refresh once (`Ctrl + Shift + R` / `Cmd + Shift + R`) to drop JavaScript from an older release.

### A new release does not seem to have arrived

An open tab keeps the files it loaded. Reload once.

### The quick-start card does not appear

It shows once per install, and not on phones. After finishing or dismissing it, **Show quick-start card again** (Behavior → Privacy & sync → Onboarding) brings it back.

### The weather does not show

Set a city, or choose *Automatic (by IP)*, under Appearance → Date & weather, and check that weather is switched on. The Weather widget says so when no location is set.

### The Calendar widget shows nothing

- Set **Calendar feed URL (.ics)** under Appearance → Date & weather. Use the private ICS address from your calendar app, not the calendar's web page.
- The server fetches the feed, so it must be reachable from the machine nextDash runs on.
- The feed is cached for 15 minutes; changing the address redraws at once.

### The RSS widget shows nothing

- Give the widget at least one feed address (RSS or Atom), one per line.
- A web page instead of a feed is reported as such.
- The server fetches the feeds; each is cached for 15 minutes.

### A system widget shows no figures

The tile names the missing step — usually a mount or an environment variable ([§15.4](#154-system-widgets-and-what-they-need)).

### Browser notifications do not arrive

They need HTTPS in Safari and on iPhone and iPad, and nextDash on the home screen on iPhone and iPad. Permission is per browser.

### The extension cannot save

- Check the server address and that nextDash runs.
- **401** — set the write token in the extension's settings.
- **409** — the shortcut is already used on that page.
- Refused writes and rate limits are logged when the **Refused access** channel is on (Logs → Activity trail, or `NEXTDASH_ACTIVITY_LOG=security`).

### The Containers view is missing or read-only

- **Missing entirely** — `NEXTDASH_DOCKER_SOCKET` is not set, or the socket is not mounted; the Containers widget will say so too.
- **Visible but nothing can be started, stopped, updated or removed** — `NEXTDASH_DOCKER_CONTROL=1` is not set, or there is no write token in a build that expects one.
- **Socket present but every action fails** — the socket may be owned by `root:root` (common on Docker Desktop); add `NEXTDASH_RUN_AS_ROOT=1`. Remember that `:ro` on the socket mount does not stop the daemon accepting writes on a writable socket — the protection is the control flag and the token, not the mount flag.

---

<a id="25-quick-reference"></a>

## 25. 📌 Quick reference

### Most-used keys

```
type        search              Enter       open top result
>  :  ?     search · commands · finders     @  all pages
+  &        add · quick add     Ctrl+V      paste a URL
1-9  ,      pages · pages panel             *  recent   /  tags   !  cheat sheet
arrows j k  move                Esc         back / home
Shift+E edit   Shift+M move   Shift+T tags   Shift+D delete   Shift+C checking
Shift+H bookmarks (broken)   Shift+U bookmarks (unsorted)   Shift+I inbox   Shift+Y containers   Shift+S config   Shift+A themes
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
| `/#bookmarks[/<page>]?q=&cat=&filter=&health=&tag=&sort=&rev=&group=` | The Bookmarks view |
| `/#unsorted` | The Bookmarks view, on Unsorted |
| `/#health` | Redirects into the Bookmarks view, on Broken |
| `/#inbox` | The inbox |
| `/#docker`, `/#docker/<name>`, `/#docker?filter=updates` | The Containers view |
| `/#search?q=…` | A search |
| `/add?url=…` | Save to the inbox |
| `/opensearch.xml` | The browser search engine description |
| `/manifest.webmanifest` | The installed app |

### Data location

Docker: the mounted volume (for example `./data`, mounted at `/app/data`). Binary: `./data` next to it, or `NEXTDASH_DATA_DIR`.

---

<a id="further-reading"></a>

## 📖 Further reading

| | Document | Contents |
|---|----------|----------|
| 🚀 | [README.md](README.md) | Install, security, environment variables, features |
| 📋 | [CHANGELOG.md](CHANGELOG.md) | Every release, new and fix |
| 🧩 | [integrations/README.md](integrations/README.md) | Scripts and launchers that save to nextDash |
| 🔌 | [extension/README.md](extension/README.md) | Developing the browser extension |
| 💬 | **Config → Help** | The same topics in the app, in six languages |
| ★ | **What's new** | The latest release notes, with earlier releases below |
