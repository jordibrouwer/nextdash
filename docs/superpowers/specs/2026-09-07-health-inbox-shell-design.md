# Health and inbox view shell — design

**Date:** 7 September 2026
**Status:** approved for implementation planning
**Scope:** a shared view shell adopted by the health and inbox views; config keeps its current implementation and adopts the shell in a later round

---

## The problem

Health and inbox both stack four to five separate control rows above their list:
a two-row header, a KPI tile row, a filter pill strip, a search/sort row, an
action row, and (for inbox) an explainer paragraph. None of those rows outranks
another, so the reader has to re-read all of them to find one control. Config,
by contrast, has three clear levels: a section rail on the left, one sub-tab
strip, and content cards.

Two findings sharpen this beyond a styling complaint.

**The tiles and the filters are the same control, drawn twice.** Health shows
"7 Stale" as a tile *and* as a filter pill; the same holds for Broken, Unused,
Monitored, Certificates, Healthy and Total. In inbox the duplication is literal
— the tiles are themselves filters (`dashboard-inbox.js:3611-3626`). Two of the
stacked rows say the same thing.

**Health and inbox are already twins in code, without a shared implementation.**
Same container rule (`52rem`, flex column), same two-row header, same tile row,
same three-part toolbar, same `feed-list` → group → `feed-row`, same footer
legend. The stylesheets name the relationship in comments —
`dashboard-inbox.css:20` calls a class "the twin of
`.health-view-header-second-row`" — but nothing enforces it. The fragmentation
is one shape maintained by hand in two places.

Underneath sits a technical cause. Config builds its shell once and repaints
only `#config-view-body` (`dashboard-config.js:1533`), so rail scroll and focus
survive. Health and inbox call `container.innerHTML = ''` on every filter change
and every keystroke in the search box, and therefore need `preserveSearch` /
`searchCaret` workarounds to put the caret back (`dashboard-health.js:3258`,
`dashboard-inbox.js:3516`). A sticky header and a rail that keeps its scroll
position cannot be built on top of that. The layout problem and the render
problem have to be solved together.

## Decisions taken

| Question | Decision |
|---|---|
| Which views change | Health and inbox now; the shell is designed so config can adopt it later without redesign |
| Left column contents | Summary figures at the top, then the filter list; search, sort and the list stay in the content column |
| Header | Title, description and primary actions; sticky, shrinking to a single bar on scroll |
| Depth of change | Rows are redesigned too, with a shared row anatomy and a density control |
| Health's monitors panel | Compact summary in the rail, full detail behind its own section |
| Approach | One shared shell module used by both views, staged view by view |

## Layout anatomy

