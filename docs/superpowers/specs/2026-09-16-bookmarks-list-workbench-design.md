# Bookmarks list as a workbench

**Date:** 2026-09-16
**Status:** Design approved, not implemented. Branch `bookmarks-list-redesign`.
**Mockups:** `.superpowers/brainstorm/10388-1789564205/content/` (local only) —
`design-overview.html` is the agreed composite.

## What this is for

Config → Bookmarks → List is where a collection gets looked after: found,
filtered, fixed, moved, tagged. Today it does all of that, but every job has
three or four doors and the page spends its first screen on them:

- five summary tiles that are also filters;
- a toolbar with search, page, category and sort dropdowns, Add, Select all;
- a quick bar that repeats three sort orders and one cleanup filter;
- a collapsible tag cloud with its own select and clear buttons;
- removable filter chips, a count, and a cleanup banner that names the same
  filter the chip and the quick bar already name;
- a bulk bar of four groups and about twelve controls, each select with its
  own Apply;
- inline editing in the row (double-click the title, click the shortcut pill),
  while a double-click anywhere else on the row opens the bookmark.

The redesign keeps every capability that matters and gives each one a single
place: filters in a rail, rows in a list, editing — of one bookmark or many —
in a panel.

## Decisions

| Question | Decision |
|---|---|
| Duplicate controls | All go: tiles-as-filter, sort chips, cleanup banner, page/category dropdowns, filter chips. The sort dropdown stays. |
| Layout | Workbench: filter rail · list · detail panel. |
| Visual style | Slabs: rows sit in raised groups on the surface ladder, as in the Health and Inbox redesigns. Colours come from the active theme; the style follows the depth setting. |
| Detail panel | Open by default, collapsible to an edge tab; the choice is remembered per device. |
| Grouping | Grouped by page › category only under *Page order*. Any other sort is one flat slab with a crumb per row. |
| Editing | Only in the panel. No inline editing in rows. |
| Bulk actions | The panel becomes a bulk form when two or more rows are selected. One Apply. |
| Saved views | Only the fixed cleanup views. No user-defined saved views. |
| Code shape | A new lazy-loaded module; `dashboard-config.js` delegates. Built in stages. |

## Structure

### Rail (200px)

From top to bottom:

1. Search field, `/` focuses it.
2. Active filters as removable tokens, with *clear*.
3. **Views** — All, Never opened, Opened once, Untagged, Insecure, No icon,
   Duplicates, Changed this week. These are the existing cleanup filters;
   the first five show, the rest fold behind *+n more*. Broken links live in
   the Health group only, so no filter has two doors.
4. **Pages**, **Categories**, **Tags** (top entries, *all ›* expands),
   **Health** (healthy, broken, monitor down, never checked). Each entry shows
   a live count.

Each facet group is a slab. A facet with zero results stays visible, dimmed. A
facet group with nothing in it (no tags at all, health monitoring off) is not
drawn.

The rail replaces the summary tiles, the page and category dropdowns, the
quick bar, the tag cloud, the cleanup banner and the filter chips.

### List

- Toolbar: result count (`22 of 412`), sort dropdown (the existing eight
  orders), `+ Add`.
- Under *Page order*: one slab per page › category, header shows name, count
  and *select group*.
- Under any other order: one slab, each row carries its page › category crumb.
- Row columns: checkbox, favicon, health dot + name + domain, tags, shortcut
  key (a dimmed `+` when empty), open count, relative last-opened.
- Double-click a row opens the bookmark. There is no other double-click
  behaviour.
- The right-click menu stays; its *Edit* item focuses the panel.
- A keyboard legend sits under the list, in the existing `<kbd>` chip row.

### Panel (260px)

Three modes, chosen in this order:

1. **Two or more selected → bulk form.** Page › category, tags, pinned,
   checking, health summary. Fields where the selection disagrees read
   *mixed*. Tags show each tag's count within the selection. Pinned offers
   explicit *pin all* / *unpin all*. Footer: *Apply to n*, *Export CSV*,
   *Delete n*. A line reports how many selected rows the filter hides.
2. **A focused row → bookmark form.** Name, URL, page › category, tags,
   shortcut, note, pinned, checking; then read-only health (status, last
   check, response time) and usage (opens, last opened, added). Footer:
   *Open*, *Show on dashboard*, *Refresh favicon*, *Delete*. Saving a URL
   or a page changes the bookmark's key; the panel follows it to the new key.
