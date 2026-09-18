# Unsorted bookmarks: a third exit from the Inbox

**Status:** design approved 18 September 2026
**Author:** Jordi + Claude

## Why

The Inbox is a triage queue, not a place to keep things. `InboxLink` carries
`ReadAt`, `SnoozedUntil`, `Note` and `Tags`, but nothing that means "keep this
forever." `trimInboxItems` (`internal/app/inbox.go:135`) evicts purely by
`AddedAt` once `InboxMaxItems` (default 500) is exceeded — unread, snoozed,
noted, it doesn't matter. A link you deliberately want to keep disappears
silently once 500 newer ones arrive.

Today there are exactly two exits: promote (which forces a `PageID` and
`Category` — a dashboard placement you may not want yet) or delete. There is
no third option for "keep this, but don't make me file it anywhere."

The existing "Keep" action in the Inbox triage modal (`R`,
`dashboard-inbox-triage.js:353`) already promises this — the label says
"Keep" — but today it only sets `ReadAt`. The item stays in the Inbox and is
still subject to eviction. The name and the behavior disagree.

## Goals

- A link can be saved permanently without choosing a dashboard category.
- The saved item is a first-class bookmark: searchable, health-checked,
  favicon-cached — not a second, parallel storage mechanism.
- Reachable and browsable on its own, independent of the Inbox and of any
  dashboard page.
- Reuses existing UI and interaction patterns wherever one already fits;
  no new mechanism is introduced where an existing one does the job.

## Non-goals

- Changing how links arrive in the Inbox. Intake (paste, share-capture) is
  unchanged; this only adds a third triage exit.
- A general-purpose tagging or folder system. Unsorted is one flat,
  chronological place — not a hierarchy.
- Touching `trimInboxItems`'s age-based eviction logic itself. Items that
  reach Unsorted leave the Inbox (and the eviction pool) entirely, so the
  trim bug this design was prompted by no longer applies to them. Whether
  eviction should also respect `Note`/`Tags`/`SnoozedUntil` for items that
  stay in the Inbox is a separate, smaller question, out of scope here.

## Data model: a hidden "Unsorted" page

An earlier direction considered a bookmark with `PageID: 0` and empty
`Category`. Investigation ruled it out: `getPages()`
(`internal/app/models.go:2794`) filters `PageID >= 1` by construction, so a
`PageID: 0` bookmark is invisible to page iteration; the health report walks
`GetPages()` → `GetBookmarksByPage(page.ID)`
(`internal/app/handlers.go:4899`), so it would silently drop out of Health;
and over a dozen existing mutation endpoints (delete, edit, health-accept,
drift-accept, ignore — `handlers.go:1714,4075,4398,4521,4625` and the
`health_*.go` handlers) already reject `PageID <= 0` as invalid. Legalizing
`PageID: 0` means touching every one of those gates.

Instead: **Unsorted is a real `Page`, like any other**, with a normal
`PageID >= 1`, marked with a new `Hidden bool` field so it is excluded from
the ordinary page navigation and dashboard layout. Because it's a real page:

- `getPages()`, `GetBookmarksByPage`, the health report, delete/edit/drift
  endpoints all work unchanged — nothing there needs to know Unsorted
  exists.
- Bookmarks on it are ordinary `Bookmark` records (`bookmarks-<id>.json`),
  indexed by search and health exactly like any other bookmark.
- The empty-`Category` convention already means "uncategorized"
  (`handlers.go` ~660) and needs no change — Unsorted bookmarks simply use
  it, or a tag-based grouping, same as any other uncategorized bookmark.

The page is created lazily on first use (first promote from Inbox, or first
manual move) and is a singleton — one per install, not one per something
else.

## Promote path: "Keep" now means keep

The Inbox triage "Keep" action (`R`, and the same action in the triage
button row) changes from "mark read" to "promote to Unsorted." This replaces
the current behavior rather than adding to it — a permanently-kept item is
read by definition, so there is nothing for a separate read-mark to add.

Mechanically this reuses the existing promote pathway: the InboxLink is
deleted with `reason=promote` (`inbox_handlers.go:403`), just as a normal
promote does, so `TotalPromoted` accounting stays correct — the only
difference is the destination page is the hidden Unsorted page instead of
one chosen through the promote form, and no category prompt is shown.

## Widget: "Unsorted bookmarks"

A new preset in `dashboard-widget-presets.js`, alongside the existing widget
types: a compact, chronological list of Unsorted bookmarks (most recent
first), sized and placed in the grid like any other widget. Ends with a
"view all" link into the full view (below).

## Full view: reuses the tag-filter-view rendering

The full "browse everything" view reuses the existing tag-filter-view
rendering pipeline (`dashboard-tag-filter.js`, the `packed-columns` CSS in
`dashboard.css:1108-1157`, and `dashboard-packed-masonry.js`, which already
recomputes column count live on resize) — filtered on the Unsorted page
instead of a tag, sorted by date instead of tag relevance. Fixed-width
columns, count adapts to window width; this is the same masonry mechanism
tag-filter-view already ships, not a new layout system.

Bookmark rows in this view are the same `role="grid"` bookmark-row component
tag-filter-view already uses (`dashboard-bookmark-rows.js:1275`), so Edit
(Shift+E), Move to… (Shift+M), Delete, the right-click context menu, and
keyboard navigation all work unchanged — no separate implementation needed
for any of them.

**Row style:** dense by default — small favicon, title, date. No thumbnail
column. Hovering a row shows the existing `.bookmark-preview-card` peek
(`dashboard.css:4444`, `dashboard-preview.js`) — the same hover-preview card
used everywhere else in the dashboard. No new hover UI.

**Chronological grouping:** rows are grouped under date separators (Today,
Yesterday, N days ago, last week, …), consistent across columns.

## Move to… becomes bidirectional

The existing "Move to…" picker (`Shift+M`, context menu, `showMovePopover`
in `dashboard-bookmark-rows.js:1279`) lists the hidden Unsorted page as a
valid target alongside ordinary pages/categories. This means:

- Inbox → Unsorted: via "Keep" (see above).
- Dashboard bookmark → Unsorted: via the existing Move to… picker, same as
  moving between any two categories today.
- Unsorted → dashboard category: also via Move to…, unchanged.

No new "unsort" or "move to Unsorted" action is built — it's the same picker
with one more valid entry in its target list.

## Entry point

A nav icon next to the existing Inbox and Health icons, plus the keyboard
shortcut **Shift+U** — matching the existing Shift+first-letter convention
(`dashboard-setup.js:443-504`: Shift+H Health, Shift+I Inbox, Shift+S
Settings, Shift+A Appearance). Gated the same way Inbox and Health are
gated: an `isEnabled()` check backed by a dedicated settings toggle, so the
feature can be turned off entirely for installs that don't want it.

## Open items for the implementation plan

- Exact widget preset shape (item count, whether it's configurable) —
  follows the pattern of existing list-style widgets in
  `dashboard-widget-presets.js`.
- Locale keys for the new labels (six languages: en/nl/de/fr/zh/es) — done
  in a translation round per existing convention, not during feature work.
- Changelog entry for the release this ships in.
