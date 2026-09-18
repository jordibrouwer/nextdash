# Health View Shell Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the health view onto the shared list-view shell — filters and summary figures into the left rail, actions into the sticky header, the monitors panel into its own destination — and delete the render-teardown machinery that adoption makes redundant.

**Architecture:** The shell (`window.ListViewShell`) already exists and the inbox already runs on it. Health follows the same shape: `mount()` once, repaint only `handle.body`, drive filters through `onFilter`. Two things the inbox never needed come first: the row grid must stop colliding with health's checkbox column, and the shell's Sections block must gain a working click path before Monitors can use it.

**Tech Stack:** Vanilla ES-class JavaScript in classic scripts, plain CSS with the repo's `--space-*` / `--text-*` / `--layout-radius-*` / `--accent-*` tokens, Playwright for DOM tests.

**Spec:** `docs/superpowers/specs/2026-09-07-health-inbox-shell-design.md` — phases 3 and 4, plus the section "What the inbox round learned, for the health plan", which records four findings from the inbox round that shape this work.

## Global Constraints

- **Preserve the data-attribute contract.** Class names may change; these hooks must not: `data-health-filter`, `data-health-tile`, `data-health-toolbar-more`, `data-health-action`, `data-health-key`, `data-menu-toggle`, `data-menu-kind`. Roughly two dozen specs select on them.
- **Pass the class names through too.** The shell takes `filterClass` and `filterCountClass`; health passes `'health-view-filter-btn'` and `'health-view-filter-count'`, exactly as the inbox passes its own. Specs select `[data-health-filter="duplicate"] .health-view-filter-count`.
- **A merged tile keeps both hooks.** Where a tile folds into a filter row, the row carries `data-health-filter="<key>"` **and** `data-health-tile="<key>"`.
- **Design tokens only, and only tokens that exist.** Status colours here are `--accent-error`, `--accent-warning`, `--accent-success` (generated per theme at `internal/app/handlers.go:2654`). There is no `--text-danger` / `--text-warning` / `--text-success` in this codebase — writing `var(--undefined, fallback)` is valid CSS that silently renders the fallback, and that mistake already cost this project one round.
- **Do NOT touch** `static/css/config-view.css` or `static/js/dashboard/dashboard-config.js`.
- **Five locale files.** New UI strings land in all of `locales/{en,nl,de,fr,zh}.json`. Count with `ls locales`.
- **Changelog line per task** under `## Unreleased`. No version heading, no What's New modal — release docs wait for a version number.
- **Commit subjects short, plain, lowercase. No `Co-Authored-By` trailer.** Nothing under `docs/` is committed (`.gitignore:41`). Never `git push`.
- **Test commands** always redirect to a file and echo the exit code — a pipe to `tail` reports exit 0 while tests fail:
  `PW_WORKERS=2 npx playwright test <specs> > /tmp/x.log 2>&1; echo "exit=$?"`
  Run only the specs covering the change. No full-suite sweep, not even as a final check.
- **No fixed `setTimeout` for scroll waits, and never `page.waitForLoadState('networkidle')`** — both were removed from this suite on purpose. Copy `waitForScrollSettled` from `tests/list-view-shell-sticky.spec.js`.
- **Server rule:** nextDash has NO `--port` flag; it reads `PORT` from env only, and an unset `PORT` binds **8080**, which is the user's port and must never be taken or killed. Use `PORT=8099 NEXTDASH_DATA_DIR=/tmp/nextdash-health go run . > /tmp/server.log 2>&1 &`.

## Review policy for this plan

Full review with falsification on Tasks 1, 2 and 3 — they change what the app does. Task 4 (spec repointing, locales, changelog, comment cleanup) gets no dedicated review; it folds into the end-of-branch review.

---

### Task 1: Stop the row grid from eating health's checkbox column

Health rows carry `feed-row--with-select`, which declares a three-track grid with a checkbox column. `feed-row--grid` declares its own three tracks at equal specificity, so whichever comes later in the file wins. If health takes the row anatomy as it stands, the checkbox column silently disappears. Fix the shared rule before health touches it.