3. **Nothing → empty state** ("Select a bookmark").

Collapse with the `›` button or `i`; a narrow *Details* tab remains at the
edge. The state is stored in `localStorage` under `nextdash.bmPanelCollapsed`.
Pressing `e` on a collapsed panel expands it. Selecting two or more rows
expands it.

Below 1200px the panel is a drawer over the list with a scrim; Esc closes it.
Below 800px the rail becomes a *Filters (n)* button that opens a sheet.

### Keyboard

| Key | Action | Change |
|---|---|---|
| `j` / `k`, arrows | move focus | — |
| `g` / `G` | first / last | — |
| `x`, Space | toggle selection | new; Space used to open |
| `⇧x` | select range from anchor | new |
| `e` | focus first panel field | was: open row editor |
| `i` | collapse / expand panel | new |
| Enter, `o` | open bookmark | — |
| `d` | delete | — |
| `/` | search | — |
| Esc | close drawer, else clear selection, else clear filters | — |

`m` (More menu) and `c` (check-mode menu) go: both menus' contents live in the
panel. The right-click menu remains for pointer users.

## Data and state

### Kept

`bmQuery`, `bmPageFilter`, `bmCategoryFilter`, the tag filters,
`bmCleanupFilter`, `bmSort` and `bmSelected` (a `Set` of bookmark keys) stay on
`DashboardConfig`. `visibleBookmarks()` and its memo remain the single filter
pipeline. The rail writes these fields and calls
`updateBookmarkListChrome()`.

### Added

- `bmHealthFilter` — `healthy | broken | down | unchecked | null`. Added to
  the memo token in `visibleBookmarks()` and applied in
  `computeVisibleBookmarks()`.
