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

## PR checklist

- [x] No intentional behavior change (Fase 1)
- [x] Script tags in `templates/dashboard.html` + cache-bust `dash-phase1-2`
- [x] Playwright smoke (`npm run test:e2e`)
- [ ] [Smoke checklist](./dashboard-smoke-checklist.md) manual pass after deploy

## Notes

- Load race guard: `_pageBookmarksLoadId` / `isCurrentPageBookmarksLoad`.
- `dashboard-tag-cloud.js` stays separate from tag-filter grid view.
- Extraction scripts: `scripts/extract-dashboard-modules.mjs`, `scripts/extract-dashboard-pr10.mjs`.
- Config tour scheduler: `static/js/config/config-tours-runtime.js` (Fase 3.1).