```
┌─ sticky header ──────────────────────────────────────────────┐
│ Health                                  [Work through] [Rot] │
│ Bookmarks that need attention                          [···] │
├──────────────┬───────────────────────────────────────────────┤
│ 99%  ▲72     │ [ Search… ]  [ score ⌄ ] [ per site ] [≡|☰]   │
│ 1 broken     │                                               │
│ updated 2m   │ ┌───────────────────────────────────────────┐ │
│              │ │ ▌ ◻ name          badge   reason    score │ │
│ FILTER       │ │   url                                     │ │
│  All     108 │ └───────────────────────────────────────────┘ │
│  Broken    1 │ ┌───────────────────────────────────────────┐ │
│  Stale     7 │ │   ◻ name          badge   reason    score │ │
│  Unused    4 │ └───────────────────────────────────────────┘ │
│  …           │                                               │
│              │                                               │
│ SECTIONS     │                                               │
│  Monitors  6 │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

**Header.** Title and one-line description on the left, primary actions on the
right (Work through / Rot report / overflow for health; Triage / overflow for
inbox). On scroll it collapses to a single bar carrying the title, the active
filter as a breadcrumb, and the actions — so the primary action is never lost
in a long list.

**Rail.** 200px, matching `.config-nav-column` exactly (`config-view.css:51`) so
the three views align on the same vertical once config joins. Sticky, and never
rebuilt on filter or search. Three blocks:

1. *Summary* — only figures that are not filters. For health: score, trend
   delta, what needs attention, report age. For inbox: active, unread, and
   "this week", the one inbox figure that is not also a filter.
2. *Filters* — the merged tile/pill list, one row per filter with its count
   right-aligned, one active at a time. Status colour lives here: Broken reads
   danger, Stale reads warning.
3. *Sections* — navigation destinations that are not filters. Monitors for
   health today; the extension point config's ten sections use later. Keeping
   filters and sections visually separate prevents "Monitors" from reading as a
   list filter when it is a different destination.

The rail carries no search affordance of its own. Config puts "Find settings
⌘⇧K" at the foot of its rail, but health and inbox already have search in the
toolbar, and duplicating a control across two regions is the exact fault this
redesign removes. The foot of the rail stays an empty slot, reserved for the
palette config brings when it adopts the shell.

**Content column.** One toolbar row — search, sort, group, density — replacing
the three rows there today. Then the list.

**Row.** A fixed-column grid (icon · title and url · badge · reason · score)
so the eye can scan down a column instead of re-parsing each row. Because status
colour now lives in the rail, rows carry a coloured left edge only when
something is genuinely broken. Two density settings: compact for health's
hundred-plus items, comfortable for inbox's descriptions.

## Components

Two new files:

- `static/js/shared/list-view-shell.js` — builds and owns the shell.
- `static/css/list-view-shell.css` — grid, rail, sticky header, toolbar,
  density. Added to the existing `bundle:css-views`, so it loads lazily through
  `ViewStyles.ensureViewStyles()` like the other view stylesheets.

The row anatomy does **not** go there. It extends the existing
`static/css/feed-row.css` with a grid variant and the two density modifiers,
because that file is already shared by health, inbox *and* config's bookmarks
list (`dashboard-config-bookmarks.js:377`). Extending it there means the density
control works in config for free later, and the change is purely additive —
existing classes are untouched.

### The boundary

**The shell owns everything that persists; the view owns only the list.**

The shell returns one element the view may repaint. Everything else — header,
rail, toolbar, legend — is updated through small setters (`setSummary`,
`setCounts`, `setActive`) rather than rebuilt. This is what removes the
`innerHTML = ''` problem: once the rail and the search input are never discarded,
the `preserveSearch` and `searchCaret` workarounds in both views become dead code
and are deleted.

Stays in health and inbox: loading and filtering data, sorting and grouping,
rendering the rows themselves, and every overlay they own — focus mode, triage,
snooze menus, bulk bar, row menus.

Leaves both views: the header, tiles, toolbar and legend construction. Health
has these as named functions (`renderHeader` `:4307`, `renderTiles` `:4357`,
`renderToolbar` `:4968`, `renderLegend` `:5535` — roughly four hundred lines).
Inbox does not: only `renderLegend()` (`:3392`) is a function there, while the
header (`:3557-3577`), tiles (`:3593-3627`) and toolbar (`:3628-3877`) are inline
blocks inside `render()`, built as `innerHTML` strings. So inbox's adoption is
partly an extraction, not only a substitution — that asymmetry is why inbox goes
first and gets more steps than a straight port would need.

Inbox also carries **four near-duplicate copies of the same "reset and re-render"
sequence** — the filter pill closure `applyFilter` (`:3713-3730`), the tile click
handler (`:3612-3625`), the domain select (`:3771-3787`) and the sort select
(`:3758-3768`), with the search input deferring the same body to
`scheduleSearchRender()` (`:3459-3480`). They differ in small, probably
unintended ways: the tile handler skips the page-title updates the pill handler
performs, and the sort handler skips the selection reset the others do. Merging
the tiles into the filter list removes one copy outright; the shell's filter
handling absorbs another. That consolidation is part of the work, not a bonus.

Keyboard handling splits along the same line: the shell takes rail navigation
and filter cycling (implemented twice today — `dashboard-health.js:5162` ≈
`dashboard-inbox.js:3731`), the views keep their own list keys. Legends continue
to come from `KeyboardViewLegends`, so the cheat sheet stays correct
automatically.

Reused as-is: `EscapeOwner`, `LazyScript` loader stubs, `AppModal`,
`ProgressOverlay`, `AppNotification`, `FocusTrapUtils`, `ScrollLock`,
`.config-bulk-bar` (health already borrows it).

## Behaviour

**Render lifecycle.** The shell mounts once when the view opens. Afterwards only
the list element is repainted. Filtering, sorting, searching and paging never
touch the header or the rail; rail counts update through a setter, so rail scroll
position survives.

**URLs.** The existing query parameters stay untouched — health's `hv_filter`,
`hv_sort`, `hv_q`, `hv_id` and inbox's `ib_*` — because inbox has a share-URL
feature (`dashboard-inbox.js:902`) and previously shared links must keep working.
The new Monitors section gets a readable hash instead: `#health/monitors`, with
bare `#health` meaning the list. Additive, and already the shape config uses.