- The row the panel describes is the existing `_bmKeyboardKey` (25 call
  sites, including the view's Escape handler); it is not renamed.
- `bmSelectAnchor` — the start of a `⇧x` range.
- `bookmarkFacetCounts()` — one pass over the collection producing counts per
  page, category, tag, health state and view. Each facet group is counted with
  every *other* active filter applied but not its own, so the Pages group
  under *Work* still says what *Home* would give. Memoised on the same token
  as `visibleBookmarks()`.

### Module

New file `static/js/dashboard/dashboard-config-bookmarks-workbench.js`,
lazy-loaded the same way `dashboard-config-bookmarks.js` is, with a `*Safe`
wrapper. It adds to `DashboardConfig.prototype`:

- `renderWorkbenchRail(counts)`
- `renderWorkbenchList(visible)`
- `renderWorkbenchPanel(focus, picked)`
- `bindWorkbenchRail(root)`, `bindWorkbenchList(root)`,
  `bindWorkbenchPanel(root)` — one delegated listener each.

New stylesheet `static/css/config-bookmarks-workbench.css`, loaded through
`{{asset}}` / `lazyLoadedAssets`; regenerate asset hashes after every change
under `static/`.

`renderBookmarksListTab()` and `bindBookmarksListTab()` in
`dashboard-config.js` shrink to a layout wrapper that calls the three renderers
and binders.

### Saving

- **One bookmark:** each field saves on blur through the existing bookmark
  editor save path, including its shortcut conflict check.
- **Bulk:** Apply calls only the changed fields through the existing
  `bulkMove`, `bulkTags`, `bulkStatus` and `bulkPin`; `bulkPin` gains an
  explicit direction instead of toggling. `bulkExportCsv` and `bulkDelete` are
  reused as they are. `bulkUndo` stays the undo toast. No new API.
- **After a save:** `invalidateVisibleBookmarks()`, then repaint list, rail
  counts and panel, keeping scroll position and focus.

### Removed

From the List tab: `bookmarksSummaryTiles` usage (the function stays if
Overview uses it), `renderBookmarkQuickBar`, `renderBookmarkTagCloud` (the Tags
subtab keeps its own cloud), `renderCleanupFilterBanner`,
`renderBookmarkFilterChips`, `renderBulkToolbar` with `bindBulkToolbar` and
`repaintBulkToolbar`, the fallback `renderBookmarkRowActions`, inline title
and shortcut editing, and their CSS in `config-view.css` (tiles 367–600 where
List-only, quick bar 5692–5714, bulk bar 4526–4576, cleanup banner 4641–4670,
inline edit 5488–5560, dead fallback actions 4005–4065, duplicate legend and
usage blocks). Each removal is checked for other callers first.

## Errors and edge cases

**Saving**

- A failed field save keeps the typed value, marks the field with an error
  edge and a *Not saved — retry* line. No silent rollback.
- A shortcut conflict marks the field with *used by X* and does not save until
  resolved.
- A failed bulk Apply restores what already succeeded from the `bulkUndo`
  snapshot; the toast says *n of m failed*.
- Moving focus while a field has unsaved input saves that field first; the
  focus moves only after the save resolves. If the save fails, focus stays.

**Selection and filters**

- Selection survives filter changes (as today). The panel reports how many
  selected rows are hidden, and Apply includes them. Choosing a cleanup view
  no longer clears the selection.
- If the focused row leaves the filter, focus moves to the nearest visible
  row; with none left the panel shows its empty state.
- `⇧x` selects in visible order. If the anchor is hidden, the focused row
  becomes the anchor.
- *Select group* works on data, not on drawn rows, so windowed-out rows are
  included.

**Large lists**

- Windowing and the load sentinel stay. Group headers are counted in the
  spacer maths.
- Forced full rendering while an inline editor is open is no longer needed and
  goes.

**Empty states**

- No bookmarks: rail hidden; the existing *No bookmarks yet* with Add.
- Filters match nothing: `bookmarksEmptyReason` with *Clear filters*.

**Accessibility**

- The list is `role="grid"` with `aria-selected`, keeping
  `aria-posinset` / `aria-setsize`.
- The panel is a labelled `region`; count changes go through the existing
  live region.
- Drawer and sheet lock scrolling through `window.ScrollLock`, never
  `body.style.overflow`.
- No `backdrop-filter` on the panel or anything that must take clicks (the
  Safari hit-test problem).

## Testing

Run only the specs covering the stage in hand, `PW_WORKERS=2`, port 8099,
exit code read from a file. No full-suite sweep.

**Existing specs** — 28 files reference List selectors.

- *Adapt selectors, behaviour unchanged:* filters, sort, window, paging, lazy,
  open-tracking, duplicates, trash, category sync, context menu, tag
  suggestions.
- *Rewrite:* `config-bookmarks-editor` (editing moved to the panel),
  `config-bookmarks-keyboard` (new and removed keys), bulk-bar coverage.
- *Delete assertions:* tiles as filters, quick bar, cleanup banner, filter
  chips, inline editing.

**New specs**, driven through clicks and keys, each falsified once:

- `config-bookmarks-rail.spec.js` — facet filters, counts exclude their own
  filter, views, health facet, token clear, dimmed zero facets.
- `config-bookmarks-panel.spec.js` — focus follows `j`/`k`, save on blur,
  error edge on failed save, shortcut conflict blocks, `e` focuses, `i` and
  the collapsed state survive a reload.
- `config-bookmarks-bulk.spec.js` — `x`, `⇧x`, *select group* includes
  windowed-out rows, *mixed* fields, Apply sends only changed fields, pin all
  / unpin all, undo, hidden-by-filter line.
- `config-bookmarks-grouping.spec.js` — slabs under *Page order*, one slab
  with crumbs otherwise.
- Narrow widths — drawer below 1200px, sheet below 800px, scroll lock
  refcount.

**By hand:** against a copy of `NEXTDASH_DATA_DIR`, on a glass, a rich and a
flat theme, and in Safari.

## Build order

1. Module and stylesheet scaffold; List tab renders rail + list + empty panel.
   Old controls removed. Existing specs adapted.
2. Rail: facets, counts, views, health filter.
3. List: slabs, grouping rule, keyboard selection.
4. Panel: bookmark form, save on blur, collapse.
5. Panel: bulk form; bulk bar removed.
6. Narrow widths.

## Out of scope

- User-defined saved views.
- A group-by selector.
- Drag reordering in the list.
- Changes to the Tags subtab.

## Documentation

Done in a separate docs round once a version number is set: changelog, What's
New, MANUAL, Help and tips (new keys), the cheat sheet, and the six locales.
