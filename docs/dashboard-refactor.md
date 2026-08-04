# Dashboard.js refactor — method inventory

Baseline: `static/js/dashboard.js` (~10.185 lines, March 2026). **Fase 1 complete:** orchestrator ~1.564 lines.

Pattern: **Config-style composition** — `this.data = new DashboardData(this)` + thin delegation on `Dashboard`. Script load order: `static/js/dashboard/*.js` before `dashboard.js`.

## Module map

| Module | Status | Role |
|--------|--------|------|
| `dashboard-data.js` | Done | Load/save, cross-page helpers, collapsed state |
| `dashboard-config-sync.js` | Done | Config listeners, structure/settings refresh |
| `dashboard-page-nav.js` | Done | Tabs, navigation, rename, deep link |
| `dashboard-tag-filter.js` | Done | Filter view, bulk toolbar, mount/unmount |
| `dashboard-inline-edit.js` | Done | Inline edit guards and flows |
| `dashboard-toolbar.js` | Done | Toolbar, tooltips, side-rail |
| `dashboard-smart-collections.js` | Done | Smart collection eval + partial refresh |
| `dashboard-bookmark-rows.js` | Done | Row DOM, reparent moves, popovers |
| `dashboard-render-core.js` | Done | `renderDashboard`, grid layout, incremental status |
| `dashboard-render-incremental.js` | Done | In-place category/bookmark patches |
| `dashboard-notifications.js` | Done | Toasts and notify helpers |
| `dashboard-visual.js` | Done | Theme and visibility chrome |
| `dashboard-date-weather.js` | Done | Date/time and weather line |
| `dashboard-preview.js` | Done | Link preview cards |
| `dashboard-recent.js` | Done | Recent modal and open-tabs |
| `dashboard-promos.js` | Done | Onboarding, tours, what's-new |
| `dashboard-ui-helpers.js` | Done | Labels, modals, cheat sheet |
| `dashboard-setup.js` | Done | DOM wiring, search/status/nav |
| `dashboard-persistence.js` | Done | Pending saves and order flush |
| `dashboard.js` | Done | Init, state, delegations (~1.564 lines) |

## Fase 2 (incremental DOM)

| Item | Status |
|------|--------|
| Category collapse | Already incremental via `setCategoryCollapsed` (no full rebuild) |
| Status/ping | `renderDashboard({ incremental: 'status' })` + `updateStatusMonitor` refresh |
| Single bookmark move | `reparentBookmarkRowsInDom` skips full render when possible |
| Tag-filter exit | `unmountTagFilterView` before main grid rebuild |
| Smart collections | Partial refresh in `refreshSmartCollectionSections` |
| Config/settings sync | `renderDashboard({ incremental: 'settings' })` refreshes rows in place |
| Bookmark data patch | `DashboardRenderIncremental` patches category lists when structure matches |
| Row fingerprints | `data-render-fp` on full render skips noop incremental row rebuilds |

## PR checklist

- [x] No intentional behavior change (Fase 1)
- [x] Script tags in `templates/dashboard.html` + cache-bust `dash-phase1-2`
- [x] Playwright smoke (`npm run test:e2e`)
- [ ] [Smoke checklist](./dashboard-smoke-checklist.md) manual pass after deploy

## Fase 4 (initial payload)

| Item | Status |
|------|--------|
| Content-hashed `?v=` tokens (`asset_hash.go`, `{{asset}}`) | Done — replaces `asset_versions.go` |
| `dashboard-config.js` (409KB) lazy-loaded on first `#config` | Done — `dashboard-config-loader.js` |
| `defer` on all 78 body scripts (7 head scripts stay blocking) | Done |
| Split `dashboard-config.js` into modules | Open — biggest remaining file by 4× |

Initial dashboard JS: **2082KB → 1673KB (−19.6%)**.

`dashboard-config.js` is now the obvious next candidate for the Fase 1 treatment
that took `dashboard.js` from 10.185 to 1.564 lines. Lazy-loading moved it off the
critical path but did not make it smaller — it is still one 409KB file, and the
first `#config` open pays for all of it.

## Notes

- Load race guard: `_pageBookmarksLoadId` / `isCurrentPageBookmarksLoad`.
- Never hand-write a `?v=` token. `{{asset "js/x.js"}}` in a template, or
  `window.NEXTDASH_ASSETS['js/x.js']` for a script fetched at runtime (add it to
  `lazyLoadedAssets` in `asset_hash.go`). A literal token pins the file for a year.
- The config loader stub mirrors `DashboardConfig.SECTIONS`; `config-lazy-load.spec.js`
  fails if the two lists drift apart.
- `dashboard-tag-cloud.js` stays separate from tag-filter grid view.
- Extraction scripts: `scripts/extract-dashboard-modules.mjs`, `scripts/extract-dashboard-pr10.mjs`.
- Config tour scheduler: `static/js/config/config-tours-runtime.js` (Fase 3.1) — removed with the old config page.