**Density** is one app-level setting, not one per view.

**Empty and retry states** move into the list element unchanged.

**Narrow screens** follow what config already does: below 720px the rail becomes
a horizontally scrolling strip above the content (`config-view.css:83`). The
summary block does not fit in a horizontal strip, so it folds into the header
below the description; the secondary actions fold into the overflow menu, leaving
only the primary action beside the title. One breakpoint for all views, using a
proven pattern.

### Sticky positioning — verified, not a risk

Phase 0 has been carried out. Against the real data set at 1440×900, with the
health view on the All filter (50 rows, 5274px of scroll):

- A `position: sticky; top: 0` probe inserted as the first child of
  `#dashboard-layout.health-layout` moved from 169px to **0px** after scrolling
  1200px. It sticks.
- Config's existing `.config-nav-column` computes to `position: sticky` and held
  at 18px through a 600px scroll, confirming the pattern already works in this
  shell.
- No ancestor of `#dashboard-layout` creates a scroll container: `.container`,
  `.section-content` and `main` all compute `overflow: visible`, and
  `document.scrollingElement` is `documentElement`.
- `#dashboard-layout` carries a `translateY(10px)` transform **only** while the
  `.page-transition` class is applied during view entry; it computes to `none`
  once settled. A transformed ancestor becomes the containing block for sticky,
  which is what offsets config's rail to 18px rather than its declared 8px
  during that window. Harmless, but it means sticky offsets should not be
  asserted to the pixel while a transition is running.

The sticky header is therefore safe to build, and the non-sticky fallback is not
needed.

## Phasing

Each phase is independently finishable and independently reviewable.

0. ~~Verify sticky header behaviour in the running app.~~ **Done** — see above.
1. Build the shell module and its CSS; adopt it in inbox — the smaller of the
   two views (4,794 lines, four filters, no analytics panel, no score badges).
2. Grid row anatomy and density control in `feed-row.css`, applied to inbox.
3. Health adopts the shell, including the tile/filter merge.
4. Health's Monitors section: summary in the rail, detail behind
   `#health/monitors`.

## Testing

There are 69 specs covering health and inbox; 24 of them plus
`tests/e2e-helpers.js` reach for the chrome that changes.

**The shared helper is not the lever it first appeared to be.** `e2e-helpers.js`
touches only the two overflow-menu controls (`openInboxToolbarMenu` at `:585`,
`openHealthToolbarMenu` at `:605`); it never selects a tile, a filter, a header
or a toolbar. Fixing it fixes almost nothing on its own.

The real lever is different, and it shapes the implementation: **almost every
spec selects by data attribute, not by class name** — `[data-health-filter="…"]`,
`[data-inbox-filter="…"]`, `[data-health-tile]`, `[data-inbox-tile]`,
`[data-inbox-toolbar-more]`, `[data-health-toolbar-more]`. So the shell must
**preserve the existing data-attribute contract** even where class names change.
Filter buttons keep `data-health-filter` / `data-inbox-filter`; the overflow
button keeps its `data-*-toolbar-more`. Where a tile merges into the filter list,
the merged control carries *both* the filter attribute and the tile attribute it
replaces, so `[data-health-tile="unused"]` still resolves. Treated this way, the
majority of the 24 specs need no change at all, and the churn concentrates in the
handful listed below.

A handful lose their premise and must be reconsidered rather than reselected:

