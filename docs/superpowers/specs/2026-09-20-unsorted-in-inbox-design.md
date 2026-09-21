# Unsorted becomes the Inbox's second tab

**Date:** 2026-09-20
**Status:** design approved 20 September 2026
**Author:** Jordi + Claude
**Supersedes the entry point in:** `2026-09-18-unsorted-bookmarks-design.md`
(the data model, the Keep path, Move to… and the widget from that design stand
unchanged)
**Branch:** `unsorted-in-inbox`, off `dev-unsorted-bookmarks`

## Why

Unsorted shipped as a fourth destination in the header, beside Dashboard,
Inbox and Health. Those three are ways of looking at the whole collection.
Unsorted is one step in the inbox's own flow: what you kept but have not filed.
It is a state, not a place.

The cost shows on screen. The icon stands there for everyone, empty or not,
with no count to justify it (the inbox icon has one,
`dashboard-page-nav.js:337`). There are already three ways in — header, widget,
Config → Bookmarks → Unsorted — for something with no separate mental model.
And a reader who keeps a link is sent, a moment later, to a different
destination to see where it went.

Moving Unsorted into the Inbox puts it where it is created, drops the fourth
destination, and leaves the header at three.

## Goals

- Kept bookmarks are reached from the Inbox, as its second tab.
- Nothing that works today stops working: the grid, the toolbar, the selection
  and bulk actions, Move to…, the widget, the search results.
- One view, one route, one set of view-is-still-on-screen guards.
- Broken kept links become visible where they can be acted on.

## Non-goals

- The data model. The hidden page, `/api/unsorted` and the Keep path are
  unchanged.
- Merging the three selection layers (Health, Unsorted, the config workbench),
  and undoing the `allBookmarks` split. Both are real, both are separate work.
- Documentation, locale keys and the version number. A later round.

## The shape

### Tab strip

The Inbox view gains one piece of state: `tab`, either `triage` or `kept`.
`activeView` stays `'inbox'` throughout.

Above the shell stands a two-button strip: **To triage** and **Kept**, the
second with the number of kept bookmarks beside it. That number comes from
`d.unsortedBookmarks`, which the dashboard already loads and keeps in step with
every mutation — the strip does not fetch anything of its own. The strip is the
inbox's, built once with the shell and repainted like any other chrome.

The badge on the header's inbox icon keeps counting unread items only. Kept is
what is already dealt with; counting it would make a badge that never reaches
zero.

### What each tab holds

**To triage** is the inbox exactly as it is: its rail of filters, its toolbar,
its rows.

**Kept** is the current Unsorted view — the block grid, the search box, the
sort and the grouping — drawn inside the same shell. The rail is hidden on this
tab rather than drawn empty: the toolbar's controls are its filters, and an
empty 200px column beside the grid is chrome that says nothing.

### Entry points

| Way in | Lands on |
|---|---|
| Inbox icon, `Shift+I`, `#inbox` | To triage |
| `Shift+U`, `#unsorted` | Kept |
| Widget's "view all", the action-bar button, the config view's link | Kept |
| `:inbox`, and a new `:kept` command | To triage / Kept |
| Search results | Unchanged: kept bookmarks are in the results with their `unsorted` label and open like any other |

The header's fourth icon goes: its template block, its CSS and the code that
draws it dynamically (`dashboard-visual.js:411`).

`#unsorted` stays a valid address. The inbox writes `#inbox` or `#unsorted`
depending on the tab, so a link that is shared opens what it promises.

## Mounting

`DashboardUnsorted` loses what the shell already does: its own header band, its
own grid container, its hash handling, and its "am I still the view on screen"
guards. What is left is one entry point — *draw your list into this element,
with this toolbar slot* — plus everything that made it worth keeping: sorting,
grouping, the preview fetches, the selection and the bulk actions.

