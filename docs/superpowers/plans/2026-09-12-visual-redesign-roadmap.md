# Visual Redesign — Roadmap and Decisions

Status: **awaiting decisions**. Nothing below is started.

The header work is reverted. `redesign-ui` is back at `b31e3845`; the eleven header commits are preserved on `redesign-ui-header-attempt` and can be cherry-picked if a piece of them is ever wanted. The design artefacts survive: `.superdesign/design-system.md`, `.superdesign/init/`, `.superdesign/resume.json`, and the Superdesign canvas.

---

## What the codebase already has

Checked in the reverted tree, not assumed. This changes what is worth building.

| Thing | State | Where |
|---|---|---|
| Glass depth step | **Ships already.** `data-depth="glass"` is a real user setting | `static/css/theme-character.css:77`, `internal/app/models.go:3684`, `dashboard-config.js:8525` |
| Surface ladder | `--surface-1/2/3`, `--surface-sheen`, `--edge-light`, `--hairline`, `--depth-wash`, three steps scaled by `--theme-depth` | `static/css/theme-depth.css` (801 lines) |
| Page wash | Two accent radial clouds + dots, exactly what the drafts show | `theme-depth.css` `--depth-wash` |
| Widget meter | 6px with a visible track, tone classes `--good/--warn/--bad` | `dashboard.css:6207-6226` |
| Widget freshness line | `.dashboard-widget-asof` | `dashboard.css:5965` |
| Widget trend tones | `.is-better` / `.is-worse` / `.is-level`, sparkline ticks toned too | `dashboard.css:5811-5854` |
| Tabular figures | 15 uses across widget CSS | `dashboard.css` |
| Health widget rows | Hairlines drawn by a 1px gap over a tinted ground — no dangling last border | `dashboard.css:5598-5620` |
| Shared list chrome | `ListViewShell` — inbox and health only. **Config does not use it** (`grep -c ListViewShell dashboard-config.js` → 0) | `static/js/shared/list-view-shell.js` |

**Consequence:** several items from the drafts are already true in the product. The remaining visual work is smaller and differently shaped than the drafts imply. Each slice below says what is actually missing.

---

## What the header revert costs

Parts of the design assumed the merged header. Without it:

- The view name still appears twice on inbox and health (small in the app header, large in `.lvs-title`).
- The page title band stays: ~94px between the header and the grid, and a full-width row carrying one word.
- The view's buttons stay in the panel's own sticky header rather than the app row.
- The action bar keeps all eight buttons, including `> search`, `: commands`, `? finders`.

None of that blocks the visual work below. It is a separate decision.

---

## The slices

Each is independently shippable, has its own tests, and can be taken or left.

### Slice A — Widgets: multi-tone figures and shared tiles
**Missing today:** `.dashboard-widget-figure-value` carries no tone at all — every figure in a stats widget is the same colour. The trend and meter are toned; the figures are not. And config's statistics tiles (`.config-stat*`, 46 uses in `config-view.css`) are a second, unrelated component drawing the same kind of number.

**Change:**
1. Tone classes on `.dashboard-widget-figure-value` (`--good/--warn/--bad/--info`), applied by the widget builders per meaning.
2. A figure with a destination becomes a link with a key chip: broken → the broken filter, waiting → inbox, monitored → the monitor list.
3. One `StatTile` used by both widgets and config statistics, in two sizes.