**Files:**
- Modify: `static/css/feed-row.css`
- Modify: `static/js/dashboard/dashboard-inbox.js` (the row's class list)
- Test: `tests/feed-row-grid.spec.js` (create)

**Interfaces:**
- Produces:
  - `.feed-row--grid` — row anatomy and density hooks only. **Declares no `grid-template-columns`.** Columns come from `.feed-row` (two tracks) or from `.feed-row--with-select` (three, with the checkbox).
  - `.feed-row--grid-3` — adds a trailing `auto` track for a view that fills a third column.
  - `.feed-row--grid-2` is **deleted**; the inbox row drops it.

- [ ] **Step 1: Write the failing test**

Create `tests/feed-row-grid.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The row anatomy is shared by inbox, health and config's bookmarks list.
 * `--grid` carries alignment and density; it must not dictate columns, because
 * `--with-select` needs a checkbox track and the two rules have equal weight.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
}

const columnsOf = (page, classes) => page.evaluate((cls) => {
    const host = document.createElement('div');
    host.style.width = '900px';
    document.body.appendChild(host);
    const row = document.createElement('article');
    row.className = cls;
    row.innerHTML = '<span>a</span><span>b</span><span>c</span>';
    host.appendChild(row);
    const cols = getComputedStyle(row).gridTemplateColumns;
    host.remove();
    return cols;
}, classes);

test('--grid does not dictate columns', async ({ page }) => {
    await openDashboard(page);
    const plain = await columnsOf(page, 'feed-row');
    const grid = await columnsOf(page, 'feed-row feed-row--grid');
    expect(grid, '--grid changed the column track list').toBe(plain);
});

test('--grid keeps the checkbox column when combined with --with-select', async ({ page }) => {
    await openDashboard(page);
    const select = await columnsOf(page, 'feed-row feed-row--with-select');
    const both = await columnsOf(page, 'feed-row feed-row--with-select feed-row--grid');
    expect(both, 'the checkbox column disappeared under --grid').toBe(select);
    expect(both.split(' ').length, `expected three tracks, got "${both}"`).toBe(3);
});

test('--grid-3 adds a trailing track', async ({ page }) => {
    await openDashboard(page);
    const two = await columnsOf(page, 'feed-row feed-row--grid');
    const three = await columnsOf(page, 'feed-row feed-row--grid feed-row--grid-3');
    expect(three.split(' ').length).toBe(two.split(' ').length + 1);
});

test('--grid-2 is gone from the stylesheet', async ({ page }) => {
    await openDashboard(page);
    const present = await page.evaluate(async () => {
        const href = [...document.styleSheets].map((s) => s.href).filter(Boolean)
            .find((h) => h.includes('feed-row.css') || h.includes('/bundle/'));
        const text = href ? await (await fetch(href)).text() : '';
        return /feed-row--grid-2/.test(text);
    });
    expect(present, '--grid-2 still exists').toBe(false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
PW_WORKERS=2 npx playwright test tests/feed-row-grid.spec.js > /tmp/h1.log 2>&1; echo "exit=$?"; tail -40 /tmp/h1.log
```

Expected: FAIL — `--grid` currently sets `3rem 1fr auto`, so it differs from plain `.feed-row`, it flattens `--with-select` to three tracks without the checkbox width, and `--grid-2` still exists.

- [ ] **Step 3: Rewrite the grid rules**

In `static/css/feed-row.css`, replace the `.feed-row--grid` block and delete `.feed-row--grid-2`:

```css
/*
 * Row anatomy: alignment and density only.
 *
 * Columns deliberately stay with the base rule and with --with-select. Both
 * declare grid-template-columns at the same specificity, so a third
 * declaration here would win by source order and silently drop the checkbox
 * column from every health row.
 */
.feed-row--grid {
    align-items: start;
}

/* For a view that fills a trailing column, such as a score or a status pill. */
.feed-row--grid-3 {
    grid-template-columns: 3rem 1fr auto;
}

body[data-list-density="compact"] .feed-row--grid {
    padding-block: var(--space-1);
}

body[data-list-density="comfortable"] .feed-row--grid {
    padding-block: var(--space-3);
}
```

- [ ] **Step 4: Drop `--grid-2` from the inbox row**

In `static/js/dashboard/dashboard-inbox.js`, the row's class list currently reads `feed-row feed-row--grid feed-row--grid-2 inbox-item`. Remove `feed-row--grid-2`; the base two-track grid is now what `--grid` leaves in place.

- [ ] **Step 5: Run the new spec and the inbox surface**

```bash
PW_WORKERS=2 npx playwright test tests/feed-row-grid.spec.js tests/list-view-density.spec.js tests/inbox-shell-adoption.spec.js tests/view-visual-alignment.spec.js > /tmp/h1.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/h1.log | tail -3
```

Expected: PASS. `view-visual-alignment.spec.js` asserts `grid-template-columns: 3rem 1fr` appears in none of the three view stylesheets — the declaration lives in `feed-row.css`, so it still holds.

- [ ] **Step 6: Falsify**

Temporarily add `grid-template-columns: 3rem 1fr auto;` back into `.feed-row--grid` and re-run. Expected: the first two tests FAIL. Remove it again and confirm they pass. Report both runs.

- [ ] **Step 7: Look at the inbox in a browser**

```bash
PORT=8099 NEXTDASH_DATA_DIR=/tmp/nextdash-health go run . > /tmp/server.log 2>&1 &
```

Open `http://localhost:8099/#inbox`. Confirm rows still lay out correctly and the density toggle still changes row height. Stop the server by the PID you captured.

- [ ] **Step 8: Commit**

```bash
git add static/css/feed-row.css static/js/dashboard/dashboard-inbox.js tests/feed-row-grid.spec.js
git commit -m "keep the row grid out of the column business"
```

---

### Task 2: Health adopts the shell

The big one. Health's header, tiles, toolbar and legend become shell configuration; the tiles merge into the rail's filter list; `render()` narrows to `handle.body`; the caret machinery goes.

**Files:**
- Modify: `static/js/dashboard/dashboard-health.js` — `render()` (`:3235-3362`), `renderHeader` (`:4307`), `renderTiles` (`:4357`), `renderToolbar` (`:4968`), `renderLegend` (`:5535`), `finishRenderFocus` (`:3214-3233`), `createIssueElement` (`:6670`), `closeHealthView` (`:559`)
- Modify: `static/js/dashboard/dashboard-health-loader.js` — `_loadDependencies` (`:31-66`)
- Modify: `static/css/health-view.css`
- Test: `tests/health-shell-adoption.spec.js` (create)

**Interfaces:**
- Consumes: `window.ListViewShell.mount(container, config)` returning `{ id, root, header, headerActions, rail, toolbarRow, toolbar, body, destroy, setSummary, setCounts, setActive, setBreadcrumb }`. `handle.toolbar` is a clearable slot; `handle.toolbarRow` holds the shell-owned density toggle and must never be cleared. Config accepts `{ id, title, description, t, activeFilter, filters[], summary[], sections[], actions[], onFilter, density, filterClass, filterCountClass }`.
- Produces:
  - `DashboardHealth.prototype.shell` — the handle, or `null` before first render.
  - `DashboardHealth.prototype.mountShell()` — mounts once, idempotent.
  - `DashboardHealth.prototype.shellConfig()`, `shellFilterRows()`, `shellSummary()`.
  - `DashboardHealth.prototype.syncRailFilters()` — hides zero-count secondary filters per render, mirroring the inbox.
  - `#dashboard-layout` keeps its `health-layout` class.

**The tile/filter merge, concretely.** Every tile has a matching filter, so this is a clean union — unlike the inbox, no tile is orphaned. Tiles (`:4369-4482`) are `all, healthy, monitored, broken, content, unchecked, stale, unused, drift, certificates`. Primary filters (`:4970-4986`) are `broken, content, duplicate, unchecked, monitored, all`; secondary (`:4950-4966`) are `stale, unused, drift, shortcut-conflict, orphaned-category, missing-preview, certificates, healthy, ignored`. The merged rail list is the union, each row carrying `data-health-filter` plus `data-health-tile` where a tile existed.

**What goes in the summary block** (from `renderHeader`'s meta row, which disappears): the score badge percentage, the trend delta, the broken count when above zero, and the report age.

- [ ] **Step 1: Write the failing test**

Create `tests/health-shell-adoption.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markHealthTutorialSeen } = require('./e2e-helpers');

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await markHealthTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/?hv_filter=all#health');
    await page.waitForFunction(() => window.dashboardInstance?.health != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#dashboard-layout.health-layout .lvs', { timeout: 15_000 });
}

test('health renders inside the shared shell', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('#dashboard-layout.health-layout .lvs')).toHaveCount(1);
    await expect(page.locator('.lvs-rail')).toBeVisible();
    await expect(page.locator('.lvs-header .lvs-title')).toHaveText(/health/i);
    await expect(page.locator('.lvs-body .health-view-feed')).toHaveCount(1);
});

test('the tiles are gone as a row and folded into the rail filters', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.health-view-tiles')).toHaveCount(0);

    // Every surviving tile hook sits on a rail row that is also a filter.
    const merged = await page.evaluate(() => [...document.querySelectorAll('.lvs-rail [data-health-tile]')]
        .map((el) => [el.getAttribute('data-health-tile'), el.getAttribute('data-health-filter')]));
    expect(merged.length).toBeGreaterThan(0);
    for (const [tile, filter] of merged) {
        expect(filter, `tile "${tile}" is not also a filter`).toBe(tile);
    }
});

test('the old filter and count classes still resolve', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.lvs-rail [data-health-filter="all"].health-view-filter-btn')).toHaveCount(1);
    await expect(page.locator('[data-health-filter="all"] .health-view-filter-count')).toHaveCount(1);
});

test('the summary carries the score, not the header', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.lvs-rail .lvs-summary')).toBeVisible();
    await expect(page.locator('.health-view-header-meta')).toHaveCount(0);
    const score = await page.locator('.lvs-summary [data-lvs-summary-key="score"] .lvs-summary-value').textContent();
    expect(score).toMatch(/%$/);
});

test('search, sort and the overflow menu keep their hooks', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.health-view-search-input')).toBeVisible();
    await expect(page.locator('.health-view-sort-select')).toBeVisible();
    await page.locator('[data-health-toolbar-more]').click();
    await expect(page.locator('.health-view-menu--toolbar')).toBeVisible();
});

test('rows keep their checkbox column under the shared grid', async ({ page }) => {
    await openHealth(page);
    const row = page.locator('.health-view-item').first();
    await expect(row).toHaveClass(/feed-row--with-select/);
    await expect(row).toHaveClass(/feed-row--grid/);
    await expect(row.locator('.health-view-select-box')).toHaveCount(1);
    const tracks = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(tracks, 'the checkbox column was lost').toBe(3);
});

test('typing in the search box does not move the caret', async ({ page }) => {
    await openHealth(page);
    const search = page.locator('.health-view-search-input');
    await search.click();
    await search.type('ama', { delay: 60 });
    await page.waitForTimeout(400);
    const caret = await page.evaluate(() => {
        const el = document.querySelector('.health-view-search-input');
        return { focused: document.activeElement === el, start: el.selectionStart, value: el.value };
    });
    expect(caret).toEqual({ focused: true, start: 3, value: 'ama' });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
PW_WORKERS=2 npx playwright test tests/health-shell-adoption.spec.js > /tmp/h2.log 2>&1; echo "exit=$?"; tail -60 /tmp/h2.log
```

Expected: FAIL on the first assertion — `.lvs` has count 0 inside `.health-layout`.

- [ ] **Step 3: Load the shell as a health dependency**

In `static/js/dashboard/dashboard-health-loader.js`, add to `_loadDependencies()`, before the `DashboardHealth` load:

```js
        if (typeof window.ListViewShell === 'undefined') {
            await load('js/shared/list-view-shell.js', 'listViewShell',
                () => typeof window.ListViewShell !== 'undefined');
        }
```

- [ ] **Step 4: Add the config builders**

In `static/js/dashboard/dashboard-health.js`, beside `render()`:

```js
    /** The rail rows: the old filter pills and the old tiles, merged into one list. */
    shellFilterRows() {
        const primary = [
            { key: 'broken', label: this.t('dashboard.healthFilterBroken', 'Broken'), tile: true },
            { key: 'content', label: this.t('dashboard.healthFilterContent', 'Content'), tile: true },
            { key: 'duplicate', label: this.t('dashboard.healthFilterDuplicates', 'Duplicates') },
            { key: 'unchecked', label: this.t('dashboard.healthFilterUnchecked', 'Unchecked'), tile: true },
            { key: 'monitored', label: this.t('dashboard.healthFilterMonitored', 'Monitored'), tile: true },
            { key: 'all', label: this.t('dashboard.healthFilterAll', 'All'), tile: true },
        ];
        return primary.concat(this.secondaryFilterEntries().map((entry) => ({
            key: entry.key,
            label: entry.label,
            tile: ['stale', 'unused', 'drift', 'certificates', 'healthy'].includes(entry.key),
        })));
    }

    /** Figures that are not filters: the score, its trend, and the report's age. */
    shellSummary() {
        const pct = this.scorePercent();
        return [
            { key: 'score', label: this.t('dashboard.healthScore', 'Score'), value: `${pct}%`,
              tone: pct >= 90 ? 'good' : (pct >= 70 ? 'warn' : 'bad') },
            { key: 'trend', label: this.t('dashboard.healthTrend', 'Trend'), value: this.trendDeltaText() },
            { key: 'age', label: this.t('dashboard.healthUpdated', 'Updated'), value: this.reportAgeText() },
        ];
    }

    shellConfig() {
        return {
            id: 'health',
            title: this.t('dashboard.healthPageTitle', 'Health'),
            description: this.t('dashboard.healthSubtitle', 'Bookmarks that need attention'),
            density: true,
            t: (key, fallback) => this.t(key, fallback),
            activeFilter: this.filter,
            filterClass: 'health-view-filter-btn',
            filterCountClass: 'health-view-filter-count',
            filters: this.shellFilterRows().map((row) => ({
                key: row.key,
                label: row.label,
                count: this.filterCount(row.key),
                dataAttrs: row.tile
                    ? { 'data-health-filter': row.key, 'data-health-tile': row.key }
                    : { 'data-health-filter': row.key },
            })),
            summary: this.shellSummary(),
            onFilter: (key, via) => this.applyFilter(key, via === 'click' ? 'pill' : via),
        };
    }

    /** Mounts the shell once; later renders reuse it and repaint only the body. */
    mountShell() {
        const container = document.getElementById('dashboard-layout');
        if (!container || typeof window.ListViewShell === 'undefined') return null;
        if (this.shell && container.contains(this.shell.root)) return this.shell;
        if (this.shell) { this.shell.destroy(); this.shell = null; }
        container.innerHTML = '';
        container.className = 'health-layout';
        this.shell = window.ListViewShell.mount(container, this.shellConfig());
        this.buildToolbar(this.shell.toolbar);
        this.buildHeaderActions(this.shell.headerActions);
        return this.shell;
    }

    /** Hides a secondary filter row while it is empty, and brings it back when it fills. */
    syncRailFilters() {
        const always = new Set(['broken', 'content', 'duplicate', 'unchecked', 'monitored', 'all']);
        this.shell?.rail.querySelectorAll('[data-health-filter]').forEach((btn) => {
            const key = btn.getAttribute('data-health-filter');
            if (always.has(key)) return;
            btn.hidden = !(this.filterCount(key) > 0 || this.filter === key);
        });
    }
```

Add `this.shell = null;` to the constructor beside the other fields. `scorePercent()`, `trendDeltaText()` and `reportAgeText()` are small extractions from `renderHeader` (`:4307-4347`) — pull the percentage, the delta text and the age text out of that markup into three methods returning plain strings, and delete the rest of `renderHeader`.

- [ ] **Step 5: Extract the toolbar and header actions**

Move the toolbar markup at `:5010` into `buildToolbar(host)`, keeping every `data-*` hook, but dropping `.health-view-filter-strip` (the filters live in the rail now) and `.health-view-toolbar-actions` (those move to the header):

```js
    buildToolbar(host) {
        host.innerHTML = `
            <input type="search" class="health-view-search-input"
                placeholder="${this.escape(this.t('dashboard.healthSearchPlaceholder', 'Search bookmarks…'))}">
            <select class="health-view-sort-select"></select>
            <button type="button" class="health-view-groupby-btn">${this.escape(this.t('dashboard.healthGroupBySite', 'Group by site'))}</button>
        `;
        this.bindToolbar(host);
    }
```

and the action row into `buildHeaderActions(host)`, preserving `data-health-toolbar-more`, `data-menu-toggle`, `data-menu-kind` and every menu item class:

```js
    buildHeaderActions(host) {
        host.innerHTML = `
            <button type="button" class="lvs-action lvs-action--primary health-view-focus-btn">
                ${this.escape(this.t('dashboard.healthWorkThrough', 'Work through'))} <kbd>f</kbd>
            </button>
            <button type="button" class="lvs-action health-view-rot-btn">${this.escape(this.t('dashboard.healthRotReport', 'Rot report'))}</button>
            <span class="health-view-menu-wrap">
                <button type="button" class="lvs-action health-view-toolbar-more" data-health-toolbar-more
                    data-menu-toggle data-menu-kind="toolbar">⋯</button>
                <div class="health-view-menu health-view-menu--toolbar" data-menu-for="toolbar" hidden></div>
            </span>
            <button type="button" class="lvs-action view-help-btn health-view-help-btn">ℹ</button>
        `;
        this.bindHeaderActions(host);
    }
```

Move the existing listener wiring from `:5010-5248` into `bindToolbar(host)` and `bindHeaderActions(host)` unchanged, minus the filter-pill block — the shell now reports through `onFilter`. Promote the pill handler's body to `applyFilter(key, via)` as a method.

- [ ] **Step 6: Narrow `render()` to the body**

Replace the teardown at `:3267-3268` and the append sequence:

```js
    render() {
        const shell = this.mountShell();
        if (!shell) return;

        shell.setActive(this.filter);
        shell.setCounts(Object.fromEntries(
            this.shellFilterRows().map((row) => [row.key, this.filterCount(row.key)])));
        shell.setSummary(this.shellSummary());
        shell.setBreadcrumb(this.shellBreadcrumb());
        this.syncRailFilters();

        const body = shell.body;
        body.innerHTML = '';
        // ... the existing loading / error / fleet panel / feed / sentinel /
        //     legend sequence, appending to `body` instead of `container`,
        //     returning early exactly as before.
    }
```

**Delete** `preserveSearch`, `searchCaret` (`:3258-3264`) and `finishRenderFocus` (`:3214-3233`). The search input lives in the shell's toolbar slot, which this render never touches, so the caret cannot move. Keep the parts of the old tail that are still needed: `syncKeyboardSelectionAfterRender()` and `applyPendingIssueFocus()`, called directly.

Add `shellBreadcrumb()` returning only the filter part — **not** the page title. `headerBreadcrumb()` has a second caller at `dashboard-page-nav.js:129` that builds the browser tab title; stripping the root there would make the tab read "Broken — nextDash". This exact trap already caught the inbox round.

- [ ] **Step 7: Give the row the grid class**

In `createIssueElement` (`:6670`), the class list becomes `feed-row feed-row--with-select feed-row--grid health-view-item …`. Task 1 made `--grid` safe to combine with `--with-select`.

- [ ] **Step 8: Destroy the shell on close**

In `closeHealthView()` (`:559`), after the live-refresh teardown:

```js
        this.shell?.destroy?.();
        this.shell = null;
```

- [ ] **Step 9: Run the new spec**

```bash
PW_WORKERS=2 npx playwright test tests/health-shell-adoption.spec.js > /tmp/h2.log 2>&1; echo "exit=$?"; tail -60 /tmp/h2.log
```

Expected: PASS, 7 tests.

- [ ] **Step 10: Run the health regression set that can still pass**

```bash
PW_WORKERS=2 npx playwright test tests/health-check-mode.spec.js tests/health-row-menu.spec.js tests/health-multi-select.spec.js tests/health-explainers.spec.js tests/health-focus-card-detail.spec.js tests/health-lazy-load.spec.js > /tmp/h2b.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/h2b.log | tail -3
```

Expected: PASS — these select by `data-health-*` and by the two class names the pass-through preserves.

**Deliberately excluded, and expected red until Task 4:** `health-header-compact`, `health-tile-filter-agreement`, `health-trend-placement`, `health-toolbar-styling`, `health-dashboard-view`, `layout-modern-health`, `view-resize-layout`, `view-visual-alignment`. They select `.health-view-tiles`, `.health-view-tile-value`, `.health-view-header-meta` or `.health-view-filter-group`, all of which this task removes on purpose. Do not re-add the markup to keep them green.

- [ ] **Step 11: Falsify the caret test**

Restore `finishRenderFocus` and call it at the end of `render()`. Re-run the caret test and report what happens — if it still passes, the test is not load-bearing and must be tightened before you proceed. Remove the restoration again.

- [ ] **Step 12: Look at it in a browser**

Start the server on 8099 and open `http://localhost:8099/#health`. Check: the rail shows filters with counts and hides the empty secondary ones, the summary shows score, trend and age, Work through stays reachable while scrolling, the checkbox column is still there, and typing in search does not move the caret. Report what you saw.

- [ ] **Step 13: Commit**

```bash
git add static/js/dashboard/dashboard-health.js static/js/dashboard/dashboard-health-loader.js static/css/health-view.css tests/health-shell-adoption.spec.js
git commit -m "put health on the shared shell"
```

---

### Task 3: Monitors becomes its own destination

`renderFleetPanel()` (`:3726`) renders only when `filter === 'monitored'`, so today the fleet statistics are wedged inside a filtered list. The spec wants a compact summary in the rail and the detail behind `#health/monitors`. The shell's Sections block currently renders buttons with no click path, so this task extends the shell first.

**Files:**
- Modify: `static/js/shared/list-view-shell.js`
- Modify: `static/css/list-view-shell.css`
- Modify: `static/js/dashboard/dashboard-health.js`
- Test: `tests/health-monitors-section.spec.js` (create)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces:
  - `config.onSection: (key: string) => void` — called when a section row is activated.
  - `config.activeSection: string | null`, and `handle.setActiveSection(key | null)` toggling `is-active` on `.lvs-section`.
  - Section rows keep `data-lvs-section-key` and gain `dataAttrs` pass-through, exactly like filters.
  - `DashboardHealth.prototype.showMonitorsSection(on)` — swaps the body between the feed and the fleet panel.
  - Hash `#health/monitors`; bare `#health` is the list. Existing `hv_*` query parameters are untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/health-monitors-section.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markHealthTutorialSeen } = require('./e2e-helpers');

async function openHealth(page, hash = '#health') {
    await markWhatsNewSeen(page);
    await markHealthTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.health != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#dashboard-layout.health-layout .lvs', { timeout: 15_000 });
}

test('the rail lists Monitors as a section, separate from the filters', async ({ page }) => {
    await openHealth(page);
    const section = page.locator('.lvs-rail .lvs-section[data-lvs-section-key="monitors"]');
    await expect(section).toBeVisible();
    // A section is a destination, not a filter — it must not carry a filter hook.
    await expect(section).not.toHaveAttribute('data-health-filter', /.*/);
});

test('clicking Monitors shows the fleet panel and changes the hash', async ({ page }) => {
    await openHealth(page);
    await page.locator('.lvs-section[data-lvs-section-key="monitors"]').click();

    await expect(page.locator('.lvs-body .health-fleet')).toHaveCount(1);
    await expect(page.locator('.lvs-body .health-view-feed')).toHaveCount(0);
    await expect(page.locator('.lvs-section[data-lvs-section-key="monitors"]')).toHaveClass(/is-active/);
    expect(new URL(page.url()).hash).toBe('#health/monitors');
});

test('#health/monitors opens the section directly', async ({ page }) => {
    await openHealth(page, '#health/monitors');
    await expect(page.locator('.lvs-body .health-fleet')).toHaveCount(1);
    await expect(page.locator('.lvs-section[data-lvs-section-key="monitors"]')).toHaveClass(/is-active/);
});

test('picking a filter leaves the section and returns to the list', async ({ page }) => {
    await openHealth(page, '#health/monitors');
    await page.locator('.lvs-rail [data-health-filter="all"]').click();

    await expect(page.locator('.lvs-body .health-view-feed')).toHaveCount(1);
    await expect(page.locator('.lvs-body .health-fleet')).toHaveCount(0);
    await expect(page.locator('.lvs-section[data-lvs-section-key="monitors"]')).not.toHaveClass(/is-active/);
    expect(new URL(page.url()).hash).toBe('#health');
});

test('the rail summary reports the fleet without opening it', async ({ page }) => {
    await openHealth(page);
    const uptime = page.locator('.lvs-summary [data-lvs-summary-key="uptime"] .lvs-summary-value');
    await expect(uptime).toHaveText(/%/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
PW_WORKERS=2 npx playwright test tests/health-monitors-section.spec.js > /tmp/h3.log 2>&1; echo "exit=$?"; tail -40 /tmp/h3.log
```

Expected: FAIL — no section row exists, clicking does nothing, `#health/monitors` is not routed.

- [ ] **Step 3: Give the shell a working Sections block**

In `static/js/shared/list-view-shell.js`, where section buttons are built, apply `dataAttrs` the way `buildFilter` does, add a click handler, and add the setter:

```js
        const sectionButtons = () => [...rail.querySelectorAll('.lvs-section')];

        const setActiveSection = (key) => {
            sectionButtons().forEach((btn) => {
                btn.classList.toggle('is-active', btn.dataset.lvsSectionKey === String(key));
            });
        };

        rail.addEventListener('click', (event) => {
            const btn = event.target.closest('.lvs-section');
            if (!btn || !rail.contains(btn)) return;
            if (typeof config.onSection === 'function') {
                config.onSection(btn.dataset.lvsSectionKey);
            }
        });
```

Call `setActiveSection(config.activeSection ?? null)` after the sections are built, and expose `setActiveSection` on the handle. Add an `.lvs-section.is-active` rule to `static/css/list-view-shell.css` matching `.lvs-filter.is-active`.

- [ ] **Step 4: Wire health's Monitors destination**

In `dashboard-health.js`, add `monitors` to the config:

```js
            sections: [{ key: 'monitors', label: this.t('dashboard.healthMonitors', 'Monitors'),
                         count: this.filterCount('monitored') }],
            activeSection: this.section,
            onSection: (key) => this.showMonitorsSection(key === 'monitors'),
```

Add `this.section = null;` to the constructor and:

```js
    /**
     * Monitors is a destination, not a filter: the fleet panel replaces the
     * feed rather than narrowing it.
     */
    showMonitorsSection(on) {
        this.section = on ? 'monitors' : null;
        this.shell?.setActiveSection(this.section);
        this.syncUrlState();
        this.render();
    }
```

In `render()`, branch on `this.section`: when it is `'monitors'`, append `renderFleetPanel()` to the body and skip the feed; otherwise render the feed as usual. Drop the `filter === 'monitored'` gate from `renderFleetPanel()` — the section now decides.

In `syncUrlState()` (`:5789-5806`), write the hash as `#health/monitors` when the section is open and `#health` otherwise, leaving every `hv_*` parameter exactly as it is. In `restoreViewState()` (`:5721`), read the section back out of the hash. Selecting any filter clears the section — add `this.section = null;` at the top of `applyFilter`.

- [ ] **Step 5: Add the fleet summary to the rail**

Extend `shellSummary()` with an uptime entry when `this.report?.fleet?.monitors > 0`:

```js
        const fleet = this.report?.fleet;
        if (fleet && Number(fleet.monitors) > 0) {
            entries.push({ key: 'uptime',
                label: this.t('dashboard.healthUptime24h', 'Uptime 24h'),
                value: `${Math.round(Number(fleet.uptime24h) || 0)}%`,
                tone: Number(fleet.downNow) > 0 ? 'bad' : 'good' });
        }
```

- [ ] **Step 6: Run the new spec and Task 2's**

```bash
PW_WORKERS=2 npx playwright test tests/health-monitors-section.spec.js tests/health-shell-adoption.spec.js > /tmp/h3.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/h3.log | tail -3
```

Expected: PASS, 12 tests.

- [ ] **Step 7: Falsify**

Remove the `rail.addEventListener('click', …)` block added in Step 3 and re-run. Expected: `clicking Monitors shows the fleet panel` FAILS. Restore it and confirm it passes. Report both runs.

- [ ] **Step 8: Commit**

```bash
git add static/js/shared/list-view-shell.js static/css/list-view-shell.css static/js/dashboard/dashboard-health.js tests/health-monitors-section.spec.js
git commit -m "give health a monitors section of its own"
```

---

### Task 4: Repoint the specs, translate, and tidy

No dedicated review — this task folds into the end-of-branch review. Nothing here changes what the app does.

**Files:**
- Modify: `tests/health-header-compact.spec.js`, `tests/health-tile-filter-agreement.spec.js`, `tests/health-trend-placement.spec.js`, `tests/health-toolbar-styling.spec.js`, `tests/health-dashboard-view.spec.js`, `tests/layout-modern-health.spec.js`, `tests/view-visual-alignment.spec.js`
- Modify (found by the Task 2 review, same genus): `tests/health-cert-tile-and-previews.spec.js:48` (opener waits for `.health-view-tiles`), `tests/health-collection-stats.spec.js:90-126` (`.health-view-tile--trend`, `.health-view-trend-delta`, `.health-view-header`), `tests/health-quick-wins.spec.js:154,162` (`.health-view-report-age` — the "just now" text moved into the rail summary), `tests/health-late-render.spec.js:80,91` (`:80` cannot scroll to 400 because max scroll is now 232 — the removed chrome was that height; `:91` plants a menu wrap on `#dashboard-layout`, which `render()` no longer empties), `tests/health-focus-drift-mute.spec.js:358` (asserts `flexWrap === 'wrap'` on the filter row, now a rail column)
- **Not** in this list: `tests/view-resize-layout.spec.js` — the Task 2 review found it passes unchanged.
- Modify: `locales/{en,nl,de,fr,zh}.json`
- Modify: `static/css/health-view.css` (stale comments)
- Modify: `CHANGELOG.md`

**Interfaces:** none — no runtime surface changes.

- [ ] **Step 1: Establish the baseline**

```bash
PW_WORKERS=2 npx playwright test tests/health-header-compact.spec.js tests/health-tile-filter-agreement.spec.js tests/health-trend-placement.spec.js tests/health-toolbar-styling.spec.js tests/health-dashboard-view.spec.js tests/layout-modern-health.spec.js tests/view-resize-layout.spec.js tests/view-visual-alignment.spec.js > /tmp/h4-before.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/h4-before.log | tail -4
```

Record which tests fail and why. Every edit must be justified by one of those failures. **Do not touch a test that already passes.**

- [ ] **Step 2: Repoint, using this mapping**

| Gone | Now |
|---|---|
| `.health-view-tiles` | `.lvs-group--filters` |
| `[data-health-tile="X"]` | `.lvs-rail [data-health-tile="X"]` |
| `.health-view-tile-value` | `.lvs-filter-count` |
| `.health-view-tile-label` | `.lvs-filter-label` |
| `.health-view-filter-group` | `.lvs-group--filters` |
| `.health-view-header-meta` / `.health-view-score-badge` | `.lvs-summary [data-lvs-summary-key="score"]` |
| `.health-view-trend-delta` | `.lvs-summary [data-lvs-summary-key="trend"]` |
| `.health-view-report-age` | `.lvs-summary [data-lvs-summary-key="age"]` |
| `.health-view-subtitle` | `.lvs-description` |
| `.health-view-header` | `.lvs-header` |

Repoint; do not resurrect. A hidden rail row is present in the DOM, so `count()` is 1 — assert on visibility or box height, not absence.

**`tests/health-tile-filter-agreement.spec.js` loses its premise entirely.** It asserts that each tile's count matches the row count its filter lists. Once a tile and its filter are one control, the question is meaningless. Delete the file and say so in your report — do not leave a hollowed-out version.

**`tests/health-trend-placement.spec.js`** asserts the trend sits in the tiles and not in the toolbar. The trend now lives in the rail summary. Repoint the first assertion and drop the second if the toolbar no longer exists to exclude it from.

- [ ] **Step 3: Add the locale strings**

`ls locales` first and confirm five files. Add under `dashboard` in each, matching the file's existing formatting:

`en.json`
```json
    "healthMonitors": "Monitors",
    "healthUptime24h": "Uptime 24h",
    "healthScore": "Score",
    "healthTrend": "Trend",
    "healthUpdated": "Updated",
```

`nl.json`
```json
    "healthMonitors": "Monitors",
    "healthUptime24h": "Uptime 24u",
    "healthScore": "Score",
    "healthTrend": "Trend",
    "healthUpdated": "Bijgewerkt",
```

`de.json`
```json
    "healthMonitors": "Monitore",
    "healthUptime24h": "Verfügbarkeit 24 h",
    "healthScore": "Bewertung",
    "healthTrend": "Trend",
    "healthUpdated": "Aktualisiert",
```

`fr.json`
```json
    "healthMonitors": "Moniteurs",
    "healthUptime24h": "Disponibilité 24 h",
    "healthScore": "Score",
    "healthTrend": "Tendance",
    "healthUpdated": "Mis à jour",
```

`zh.json`
```json
    "healthMonitors": "监控",
    "healthUptime24h": "24 小时可用率",
    "healthScore": "评分",
    "healthTrend": "趋势",
    "healthUpdated": "已更新",
```

Then `npm run validate:json > /tmp/json.log 2>&1; echo "exit=$?"`.

- [ ] **Step 4: Fix the stale comments**

`static/css/health-view.css` carries ten comments describing health as a sibling of the inbox's now-deleted classes — at lines 2, 18, 51, 493-495, 542, 1051, 1088, 2082, 2324 and 2380. They name `.inbox-header`, `.inbox-date-group` and "same card grammar", none of which exist any more. Rewrite them to describe the shared shell, or delete them where they no longer say anything true. These are comments only; change no rule.

- [ ] **Step 5: Changelog**

Under `## Unreleased`, in a `### Health` subsection, matching the neighbouring entries' style and labels. Write for someone who uses the dashboard: the left column with filters and their counts, the score and trend as a readout above them, the tile row gone because it repeated those counts, the header that stays put while scrolling, Monitors as its own place rather than a filter, and rows that can be compact or comfortable. No version heading, no What's New modal.

- [ ] **Step 6: Run everything this branch touches**

```bash
PW_WORKERS=2 npx playwright test tests/health-shell-adoption.spec.js tests/health-monitors-section.spec.js tests/feed-row-grid.spec.js tests/health-header-compact.spec.js tests/health-trend-placement.spec.js tests/health-toolbar-styling.spec.js tests/health-dashboard-view.spec.js tests/layout-modern-health.spec.js tests/view-resize-layout.spec.js tests/view-visual-alignment.spec.js > /tmp/h4.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/h4.log | tail -4
```

Expected: PASS. After this task no health spec should be red.

- [ ] **Step 7: Commit**

```bash
git add tests/ locales/ static/css/health-view.css CHANGELOG.md
git commit -m "point the health specs at the new shell"
```

---

## Self-Review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| Health adopts the shell, rail with summary above filters | 2 |
| Tiles and filters merged into one control | 2 |
| Sticky header carrying the primary actions | 2 (inherited from the shell) |
| Row anatomy and density on health rows | 1, 2 |
| Monitors: compact summary in the rail, detail in its own section | 3 |
| `#health/monitors` readable hash, `hv_*` parameters untouched | 3 |
| Caret workaround deleted rather than hidden | 2 |
| Grid collision resolved before health adopts the row | 1 |
| Sections block extended, not merely configured | 3 |
| Five locale files | 4 |
| Changelog, no release docs | 4 |
| Specs whose premise changed | 4 |

The spec's fourth learning — three un-consolidated re-render copies still in `dashboard-inbox.js` — is **not** in this plan. They are inbox code, they pre-date both plans, and folding them in would mean touching the inbox while health is mid-adoption. They stay on the deferred list.

**Placeholder scan.** One `// ...` in Task 2 Step 6, naming exactly which existing sequence moves and what changes about it (`container` becomes `body`). Everything else carries real code.

**Type consistency.** `shell.setActive`, `setCounts`, `setSummary`, `setBreadcrumb`, `setActiveSection`, `destroy`, `handle.body`, `handle.toolbar`, `handle.headerActions`, `handle.rail` are named identically across tasks. `config.onFilter(key, via)` matches `applyFilter(key, via)`; `config.onSection(key)` matches `showMonitorsSection(on)` through the comparison in the config block. `shellFilterRows()` is used by both `shellConfig()` and `render()`'s `setCounts` call, with the same keys.

**One risk worth naming.** Task 2 Step 4 assumes `scorePercent()`, `trendDeltaText()` and `reportAgeText()` can be extracted cleanly from `renderHeader`. If that markup turns out to compute those values inline in a way that resists extraction, the implementer should say so rather than duplicating the logic.