The Inbox calls it when the Kept tab is on, and draws its own rows otherwise.
Switching tabs repaints the body and the toolbar; the shell itself is not
rebuilt.

Both scripts move out of `templates/dashboard.html` into the Inbox's lazy load
path, with entries in `lazyLoadedAssets`, so they stop riding along on every
dashboard visit (76 KB today).

## Reading the pile

The toolbar keeps what it has and gains three things.

**Sorting** — newest, oldest, name, site, most opened, by tag, and **last
checked**, which puts what has not been looked at (or is failing) on top.

**Grouping** — none, by site, by tag, by age, and by **suggested tag**.

- *By age* is today's "by date added" renamed. It already buckets into today /
  this week / this month / older, which is what the name should have said.
- *By suggested tag* groups on the tag your own tag rules propose
  (`Settings.TagRules`), including for rows that do not carry it yet. It is the
  answer to "file a batch at once": a group, ticked, then Move to… from the
  selection bar (see below).
  Rows no rule matches land in one "no suggestion" group.

**Remembered** — the chosen sort and grouping are saved as settings on the
server, so they follow you to every browser, like the rest of config.

## Filing a kept bookmark

One row: **Edit** (`Shift+E` or the row menu) — give it a page and a category
and it leaves Kept for the dashboard. That is the route the view teaches, which
is why "Move to…" is hidden on these rows: filing means choosing a category,
and Move to… only asks for a destination. From the dashboard the other way
round is Move to…, unchanged.

A set of rows: the selection bar gains **Move to…**, beside Delete. It asks
once for a page and a category and writes them to every ticked row — one write
per page, the way bulk tagging in this view already works, rather than a
read-modify-write per bookmark racing the last.

This is what makes grouping worth having: group by site or by suggested tag,
tick the group, file it in one move. Without it the grouping is a way of
looking and nothing more, and the promise above would be empty.

## Broken kept links

Health stays as it is. Its report is about the collection as it stands on the
dashboard, and kept links have no category by definition — putting them in
buries the report in rows nobody can act on from there.

Instead, Kept says it itself. When any kept bookmark last answered with an
error, one line stands above the grid: *3 of these links do not answer*, with a
button that filters the list to them.

The source is what is already there: `lastError` and `lastChecked` on the
records `/api/unsorted` returns, and the browser's own status check, which
already walks the kept rows (`status.js:743`). No new endpoint, no change to
the health report.

## The setting

`unsortedEnabled` moves from Appearance → Header ("Show the unsorted icon") to
Behavior → Inbox & Fresh, as what it actually is: keeping on or off. Off means
no Kept tab **and** no Keep action in triage — today Keep is not gated at all,
so with the icon hidden a link was still filed somewhere the reader could not
reach.

The key keeps its name, so an install that switched it off stays switched off.

## Config → Bookmarks → Unsorted

Stays, as the workbench for bulk work across hundreds of rows, with a line
saying the everyday place is Inbox → Kept.

## Testing

Behaviour only, `PW_WORKERS=2`, never port 8080. Every new test falsified.

The existing unsorted specs keep their assertions and open through the Inbox
instead of the header icon. New cases:

- The strip switches tabs, and the count beside Kept follows the list.
- `Shift+U` and `#unsorted` land on Kept; `#inbox` lands on To triage; the tab
  is written to the address.
- The header carries no unsorted icon.
- Sorting by last checked and grouping by suggested tag and by age.
- The sort and grouping survive a reload (they are settings now).
- The broken line counts, and its button filters to those rows.
- With the setting off there is no tab and no Keep in triage.
- Move to… on a selection files every ticked row on one page and category, and
  they leave Kept.
- A kept bookmark is still found and opened from the search modal.

## Out of scope

- Documentation, locale keys, translations, the version number and the
  changelog: a later round, at a version yet to be decided.
- Merging the selection layers; undoing the `allBookmarks` split.
- Any change to intake, to `trimInboxItems`, or to the hidden page itself.