**Touches:** `dashboard.css` widget block, `dashboard-widget-*.js`, `config-view.css`, `dashboard-config-stats.js`
**Tests in blast radius:** widget specs + config statistics specs
**Risk:** low for 1, medium for 3 (config's tiles are load-bearing in 209 config specs)
**Estimate:** 1 = half a day · 2 = half a day · 3 = 1–2 days

---

### Slice B — Glass refined into three tiers
**Missing today:** the shipped glass step uses one `--theme-surface-alpha` for everything, applied through a hand-maintained selector list that the file itself flags as debt ("zodra de `.nd-*` classlaag er is vervangt één naam de hele lijst"). So a context menu is as translucent as the page background — the thing that made the first draft unreadable.

**Change:** split into three tiers by reading need — page/header most translucent, blocks and rails mid, overlays near-opaque (≥92%) — plus the darker bottom edge to match `--edge-light`.

**Touches:** `static/css/theme-character.css` only, plus `theme-depth.css` for the edge token
**Tests in blast radius:** 39 theme/depth specs
**Risk:** low. Scoped to one depth step that users opt into; `flat`, `soft`, `rich` untouched
**Estimate:** 1–2 days, most of it checking light, paper and high-chroma themes

---

### Slice C — Context menu at the top level
**Why:** an element with `backdrop-filter` creates a stacking context, so a popover rendered inside a blurred container cannot rise above a blurred sibling. Today `contextMenu.bindRow(row)` builds the menu inside the row.

**Change:** render at the top level, positioned against the anchor row.

**Touches:** `static/js/dashboard/dashboard-context-menu.js`, `dashboard.css:258-470`
**Risk:** **highest of the set.** Blur compositing is the standing suspect in the unresolved Safari bug where the Health → Edit inline form does not catch clicks. This must be verified in Safari before it lands
**Estimate:** 1 day, plus Safari verification that may reopen the bug

**Only needed if Slice B lands.** Without glass on containers, nothing traps the menu.

---

### Slice D — One command surface
**Change:** search, commands and finders become one panel that switches mode on a key, with the three mode pills in a segmented footer. Today they are one DOM overlay but read as three separate things.

**Touches:** the search stack — `search.js` (3421), `search-commands.js` (3901), `search-commands-new.js` (1880), `search.css` (1194)
**Risk:** medium-high. This is the most-used surface in the product and the largest JS in the app after config
**Estimate:** 3–5 days

---

### Slice E — Config: blocks, help, news
**Change:** settings arranged as blocks where a setting has something to show (Appearance, Widgets) and as rows where it is a long list of switches (Bookmarks, Behavior, Data & backups). Help as tip blocks, News as one dated stream.

**Touches:** `config-view.css` (7207 lines), `dashboard-config.js` (27004 lines)
**Tests in blast radius:** **209 specs**
**Risk:** highest by volume. A previous single-shot split of `dashboard-config.js` failed 41 tests; this has to go section by section
**Estimate:** 2–4 weeks, one plan per section group

---

### Slice F — Header (reverted, available)
The eleven commits on `redesign-ui-header-attempt`: bounded page strip with a `+N` chip, printed page keys, merged header, sticky app header, view actions in the row.

**Known unfinished:** the page track sizing never settled. Three shapes were tried; each fixed one problem and caused another (icons wrapping / track claiming the row's free width / track collapsing to nothing). The last state had the right visual behaviour, verified by direct measurement (18 pages → 7 tabs + `+11` chip; 1 page → 24px track beside the icons) but a red test suite.

**If ever resumed:** the two root causes are known and written down. The fit must be idempotent (hide tabs, never remove them — a second pass over a trimmed list takes the chip away again, which is the ">4 pages all side by side" symptom), and the header row must stop wrapping so its children shrink instead.

---

## Decisions I need

1. **Which slices, and in what order?** My suggestion: A → B → C, then reassess. D and E are each their own project.
2. **Slice A part 3 (shared StatTile):** worth touching config's tiles now, or keep widgets and config separate for the moment?
3. **Slice C:** accept the Safari risk, or park the context menu until the existing Health → Edit bug is understood?
4. **Slice F:** leave it on its branch, or is there a piece worth cherry-picking on its own — for instance the `+N` overflow chip without the merged header?
5. **Verification depth:** the earlier work ran each change against its neighbours plus two or three full re-runs for stability. Keep that, or lighter?
6. **The changelog line** still waits on a version number for anything that ships.