- `health-tile-filter-agreement.spec.js` asserts that the tiles and the filters
  agree with each other. Once they are one control, the question is meaningless
  and the spec should be removed, not repaired.
- `health-trend-placement.spec.js` — the trend moves into the rail.
- `health-header-compact.spec.js` and its inbox twin — header behaviour is what
  we are changing.
- `health-toolbar-styling.spec.js` — the toolbar is replaced.

Two specs are the guardrails this work most needs and must keep passing:
`view-visual-alignment.spec.js` and `view-resize-layout.spec.js`. They assert
that the views stay in line with each other, which is the point of the exercise.

One of them already enforces a decision this design makes independently:
`view-visual-alignment.spec.js` asserts that `grid-template-columns: 3rem 1fr`
appears in *none* of `health-view.css`, `dashboard-inbox.css` or
`config-view.css` — the row grid must be declared once, centrally. Putting the
new row anatomy in `feed-row.css` satisfies that; putting it in a per-view
stylesheet would fail it. The same spec asserts zero occurrences of
`border-radius: 0;` in `health-view.css`, `dashboard-inbox.css` and
`view-explainers.css`.

Per phase, run only the specs touching the changed files, with `PW_WORKERS=2`,
writing output to a file rather than through a pipe (a pipe reports exit 0 while
tests fail). No full-suite sweep, including as a final check.

On ports: Playwright manages its own. With `PW_WORKERS` above 1 the shared
`webServer` block is skipped and each worker spawns its own server on an
OS-assigned free port (`tests/worker-server.js:86`); the single-worker default
is 18080, chosen so a local Docker instance on 8080 cannot shadow it
(`playwright.config.js:15`). Nothing in the test path touches 8080. A manual dev
server for eyeballing runs as `PORT=<port> go run .` — 8080 is the Go default
when `PORT` is unset, so `PORT` must always be given.

## Documentation

Each phase gets a changelog line. The new rail labels and the density control
are new UI strings and must land in all five locale files (en, nl, de, fr, zh).
Release documentation — the What's New modal and the rest — waits until a
version number is set.

## What the inbox round learned, for the health plan

Phases 1 and 2 are built and merged-ready (branch `list-view-shell`, 15 commits).
Four things surfaced that shape the health plan and were not visible when this
spec was written.

**The Sections block is a stub.** `list-view-shell.js` renders section buttons
with a `data-lvs-section-key` and nothing else — no click handler, no
`onSection` callback, and the documented `sections[].href` is never read. Inbox
has no sections, so nothing exercised it. Health's Monitors destination is the
first real consumer, so **health must extend `mount()`, not merely configure
it.** Budget a task for that rather than assuming the extension point works.

**A grid collision will eat health's checkbox column.** `.feed-row--with-select`
sets `grid-template-columns: 1.1rem 3rem 1fr`; `.feed-row--grid` sets
`3rem 1fr auto`. Equal specificity, so the later declaration wins. Health's rows
carry `--with-select`; if they also take `--grid`, the checkbox column silently
disappears. The suggested shape is to make two columns the default and add a
`--grid-3` modifier, since two columns is already what bare `.feed-row` is.
Decide this before health adopts the row anatomy.

**Health still carries its own copy of the caret workaround.**
`preserveSearch`, `searchCaret`, `finishInboxRenderFocus` and
`_searchFocusPending` are gone from the inbox but all four remain in
`dashboard-health.js`. They become removable the moment health repaints only
`handle.body`, and leaving them behind would be the clearest sign the adoption
was only skin-deep.

**Three un-consolidated re-render copies remain in the inbox**, at roughly
`dashboard-inbox.js:4008`, `:4193` and `:4211` (the snoozed-footer button, the
tag chip and the domain button). They pre-date this work and were out of scope,
but the domain-click one still omits `checkAnchorId = null` and
`persistViewState()` — the same drift the consolidation existed to remove, one
call site away from a one-line `applyViewChange`. Health's plan is a natural
place to sweep them.

## Out of scope

- `dashboard-config.js` and `config-view.css` are not touched this round.
- The focus mode and triage overlays keep their current design.
- No change to how health checks run, how inbox items are captured, or any
  server-side behaviour.
