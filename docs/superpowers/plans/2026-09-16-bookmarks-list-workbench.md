# Bookmarks List Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Config → Bookmarks → List with a three-part workbench — filter rail, grouped slab list, detail/bulk panel — without changing any storage or API.

**Architecture:** Pure logic (health state, facet counts, grouping, windowing, bulk mutation) lives in a DOM-free model file tested with plain Node. Rendering and binding live in a new lazy-loaded prototype module next to `dashboard-config-bookmarks.js`; `dashboard-config.js` keeps the filter state and the write paths and only delegates. Old controls are removed task by task, so every task ends green.

**Tech Stack:** Vanilla JS (prototype mixins on `DashboardConfig`), plain CSS with theme tokens, Go server (asset hashes only), Playwright e2e, Node `assert` unit tests.

**Spec:** `docs/superpowers/specs/2026-09-16-bookmarks-list-workbench-design.md`

## Global Constraints

- Branch: `bookmarks-list-redesign`. Never push `docs/`. Commit only after Jordi has approved running this plan with commits.
- Commit messages: short, plain lowercase subject (like `spec the bookmarks list workbench`). No `Co-Authored-By` trailer.
- Every commit adds a line to `CHANGELOG.md` under the **Docs** section of the version heading Jordi names. Ask for that heading before the first commit; do not invent a version.
- Any change under `static/` → run `go run scripts/gen-asset-hashes.go` and commit `internal/app/asset_hashes_gen.go` with it. Never hand-write `?v=`.
- New UI strings: add to `locales/en.json` only (under `config`), always with a `this.t(key, fallback)` fallback. No other locale in this plan.
- No AI references in any user-facing text.
- Scroll locking only through `window.ScrollLock.acquire(owner)` / `release(token)`; never write `body.style.overflow`.
- No `backdrop-filter` on the panel, rail, drawer or anything that takes clicks.
- Keyboard legend: `<kbd>` chips via `renderKeyboardLegendPairs`; key names untranslated, only labels go through `t()`.
- Tests: `PW_WORKERS=2`, only the specs named in the task, output to a file, exit code read from the file:
  `PW_WORKERS=2 npx playwright test <specs> > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt`
  Never a full-suite run. Never port 8080; manual checks on port 8099.
- Each Bash call stays under 30 s; start Playwright with `run_in_background` when a run takes longer.
- Every new e2e test is falsified once (break the code, see it fail, restore). Drive tests through clicks and keys, not by calling render functions.
- Bookmark identity is `bookmarkKey(b)` (`pageId::url[::n]`). A write that changes URL or page changes the key.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `static/js/shared/bookmark-workbench-model.js` | create | DOM-free logic: health state, facet counts, list items, item window, shared values, bulk mutation, ranges. Exposes `window.BookmarkWorkbenchModel`. |
| `tests/bookmark-workbench-model.test.cjs` | create | Node unit tests for the model. |
| `static/js/dashboard/dashboard-config-bookmarks-workbench.js` | create | Prototype mixin: layout, rail, list rows, panel (single + bulk), their binders. Sets `window.DashboardConfigWorkbenchReady`. |
| `static/css/config-bookmarks-workbench.css` | create | All workbench styling (rail, slabs, rows, panel, drawer, sheet). |
| `static/js/dashboard/dashboard-config-bookmarks.js` | modify | Loses `renderBookmarksList`, `renderBookmarkRow`, quick bar, tag cloud, chips, banner, bulk toolbar, row actions. Keeps usage tooltip, count label, empty reason, crumb. |
| `static/js/dashboard/dashboard-config.js` | modify | Filter state (+`bmHealthFilter`), hash sync, loader, keyboard, bulk writers taking arguments, generic field save. List-tab wrapper shrinks. |
| `static/js/dashboard/dashboard-config-context-menu.js` | modify | Edit and bulk entries point at the panel. |
| `static/css/config-view.css` | modify | Remove List-only rules that the workbench replaces. |
| `templates/dashboard.html` | modify | `<link>` for the new stylesheet in `bundle:css-views`. |
| `internal/app/asset_hash.go` | modify | Add the two new scripts to `lazyLoadedAssets`. |
| `locales/en.json` | modify | New `config.bm*` strings. |
| `package.json` | modify | `test:workbench-model` script. |
| `tests/config-bookmarks-rail.spec.js` | create | Rail behaviour. |
| `tests/config-bookmarks-grouping.spec.js` | create | Slabs and crumbs. |
| `tests/config-bookmarks-panel.spec.js` | create | Single-bookmark panel. |
| `tests/config-bookmarks-bulk.spec.js` | create | Selection and bulk form. |
| `tests/config-bookmarks-narrow.spec.js` | create | Drawer and sheet. |
| existing `tests/config-bookmarks-*.spec.js` and others listed per task | modify | New selectors, removed behaviour. |

Stable ids kept on purpose (existing specs use them): `#config-bm-list`, `#config-bm-search`, `#config-bm-sort`, `#config-bm-add`, `#config-bm-count`, `#config-bm-count-live`, row class `.config-bm-row` with `data-bm-key`, checkbox `.config-bm-tick` with `data-bm-tick`.

Adding locale keys (used by several tasks): define the helper and run it with that task's key/value pairs in the same shell call (`node -e "$LOCALE_HELPER" '{"key":"value"}'`) — shell variables do not survive between tool calls.

```bash
LOCALE_HELPER='
const fs=require("fs");const p="locales/en.json";
const d=JSON.parse(fs.readFileSync(p,"utf8"));
const add=JSON.parse(process.argv[1]);
for (const [k,v] of Object.entries(add)) { if (!(k in d.config)) d.config[k]=v; }
fs.writeFileSync(p, JSON.stringify(d,null,2)+"\n");
'
```

---

### Task 1: Workbench model (pure logic)

**Files:**
- Create: `static/js/shared/bookmark-workbench-model.js`
- Create: `tests/bookmark-workbench-model.test.cjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nothing.
- Produces `window.BookmarkWorkbenchModel` with:
  - `healthState(bookmark, facts) → 'unchecked'|'broken'|'down'|'healthy'` — `facts` is `window.HealthFacts.get(url)` or `null`.
  - `facetCounts(list, facets) → { [facetName]: Map<string, number> }` — `facets` is `{ [name]: { keys(b) → string[], test(b) → boolean } }`; a facet's counts apply every *other* facet's `test`.
  - `buildItems(rows, { grouped, groupKey(b) → string, groupLabel(b) → string }) → Item[]` where `Item` is `{ type: 'head', key, label, count }` or `{ type: 'row', bookmark, index, groupStart, groupEnd }` (`index` = position among rows).
  - `itemWindow(items, { scrollTop, viewport, rowHeight, headHeight, overscan = 20, minItems = 120 }) → null | { start, end, above, below }` (`above`/`below` in px).
  - `itemOffset(items, itemIndex, rowHeight, headHeight) → px`.
  - `sharedValue(values) → { mixed: boolean, value }`.
  - `tagCounts(bookmarks) → Array<[tag, count]>` sorted by count desc, then tag.
  - `bulkMutation(changes, assignCheckMode) → (b) → b` — `changes` may hold `category` (string), `tags` (`{ mode: 'add'|'replace'|'remove', list: string[] }`), `pinned` (boolean), `checkMode` (string). Returns a new object.
  - `rangeKeys(keys, anchor, focus) → string[]` inclusive, in list order; `[focus]` if anchor is absent.

- [ ] **Step 1: Write the failing test**

Create `tests/bookmark-workbench-model.test.cjs`:

```js
'use strict';

/**
 * The workbench's arithmetic, without a browser.
 *
 * Run with: node tests/bookmark-workbench-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'shared', 'bookmark-workbench-model.js'), 'utf8'))();
const M = window.BookmarkWorkbenchModel;

// healthState
assert.strictEqual(M.healthState({ checkStatus: false }, null), 'unchecked');
assert.strictEqual(M.healthState({ checkStatus: true }, null), 'healthy');
assert.strictEqual(M.healthState({ checkStatus: true }, { brokenSince: 5 }), 'broken');
assert.strictEqual(M.healthState({ checkStatus: true }, { monitor: true, downSince: 9 }), 'down');
// a monitor that is down outranks an older broken mark
assert.strictEqual(M.healthState({ checkStatus: true }, { monitor: true, downSince: 9, brokenSince: 5 }), 'down');

// facetCounts: each facet counts with the others applied, not itself
const list = [
    { pageId: 1, tags: ['a'] },
    { pageId: 1, tags: ['b'] },
    { pageId: 2, tags: ['a'] },
];
const pageFilter = '1';
const tagFilter = ['a'];
const counts = M.facetCounts(list, {
    page: { keys: (b) => [String(b.pageId)], test: (b) => String(b.pageId) === pageFilter },
    tag: { keys: (b) => b.tags, test: (b) => b.tags.some((t) => tagFilter.includes(t)) },
});
assert.strictEqual(counts.page.get('1'), 1, 'page 1 under tag a');
assert.strictEqual(counts.page.get('2'), 1, 'page 2 under tag a, page filter ignored');
assert.strictEqual(counts.tag.get('a'), 1, 'tag a on page 1');
assert.strictEqual(counts.tag.get('b'), 1, 'tag b on page 1, tag filter ignored');

// buildItems
const rows = [
    { name: 'x', g: 'W' }, { name: 'y', g: 'W' }, { name: 'z', g: 'H' },
];
const grouped = M.buildItems(rows, { grouped: true, groupKey: (b) => b.g, groupLabel: (b) => `L${b.g}` });
assert.deepStrictEqual(grouped.map((i) => i.type), ['head', 'row', 'row', 'head', 'row']);
assert.deepStrictEqual(grouped[0], { type: 'head', key: 'W', label: 'LW', count: 2 });
assert.strictEqual(grouped[1].groupStart, true);
assert.strictEqual(grouped[2].groupEnd, true);
assert.strictEqual(grouped[4].index, 2);
const flat = M.buildItems(rows, { grouped: false });
assert.deepStrictEqual(flat.map((i) => i.type), ['row', 'row', 'row']);
assert.strictEqual(flat[0].groupStart, true);
assert.strictEqual(flat[2].groupEnd, true);

// itemWindow
const many = M.buildItems(Array.from({ length: 300 }, (_, i) => ({ g: i < 150 ? 'A' : 'B' })),
    { grouped: true, groupKey: (b) => b.g, groupLabel: (b) => b.g });
assert.strictEqual(M.itemWindow(many.slice(0, 50), { scrollTop: 0, viewport: 800, rowHeight: 44, headHeight: 32 }), null);
const w = M.itemWindow(many, { scrollTop: 44 * 100, viewport: 440, rowHeight: 44, headHeight: 32, overscan: 5 });
assert.ok(w.start > 0 && w.end < many.length);
assert.strictEqual(w.above, M.itemOffset(many, w.start, 44, 32));
const total = M.itemOffset(many, many.length, 44, 32);
assert.strictEqual(w.above + (M.itemOffset(many, w.end, 44, 32) - w.above) + w.below, total);
assert.strictEqual(M.itemOffset(many, 2, 44, 32), 32 + 44);

// sharedValue
assert.deepStrictEqual(M.sharedValue(['a', 'a']), { mixed: false, value: 'a' });
assert.deepStrictEqual(M.sharedValue(['a', 'b']), { mixed: true, value: null });
assert.deepStrictEqual(M.sharedValue([]), { mixed: false, value: null });

// tagCounts
assert.deepStrictEqual(M.tagCounts([{ tags: ['b', 'a'] }, { tags: ['a', ' '] }]), [['a', 2], ['b', 1]]);

// bulkMutation
const base = { name: 'n', category: 'c1', tags: ['x', 'y'], pinned: false };
assert.deepStrictEqual(M.bulkMutation({ category: 'c2' })(base).category, 'c2');
assert.deepStrictEqual(M.bulkMutation({ tags: { mode: 'add', list: ['Y', 'z'] } })(base).tags, ['x', 'y', 'z']);
assert.deepStrictEqual(M.bulkMutation({ tags: { mode: 'remove', list: ['x'] } })(base).tags, ['y']);
assert.deepStrictEqual(M.bulkMutation({ tags: { mode: 'replace', list: ['q'] } })(base).tags, ['q']);
assert.strictEqual(M.bulkMutation({ pinned: true })(base).pinned, true);
assert.strictEqual(base.pinned, false, 'input is not mutated');
const withMode = M.bulkMutation({ checkMode: 'monitor' }, (b, mode) => { b.mode = mode; })(base);
assert.strictEqual(withMode.mode, 'monitor');
assert.deepStrictEqual(M.bulkMutation({})(base), base);

// rangeKeys
assert.deepStrictEqual(M.rangeKeys(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
assert.deepStrictEqual(M.rangeKeys(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd']);
assert.deepStrictEqual(M.rangeKeys(['a', 'b'], 'zz', 'b'), ['b']);

console.log('bookmark-workbench-model: ok');
```

Add to `package.json` `scripts`, after `test:news-stream`:

```json
    "test:workbench-model": "node tests/bookmark-workbench-model.test.cjs"
```

(add a comma to the preceding line).

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/bookmark-workbench-model.test.cjs`
Expected: FAIL — `ENOENT ... bookmark-workbench-model.js`.

- [ ] **Step 3: Write the implementation**

Create `static/js/shared/bookmark-workbench-model.js`:

```js
/**
 * The bookmarks workbench, minus the page.
 *
 * Everything here is arithmetic over plain bookmark objects: which health
 * state a row is in, how many rows each filter would leave, where the group
 * headers go, which slice of a long list to draw, and what a bulk edit does to
 * one bookmark. Kept apart from the renderers so it can be tested without a
 * browser, and so the renderers stay about markup.
 */
(function (global) {
    'use strict';

    function healthState(bookmark, facts) {
        if (bookmark?.checkStatus !== true) return 'unchecked';
        if (facts?.monitor && Number(facts.downSince) > 0) return 'down';
        if (Number(facts?.brokenSince) > 0) return 'broken';
        return 'healthy';
    }

    function facetCounts(list, facets) {
        const names = Object.keys(facets);
        const out = {};
        names.forEach((n) => { out[n] = new Map(); });
        (list || []).forEach((b) => {
            const pass = names.map((n) => Boolean(facets[n].test(b)));
            const failing = pass.filter((p) => !p).length;
            names.forEach((n, i) => {
                // Counted when every other facet passes: either nothing fails,
                // or the only failure is this facet's own filter.
                if (failing > 1 || (failing === 1 && pass[i])) return;
                const seen = new Set();
                (facets[n].keys(b) || []).forEach((k) => {
                    const key = String(k);
                    if (!key.trim() || seen.has(key)) return;
                    seen.add(key);
                    out[n].set(key, (out[n].get(key) || 0) + 1);
                });
            });
        });
        return out;
    }

    function buildItems(rows, opts = {}) {
        const items = [];
        const list = rows || [];
        if (!opts.grouped) {
            list.forEach((bookmark, index) => items.push({
                type: 'row', bookmark, index,
                groupStart: index === 0,
                groupEnd: index === list.length - 1,
            }));
            return items;
        }
        let i = 0;
        while (i < list.length) {
            const key = String(opts.groupKey(list[i]));
            let j = i;
            while (j < list.length && String(opts.groupKey(list[j])) === key) j += 1;
            items.push({ type: 'head', key, label: String(opts.groupLabel(list[i])), count: j - i });
            for (let k = i; k < j; k += 1) {
                items.push({ type: 'row', bookmark: list[k], index: k, groupStart: k === i, groupEnd: k === j - 1 });
            }
            i = j;
        }
        return items;
    }

    function itemOffset(items, itemIndex, rowHeight, headHeight) {
        let px = 0;
        const end = Math.min(itemIndex, items.length);
        for (let i = 0; i < end; i += 1) px += items[i].type === 'head' ? headHeight : rowHeight;
        return px;
    }

    function itemWindow(items, opts) {
        const { scrollTop, viewport, rowHeight, headHeight } = opts;
        const overscan = opts.overscan ?? 20;
        const minItems = opts.minItems ?? 120;
        if (!items || items.length <= minItems) return null;
        const top = Math.max(0, scrollTop);
        let px = 0;
        let first = items.length - 1;
        for (let i = 0; i < items.length; i += 1) {
            const h = items[i].type === 'head' ? headHeight : rowHeight;
            if (px + h > top) { first = i; break; }
            px += h;
        }
        let last = first;
        let seen = 0;
        while (last < items.length && seen < viewport) {
            seen += items[last].type === 'head' ? headHeight : rowHeight;
            last += 1;
        }
        const start = Math.max(0, first - overscan);
        const end = Math.min(items.length, last + overscan);
        if (start === 0 && end >= items.length) return null;
        const above = itemOffset(items, start, rowHeight, headHeight);
        const total = itemOffset(items, items.length, rowHeight, headHeight);
        const below = total - itemOffset(items, end, rowHeight, headHeight);
        return { start, end, above, below };
    }

    function sharedValue(values) {
        const list = values || [];
        if (!list.length) return { mixed: false, value: null };
        const first = list[0];
        const same = list.every((v) => v === first);
        return same ? { mixed: false, value: first } : { mixed: true, value: null };
    }

    function tagCounts(bookmarks) {
        const counts = new Map();
        (bookmarks || []).forEach((b) => {
            new Set((b.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))
                .forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
        });
        return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    }

    function bulkMutation(changes, assignCheckMode) {
        const c = changes || {};
        return (bookmark) => {
            const next = { ...bookmark };
            if (typeof c.category === 'string') next.category = c.category;
            if (c.tags && Array.isArray(c.tags.list)) {
                const wanted = c.tags.list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
                const current = (Array.isArray(next.tags) ? next.tags : []).map((t) => String(t).toLowerCase());
                if (c.tags.mode === 'replace') next.tags = [...new Set(wanted)];
                else if (c.tags.mode === 'remove') next.tags = current.filter((t) => !wanted.includes(t));
                else next.tags = [...new Set([...current, ...wanted])];
            }
            if (typeof c.pinned === 'boolean') next.pinned = c.pinned;
            if (typeof c.checkMode === 'string' && typeof assignCheckMode === 'function') {
                assignCheckMode(next, c.checkMode);
            }
            return next;
        };
    }

    function rangeKeys(keys, anchor, focus) {
        const a = keys.indexOf(anchor);
        const f = keys.indexOf(focus);
        if (f < 0) return [];
        if (a < 0) return [focus];
        const [from, to] = a <= f ? [a, f] : [f, a];
        return keys.slice(from, to + 1);
    }

    global.BookmarkWorkbenchModel = {
        healthState, facetCounts, buildItems, itemWindow, itemOffset,
        sharedValue, tagCounts, bulkMutation, rangeKeys,
    };
}(typeof window !== 'undefined' ? window : globalThis));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:workbench-model`
Expected: `bookmark-workbench-model: ok`

- [ ] **Step 5: Falsify once**

Change `if (failing > 1 || (failing === 1 && pass[i])) return;` to `if (failing > 0) return;`, run the test, confirm the `page 2 under tag a` assertion fails, restore the line, run again: ok.

- [ ] **Step 6: Commit**

```bash
go run scripts/gen-asset-hashes.go
git add static/js/shared/bookmark-workbench-model.js tests/bookmark-workbench-model.test.cjs package.json internal/app/asset_hashes_gen.go CHANGELOG.md
git commit -m "add the bookmarks workbench model"
```

---
### Task 2: Workbench scaffold and loader

The List tab gets its three-part layout. The rail holds only the search field; the old toolbar, quick bar, tag cloud, chips, banner and bulk bar move unchanged into the list column, so every existing spec stays green. They are removed in Tasks 3 and 7.

**Files:**
- Create: `static/js/dashboard/dashboard-config-bookmarks-workbench.js`
- Create: `static/css/config-bookmarks-workbench.css`
- Modify: `static/js/dashboard/dashboard-config.js` — `ensureBookmarkRenderers` (≈21328), `renderBookmarksListTab` (≈21344), `bindBookmarksListTab` (≈22785)
- Modify: `internal/app/asset_hash.go:155` (`lazyLoadedAssets`)
- Modify: `templates/dashboard.html:119` (views CSS bundle)
- Modify: `locales/en.json`
- Test: `tests/config-bookmarks-rail.spec.js` (create)

**Interfaces:**
- Consumes: `window.BookmarkWorkbenchModel` (Task 1).
- Produces:
  - `window.DashboardConfigWorkbenchReady === true` once loaded.
  - `DashboardConfig.prototype.renderBookmarksWorkbench() → string` — root `#config-bm-workbench.config-bm-workbench` with children `#config-bm-rail`, `.config-bm-main`, `#config-bm-panel`.
  - `renderWorkbenchRail() → string`, `renderWorkbenchPanel() → string`, `bindWorkbench(container) → void`, `bmPanelCollapsed() → boolean`.
  - `DashboardConfig.prototype.renderLegacyBookmarkControls() → string` (temporary, removed in Task 3/7).
  - `DashboardConfig.prototype.bookmarkSortOptionsHtml() → string`.

- [ ] **Step 1: Write the failing test**

Create `tests/config-bookmarks-rail.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, markConfigSettingPromosSeen } = require('./e2e-helpers');

/*
 * The bookmark list as a workbench: filters down the left, rows in the
 * middle, the bookmark (or the selection) on the right.
 */

async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await markConfigSettingPromosSeen(page);
    await page.keyboard.press('Shift+Comma');
    await page.waitForSelector('[data-config-section="bookmarks"]', { timeout: 15_000 });
    await page.click('[data-config-section="bookmarks"]');
    await page.waitForSelector('#config-bm-workbench #config-bm-list .config-bm-row', { timeout: 15_000 });
}

test.describe('the bookmarks workbench', () => {
    test('is laid out as rail, list and panel', async ({ page }) => {
        await openBookmarks(page);
        const rail = page.locator('#config-bm-rail');
        const main = page.locator('#config-bm-workbench .config-bm-main');
        const panel = page.locator('#config-bm-panel');
        await expect(rail).toBeVisible();
        await expect(panel).toBeVisible();
        await expect(rail.locator('#config-bm-search')).toBeVisible();

        const [r, m, p] = await Promise.all([rail, main, panel].map((l) => l.boundingBox()));
        expect(r && m && p, 'all three parts have a box').toBeTruthy();
        expect(r.x + r.width).toBeLessThanOrEqual(m.x + 1);
        expect(m.x + m.width).toBeLessThanOrEqual(p.x + 1);
    });
});

module.exports = { openBookmarks };
```

Note: `Shift+Comma` is `<`, the documented key that opens config (cheat sheet `navOpenConfig`). If the section nav selector differs, read `renderConfigShell` in `dashboard-config.js` and use the attribute it renders; `syncSectionNav` reads `[data-config-section]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-rail.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt`
Expected: FAIL — timeout waiting for `#config-bm-workbench`.

- [ ] **Step 3: Register the new scripts**

In `internal/app/asset_hash.go`, inside `lazyLoadedAssets`, after `"js/dashboard/dashboard-config-bookmarks.js",` add:

```go
	"js/dashboard/dashboard-config-bookmarks-workbench.js",
	"js/shared/bookmark-workbench-model.js",
```

In `templates/dashboard.html`, inside `<!-- bundle:css-views -->`, after the `config-view.css` link:

```html
    <link rel="stylesheet" href="{{asset "css/config-bookmarks-workbench.css"}}">
```

- [ ] **Step 4: Load all three files in `ensureBookmarkRenderers`**

Replace the body of `ensureBookmarkRenderers()` in `dashboard-config.js` with:

```js
    ensureBookmarkRenderers() {
        const ready = () => window.DashboardConfigBookmarksReady === true
            && window.DashboardConfigWorkbenchReady === true
            && Boolean(window.BookmarkWorkbenchModel);
        if (ready()) return Promise.resolve(true);
        if (this._bookmarkRenderersPromise) return this._bookmarkRenderersPromise;
        const load = window.LazyScript.loadScriptOnce;
        // In order: the workbench builds on both of the others.
        this._bookmarkRenderersPromise = load('js/shared/bookmark-workbench-model.js',
            'bookmarkWorkbenchModel', () => Boolean(window.BookmarkWorkbenchModel))
            .then(() => load('js/dashboard/dashboard-config-bookmarks.js',
                'dashboardConfigBookmarks', () => window.DashboardConfigBookmarksReady === true))
            .then(() => load('js/dashboard/dashboard-config-bookmarks-workbench.js',
                'dashboardConfigWorkbench', () => window.DashboardConfigWorkbenchReady === true))
            .then(() => {
                const waiting = this._bookmarksAwaitingRenderers === true;
                this._bookmarksAwaitingRenderers = false;
                if (waiting && this.isActiveView() && this.section === 'bookmarks') this.render();
                return true;
            }).catch(() => false);
        return this._bookmarkRenderersPromise;
    }
```

Update its doc comment's first line to "Load the bookmark list renderers and the workbench, once."

- [ ] **Step 5: Split `renderBookmarksListTab`**

Replace `renderBookmarksListTab()` with the three methods below. `renderLegacyBookmarkControls` is the old template's toolbar-to-bulk block moved verbatim, minus the search input (it moves to the rail) and minus the tiles.

```js
    bookmarkSortOptionsHtml() {
        const esc = (v) => this.dash.escapeHtml(v);
        return [
            ['page', this.t('config.sortByPage', 'Page order')],
            ['name', this.t('config.sortByName', 'Name (A–Z)')],
            ['url', this.t('config.sortByUrl', 'URL')],
            ['category', this.t('config.sortByCategory', 'Category')],
            ['recent', this.t('config.sortByRecent', 'Recently added')],
            ['lastOpened', this.t('config.sortByLastOpened', 'Last opened')],
            ['opens', this.t('config.sortByOpens', 'Most opened')],
            ['pinned', this.t('config.sortByPinned', 'Pinned first')],
        ].map(([v, label]) =>
            `<option value="${esc(v)}" ${this.bmSort === v ? 'selected' : ''}>${esc(label)}</option>`
        ).join('');
    }

    renderBookmarksListTab() {
        // Bookmarks are edited in place all over the app, and none of that
        // moves the array identity the memo keys on, so a paint starts fresh.
        this.invalidateVisibleBookmarks();
        if (this.bmSort == null) this.bmSort = this.defaultBookmarksSort();
        void this.ensureBookmarkRenderers();
        if (typeof this.renderBookmarksWorkbench !== 'function') {
            this._bookmarksAwaitingRenderers = true;
            return `<div class="config-panel"><div id="config-bm-list">${this.renderBookmarksListSafe()}</div></div>`;
        }
        return this.renderBookmarksWorkbench();
    }

    /** The pre-workbench controls, kept in the list column until the rail and panel replace them. */
    renderLegacyBookmarkControls() {
        const esc = (v) => this.dash.escapeHtml(v);
        const pages = this.dash.pages || [];
        const pageOptions = [`<option value="">${esc(this.t('config.allPages', 'All pages'))}</option>`]
            .concat(pages.map((p) => {
                const sel = String(this.bmPageFilter || '') === String(p.id) ? ' selected' : '';
                return `<option value="${esc(p.id)}"${sel}>${esc(p.name || p.id)}</option>`;
            })).join('');
        const catOptions = [`<option value="">${esc(this.t('config.allCategories', 'All categories'))}</option>`]
            .concat(this.knownCategories().map((c) => {
                const sel = this.bmCategoryFilter === c.id ? ' selected' : '';
                return `<option value="${esc(c.id)}"${sel}>${esc(c.label)}</option>`;
            })).join('');
        return `
            <div class="config-crud-toolbar config-crud-toolbar--view">
                <select class="config-select" id="config-bm-page" aria-label="${esc(this.t('config.page', 'Page'))}"
                        data-config-setting-promo-anchor="bookmarksPageFilter">${pageOptions}</select>
                <select class="config-select" id="config-bm-category" aria-label="${esc(this.t('config.category', 'Category'))}">${catOptions}</select>
                <button type="button" class="config-btn config-btn--small" id="config-bm-select-all">${esc(this.selectAllBookmarksLabel())}</button>
            </div>
            ${this.renderBookmarkQuickBarSafe()}
            ${this.renderBookmarkTagCloudSafe()}
            <div class="config-bm-list-meta">
                <div class="config-bm-filter-chips" id="config-bm-filter-chips">${this.renderBookmarkFilterChipsSafe()}</div>
            </div>
            ${this.renderCleanupFilterBannerSafe()}
            <div id="config-bm-bulk">${this.renderBulkToolbarSafe()}</div>`;
    }
```

The tiles (`#config-bm-tiles`, `#config-bm-tiles-hint`) are gone from this tab now; `updateBookmarkListChrome` already skips missing hosts. `bookmarksSummaryTiles` stays — Overview and Statistics still call it.

- [ ] **Step 6: Write the workbench module**

Create `static/js/dashboard/dashboard-config-bookmarks-workbench.js`:

```js
/**
 * Config → Bookmarks → List as a workbench.
 *
 * Three parts with one job each: the rail narrows the list, the list shows
 * what is left, the panel shows — and edits — the bookmark in focus, or the
 * selection when there is one. Every filter, sort and write still lives on
 * DashboardConfig; this file draws and wires.
 *
 * Loaded after dashboard-config-bookmarks.js and the workbench model, by
 * ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const PANEL_KEY = 'nextdash.bmPanelCollapsed';

    Object.assign(global.DashboardConfig.prototype, {

    bmPanelCollapsed() {
        if (this._bmPanelTempOpen) return false;
        try {
            return global.localStorage?.getItem(PANEL_KEY) === '1';
        } catch {
            return false;
        }
    },

    renderBookmarksWorkbench() {
        const esc = (v) => this.dash.escapeHtml(v);
        const filtered = this.visibleBookmarks();
        const total = (this.dash.allBookmarks || []).length;
        const countLabel = this.renderBookmarkCountLabelSafe(filtered.length, total);
        const collapsed = this.bmPanelCollapsed();
        return `
            <div class="config-bm-workbench${collapsed ? ' is-panel-collapsed' : ''}" id="config-bm-workbench">
                <aside class="config-bm-rail" id="config-bm-rail"
                       aria-label="${esc(this.t('config.bmFilters', 'Filters'))}">${this.renderWorkbenchRail()}</aside>
                <section class="config-bm-main" aria-label="${esc(this.t('config.bookmarks', 'Bookmarks'))}">
                    <div class="config-bm-toolbar">
                        <span class="config-bm-count" id="config-bm-count">${esc(countLabel)}</span>
                        <span class="config-sr-only" id="config-bm-count-live" aria-live="polite" aria-atomic="true">${esc(countLabel)}</span>
                        <span class="config-bm-toolbar-spacer"></span>
                        <label class="config-bm-sort">
                            <span>${esc(this.t('config.sortLabel', 'Sort'))}</span>
                            <select class="config-select" id="config-bm-sort">${this.bookmarkSortOptionsHtml()}</select>
                        </label>
                        <button type="button" class="config-btn config-btn--primary config-btn--small" id="config-bm-add">${esc(this.t('config.addBookmark', 'Add bookmark'))}</button>
                    </div>
                    ${this.renderLegacyBookmarkControls()}
                    <div id="config-bm-list">${this.renderBookmarksListSafe()}</div>
                </section>
                <aside class="config-bm-panel" id="config-bm-panel" role="region"
                       aria-label="${esc(this.t('config.bmDetails', 'Details'))}">${this.renderWorkbenchPanel()}</aside>
            </div>`;
    },

    renderWorkbenchRail() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-bm-rail-search">
                <input type="search" class="config-text" id="config-bm-search"
                       placeholder="${esc(this.t('config.searchBookmarks', 'Search bookmarks…'))}"
                       value="${esc(this.bmQuery || '')}">
                <kbd aria-hidden="true">/</kbd>
            </div>`;
    },

    renderWorkbenchPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `<p class="config-bm-panel-empty">${esc(this.t('config.bmPanelEmpty', 'Select a bookmark to see it here.'))}</p>`;
    },

    bindWorkbench() {},
    });

    global.DashboardConfigWorkbenchReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
```

In `bindBookmarksListTab`, add as its last line:

```js
        this.bindWorkbench?.(container);
```

Add strings:

```bash
# the File Map locale helper, with:
node -e "$LOCALE_HELPER" '{"bmFilters":"Filters","bmDetails":"Details","bmPanelEmpty":"Select a bookmark to see it here."}'
```

- [ ] **Step 7: Write the skeleton stylesheet**

Create `static/css/config-bookmarks-workbench.css`:

```css
/*
 * Config → Bookmarks → List as a workbench: rail · list · panel.
 *
 * Colours come from the theme; the slabs use the surface ladder and the
 * theme's edges the way the view headers do, and stay flat on flat depth.
 * No backdrop-filter anywhere here: these surfaces take clicks, and blur on a
 * clickable layer is what breaks hit-testing in Safari.
 */

.config-bm-workbench {
    --bm-rail-w: 200px;
    --bm-panel-w: 260px;
    --bm-row-h: 44px;
    --bm-head-h: 32px;
    --bm-slab-bg: var(--surface-2, var(--background-secondary));
    --bm-slab-radius: var(--radius-5, 8px);
    display: grid;
    grid-template-columns: var(--bm-rail-w) minmax(0, 1fr) var(--bm-panel-w);
    gap: var(--space-4, 1rem);
    align-items: start;
}

.config-bm-workbench.is-panel-collapsed {
    grid-template-columns: var(--bm-rail-w) minmax(0, 1fr) 28px;
}

.config-bm-rail,
.config-bm-panel {
    position: sticky;
    top: var(--space-4, 1rem);
    max-height: calc(100vh - 2 * var(--space-4, 1rem));
    overflow: auto;
}

.config-bm-main {
    min-width: 0;
}

.config-bm-rail-search {
    position: relative;
}

.config-bm-rail-search input {
    width: 100%;
    box-sizing: border-box;
    padding-right: 2rem;
}

.config-bm-rail-search kbd {
    position: absolute;
    right: var(--space-2, 0.5rem);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
}

.config-bm-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3, 0.75rem);
    margin-bottom: var(--space-3, 0.75rem);
}

.config-bm-toolbar-spacer {
    flex: 1;
}

.config-bm-sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    color: var(--text-secondary);
    font-size: var(--font-size-controls);
}

.config-bm-panel {
    background: var(--surface-3, var(--background-secondary));
    border-radius: var(--bm-slab-radius);
    padding: var(--space-4, 1rem);
}

html[data-theme] body:not([data-depth="flat"]) .config-bm-panel {
    box-shadow: var(--edge-light), var(--edge-dark), var(--surface-cast);
}

.config-bm-panel-empty {
    color: var(--text-secondary);
    margin: 0;
}
```

- [ ] **Step 8: Regenerate hashes and run the tests**

```bash
go run scripts/gen-asset-hashes.go
go test ./internal/app/ -run 'Asset' > /tmp/go.txt 2>&1; echo "exit $?"; tail -5 /tmp/go.txt
PW_WORKERS=2 npx playwright test tests/config-bookmarks-rail.spec.js tests/config-bookmarks-filters.spec.js tests/config-bookmarks-lazy.spec.js tests/config-bookmarks-tabs.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt
```

Expected: go exit 0; Playwright exit 0. If a filters/tabs test fails on `#config-bm-tiles` or a tile selector, delete that assertion — the tiles leave this tab by decision (spec, Decisions table).

- [ ] **Step 9: Falsify**

Swap `grid-template-columns` to `1fr` (stacked), run the rail spec, see "is laid out as rail, list and panel" fail, restore, regenerate hashes.

- [ ] **Step 10: Commit**

```bash
git add static/js/dashboard/dashboard-config-bookmarks-workbench.js static/css/config-bookmarks-workbench.css static/js/dashboard/dashboard-config.js internal/app/asset_hash.go internal/app/asset_hashes_gen.go templates/dashboard.html locales/en.json tests/config-bookmarks-rail.spec.js tests/config-bookmarks-filters.spec.js tests/config-bookmarks-tabs.spec.js CHANGELOG.md
git commit -m "lay the bookmark list out as rail, list and panel"
```

---
### Task 3: Filter rail with live counts

The rail takes over every filter: views (cleanup filters), pages, categories, tags and the new health filter, each entry with a count. The legacy page/category selects, quick bar, tag cloud, chips and cleanup banner are deleted.

**Files:**
- Modify: `static/js/dashboard/dashboard-config.js` — constructor state (≈146), `bookmarksFilterQuery` / `applyBookmarksFiltersFromHash` (≈498–546), `bookmarksFiltersActive` (≈20178), `updateBookmarkListChrome` (≈20271), `clearBookmarkFilterChip` (≈20310), `visibleBookmarks` / `computeVisibleBookmarks` (≈21801–21880), `clearBookmarkFilters` (≈22860), `bindBookmarksListTab`, `renderLegacyBookmarkControls`
- Modify: `static/js/dashboard/dashboard-config-bookmarks.js` — `bookmarksEmptyReason`; delete `renderBookmarkFilterChips`, `renderBookmarkQuickBar`, `renderBookmarkTagCloud`, `renderCleanupFilterBanner`
- Modify: `static/js/dashboard/dashboard-config-bookmarks-workbench.js`
- Modify: `static/css/config-bookmarks-workbench.css`
- Modify: `locales/en.json`
- Test: `tests/config-bookmarks-rail.spec.js`; adapt `tests/config-bookmarks-filters.spec.js`, `tests/config-stats-cleanup.spec.js`, `tests/config-tag-suggestions.spec.js`, `tests/config-new-sections.spec.js`, `tests/config-view-tools.spec.js`, `tests/config-dashboard-category-sync.spec.js`

**Interfaces:**
- Consumes: `BookmarkWorkbenchModel.healthState`, `.facetCounts` (Task 1); `renderWorkbenchRail`, `#config-bm-rail` (Task 2).
- Produces:
  - `this.bmHealthFilter: '' | 'healthy' | 'broken' | 'down' | 'unchecked'`, hash key `health`.
  - `DashboardConfig.HEALTH_FILTERS = ['healthy', 'broken', 'down', 'unchecked']`.
  - `bookmarkHealthState(b) → string`.
  - `bookmarkFilterTests() → { query, page, category, tag, cleanup, health }`, each `(b) → boolean`.
  - `bookmarkFacetCounts() → { view, page, category, tag, health }` (Maps).
  - `toggleRailFilter(kind, value) → void`, kinds `page | category | tag | cleanup | health`.
  - `repaintWorkbenchRail() → void` — replaces only `#config-bm-rail-facets`.
  - Rail markup: buttons `[data-bm-rail="<kind>"][data-value]` with `aria-pressed`, count in `.config-bm-rail-count`; tokens `[data-bm-rail-clear="<key>"]`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` in `tests/config-bookmarks-rail.spec.js`:

```js
    test('a page in the rail filters the list, and the other pages keep their counts', async ({ page }) => {
        await openBookmarks(page);
        const pages = page.locator('#config-bm-rail [data-bm-rail="page"]');
        expect(await pages.count(), 'the fixture has at least two pages').toBeGreaterThan(1);

        const second = pages.nth(1);
        const pageId = await second.getAttribute('data-value');
        const expected = Number(await second.locator('.config-bm-rail-count').innerText());
        const otherBefore = await pages.nth(0).locator('.config-bm-rail-count').innerText();

        await second.click();
        await expect(second).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.visibleBookmarks().length)).toBe(expected);
        const pageIds = await page.evaluate(() => [...new Set(
            window.dashboardInstance.config.visibleBookmarks().map((b) => String(b.pageId)))]);
        expect(pageIds).toEqual([pageId]);
        // Its own filter does not shrink the other entries.
        await expect(pages.nth(0).locator('.config-bm-rail-count')).toHaveText(otherBefore);

        // A token names it, and clears it.
        await page.click(`#config-bm-rail [data-bm-rail-clear="page"]`);
        await expect(second).toHaveAttribute('aria-pressed', 'false');
    });

    test('a view in the rail is the cleanup filter, and survives a reload', async ({ page }) => {
        await openBookmarks(page);
        await page.click('#config-bm-rail [data-bm-rail="cleanup"][data-value="untagged"]');
        await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('filter=untagged');
        const rows = await page.evaluate(() => window.dashboardInstance.config.visibleBookmarks()
            .every((b) => !(b.tags || []).some((t) => String(t).trim())));
        expect(rows).toBe(true);
        await page.reload();
        await page.waitForSelector('#config-bm-rail [data-bm-rail="cleanup"][data-value="untagged"][aria-pressed="true"]', { timeout: 15_000 });
    });

    test('two tags widen the list, and each is its own token', async ({ page }) => {
        await openBookmarks(page);
        const tags = page.locator('#config-bm-rail [data-bm-rail="tag"]');
        test.skip(await tags.count() < 2, 'fixture has fewer than two tags');
        const a = await tags.nth(0).getAttribute('data-value');
        const b = await tags.nth(1).getAttribute('data-value');
        await tags.nth(0).click();
        const one = await page.evaluate(() => window.dashboardInstance.config.visibleBookmarks().length);
        await page.locator(`#config-bm-rail [data-bm-rail="tag"][data-value="${b}"]`).click();
        const two = await page.evaluate(() => window.dashboardInstance.config.visibleBookmarks().length);
        expect(two).toBeGreaterThanOrEqual(one);
        await expect(page.locator(`[data-bm-rail-clear="tag:${a}"]`)).toBeVisible();
        await expect(page.locator(`[data-bm-rail-clear="tag:${b}"]`)).toBeVisible();
    });

    test('the health facet filters on what health knows', async ({ page }) => {
        await openBookmarks(page);
        // One known-broken, checked bookmark, as the health report would describe it.
        const url = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const b = c.dash.allBookmarks[0];
            b.checkStatus = true;
            window.HealthFacts.remember({ issues: [{ url: b.url, brokenSince: Date.now() - 1000 }] });
            c.repaintBookmarksList();
            return b.url;
        });
        const broken = page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]');
        await expect(broken.locator('.config-bm-rail-count')).toHaveText('1');
        await broken.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.visibleBookmarks().map((b) => b.url))).toEqual([url]);
        await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('health=broken');
    });

    test('a facet with nothing left is dimmed, not hidden', async ({ page }) => {
        await openBookmarks(page);
        await page.fill('#config-bm-search', 'zzzznothingmatches');
        const firstPage = page.locator('#config-bm-rail [data-bm-rail="page"]').first();
        await expect(firstPage).toHaveClass(/is-empty/);
        await expect(firstPage.locator('.config-bm-rail-count')).toHaveText('0');
    });
```

The health test writes `HealthFacts` directly because the fixture server has no broken bookmark to report. It still selects through the rail, which is the entry under test.

- [ ] **Step 2: Run to verify they fail**

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-rail.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt`
Expected: the four new tests FAIL (no `[data-bm-rail]`); the layout test passes.

- [ ] **Step 3: Health state and shared filter tests in `dashboard-config.js`**

Constructor, after `this.bmTagFilter = [];`:

```js
        this.bmHealthFilter = '';
```

Next to `static CLEANUP_FILTERS`:

```js
    static HEALTH_FILTERS = ['healthy', 'broken', 'down', 'unchecked'];

    /** Where this bookmark stands with the checker, from what the dashboard already knows. */
    bookmarkHealthState(b) {
        const model = window.BookmarkWorkbenchModel;
        if (!model) return b?.checkStatus === true ? 'healthy' : 'unchecked';
        return model.healthState(b, window.HealthFacts?.get?.(b?.url) || null);
    }

    /**
     * One predicate per filter, so the list and the rail's counts cannot
     * disagree about what a filter means.
     */
    bookmarkFilterTests() {
        const q = String(this.bmQuery || '').trim().toLowerCase();
        const pageFilter = String(this.bmPageFilter || '');
        const tagFilter = this.bookmarkTagFilters();
        const cleanupKey = this.bmCleanupFilter;
        const cleanup = DashboardConfig.CLEANUP_FILTERS[cleanupKey] || null;
        const dupes = cleanupKey === 'duplicate' ? this.ensureDuplicateUrlSet() : null;
        const { pageId: catPage, categoryId } = DashboardConfig.parseCategoryFilter(this.bmCategoryFilter || '');
        const health = this.bmHealthFilter;
        return {
            query: (b) => !q || [b.name, b.url, b.category, b.note, b.shortcut, (b.tags || []).join(' ')]
                .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
            page: (b) => !pageFilter || String(b.pageId) === pageFilter,
            category: (b) => {
                if (!categoryId) return true;
                if (catPage && String(b.pageId) !== String(catPage)) return false;
                return (b.category || '') === categoryId;
            },
            // OR, matching the dashboard tag cloud: a second tag widens.
            tag: (b) => !tagFilter.length || (Array.isArray(b.tags) ? b.tags : [])
                .map((t) => String(t).toLowerCase()).some((t) => tagFilter.includes(t)),
            cleanup: (b) => {
                if (!cleanup) return true;
                return cleanupKey === 'duplicate'
                    ? cleanup(b, dupes, (url) => this.canonicalStatsUrlKey(url))
                    : cleanup(b);
            },
            health: (b) => !health || this.bookmarkHealthState(b) === health,
        };
    }
```

Replace the filtering half of `computeVisibleBookmarks()` (from `const q = …` through the end of `all.filter(...)`) with:

```js
        const tests = Object.values(this.bookmarkFilterTests());
        const rows = all.filter((b) => tests.every((test) => test(b)));
```

Keep the sort half unchanged.

In `visibleBookmarks()`, add `this.bmHealthFilter` to the token array after `this.bmCleanupFilter`.

In `bookmarksFiltersActive()`, add `|| this.bmHealthFilter` inside the `!!(…)`.

In `bookmarksFilterQuery()`, after `add('filter', this.bmCleanupFilter);`:

```js
        add('health', this.bmHealthFilter);
```

In `applyBookmarksFiltersFromHash()`, add `this.bmHealthFilter` to both `before` and `after` arrays after `this.bmCleanupFilter`, and after the cleanup line:

```js
        const health = params.get('health') || '';
        this.bmHealthFilter = DashboardConfig.HEALTH_FILTERS.includes(health) ? health : '';
```

In `clearBookmarkFilters()`, add `this.bmHealthFilter = '';`.

In `clearBookmarkFilterChip(key)`, after the cleanup line:

```js
        if (key === 'all' || key === 'health') this.bmHealthFilter = '';
```

and delete the two `pageEl` / `catEl` lines (those selects are gone).

In `updateBookmarkListChrome()`, delete the tag-cloud, chips, select-all, tiles-hint and tiles blocks, and add at the end:

```js
        this.repaintWorkbenchRail?.();
```

In `bindBookmarksListTab()`, delete: the `[data-bm-sort-chip]` loop, the `[data-bm-changed-toggle]` listener, `bindBookmarkFilterChips(...)`, `bindBookmarkTagCloud(...)`, the `[data-cleanup-clear]` listener, the `#config-bm-page` listener, `wire('#config-bm-category', …)`, and the `#config-bm-select-all` listener. Keep search, sort, categories preload, add, list clicks, rows, bulk toolbar, keyboard and `bindWorkbench`.

Delete from `dashboard-config.js`: `bindBookmarkFilterChips`, `bindBookmarkTagCloud`, `updateBookmarkTagCloud`, `renderBookmarkTagCloudSafe`, `renderBookmarkFilterChipsSafe`, `renderBookmarkQuickBarSafe`, `renderCleanupFilterBannerSafe`, `repaintBookmarksFilters` (and its callers' lines — `grep -n "repaintBookmarksFilters\|TagCloudSafe\|FilterChipsSafe\|QuickBarSafe\|CleanupFilterBannerSafe" static/js/dashboard/*.js` must return nothing). Before deleting each, grep for other callers; a caller outside the List tab keeps the method.

In `renderLegacyBookmarkControls()`, remove everything except `<div id="config-bm-bulk">${this.renderBulkToolbarSafe()}</div>`.

In `dashboard-config-bookmarks.js`, delete `renderBookmarkFilterChips`, `renderBookmarkQuickBar`, `renderBookmarkTagCloud`, `renderCleanupFilterBanner`, and in `bookmarksEmptyReason()` add after the cleanup branch:

```js
        if (this.bmHealthFilter) {
            return this.t('config.bmEmptyHealth', 'No bookmark is in that state right now.');
        }
```

- [ ] **Step 4: Rail rendering and binding in the workbench module**

Replace `renderWorkbenchRail` and `bindWorkbench` in `dashboard-config-bookmarks-workbench.js`, and add the new methods:

```js
    renderWorkbenchRail() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-bm-rail-search">
                <input type="search" class="config-text" id="config-bm-search"
                       placeholder="${esc(this.t('config.searchBookmarks', 'Search bookmarks…'))}"
                       value="${esc(this.bmQuery || '')}">
                <kbd aria-hidden="true">/</kbd>
            </div>
            <div id="config-bm-rail-facets">${this.renderWorkbenchFacets()}</div>`;
    },

    bookmarkFacetCounts() {
        const all = this.dash.allBookmarks || [];
        const token = JSON.stringify([this._bmVisibleToken, all.length, global.HealthFacts?.updatedAt || 0]);
        if (this._bmFacetSource === all && this._bmFacetToken === token && this._bmFacets) return this._bmFacets;
        const tests = this.bookmarkFilterTests();
        const cleanupKeys = Object.keys(global.DashboardConfig.CLEANUP_FILTERS);
        const dupes = this.ensureDuplicateUrlSet();
        const matchesView = (b, key) => {
            const fn = global.DashboardConfig.CLEANUP_FILTERS[key];
            return key === 'duplicate' ? fn(b, dupes, (url) => this.canonicalStatsUrlKey(url)) : fn(b);
        };
        const counts = global.BookmarkWorkbenchModel.facetCounts(all, {
            query: { keys: () => [], test: tests.query },
            view: { keys: (b) => ['', ...cleanupKeys.filter((k) => matchesView(b, k))], test: tests.cleanup },
            page: { keys: (b) => [String(b.pageId)], test: tests.page },
            category: {
                keys: (b) => (b.category ? [global.DashboardConfig.categoryFilterKey(b.pageId, b.category)] : []),
                test: tests.category,
            },
            tag: { keys: (b) => (b.tags || []).map((t) => String(t).trim().toLowerCase()), test: tests.tag },
            health: { keys: (b) => [this.bookmarkHealthState(b)], test: tests.health },
        });
        this._bmFacetSource = all;
        this._bmFacetToken = token;
        this._bmFacets = counts;
        return counts;
    },

    railCategoryLabel(pageId, categoryId) {
        const hit = this.knownCategories(pageId).find((c) =>
            c.id === categoryId || c.id === global.DashboardConfig.categoryFilterKey(pageId, categoryId));
        return hit?.label || categoryId;
    },

    renderWorkbenchFacets() {
        const esc = (v) => this.dash.escapeHtml(v);
        const counts = this.bookmarkFacetCounts();
        const tags = this.bookmarkTagFilters();
        const entry = (kind, value, label, n, on, extra = '') => `
            <button type="button" class="config-bm-rail-item${on ? ' is-on' : ''}${n ? '' : ' is-empty'}"
                    data-bm-rail="${kind}" data-value="${esc(value)}" aria-pressed="${on ? 'true' : 'false'}">
                ${extra}<span class="config-bm-rail-label">${esc(label)}</span>
                <span class="config-bm-rail-count">${n}</span>
            </button>`;
        const group = (title, body, more = '') => (body ? `
            <section class="config-bm-rail-group">
                <h3 class="config-bm-rail-title"><span>${esc(title)}</span>${more}</h3>
                ${body}
            </section>` : '');

        // Tokens: what is on, each removable.
        const tokens = [];
        const token = (key, label) => tokens.push(
            `<button type="button" class="config-bm-rail-token" data-bm-rail-clear="${esc(key)}">${esc(label)}<span aria-hidden="true">×</span></button>`);
        if (this.bmCleanupFilter) token('cleanup', this.cleanupFilterLabel(this.bmCleanupFilter));
        if (this.bmPageFilter) token('page', this.pageLabel(this.bmPageFilter));
        if (this.bmCategoryFilter) {
            const { pageId, categoryId } = global.DashboardConfig.parseCategoryFilter(this.bmCategoryFilter);
            token('category', this.railCategoryLabel(pageId || this.bmPageFilter, categoryId));
        }
        tags.forEach((t) => token(`tag:${t}`, `#${t}`));
        if (this.bmHealthFilter) token('health', this.railHealthLabel(this.bmHealthFilter));
        const tokenRow = tokens.length ? `
            <div class="config-bm-rail-tokens">${tokens.join('')}
                <button type="button" class="config-bm-rail-clear-all" data-bm-rail-clear="all">${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>
            </div>` : '';

        const VIEWS_SHOWN = 5;
        const viewKeys = ['', ...Object.keys(global.DashboardConfig.CLEANUP_FILTERS)];
        const viewsOpen = this._bmRailViewsOpen === true;
        const views = viewKeys
            .filter((k, i) => viewsOpen || i < VIEWS_SHOWN || k === this.bmCleanupFilter)
            .map((k) => entry('cleanup', k,
                k ? this.cleanupFilterLabel(k) : this.t('config.bmViewAll', 'All'),
                counts.view.get(k) || 0, (this.bmCleanupFilter || '') === k))
            .join('');
        const viewsMore = viewKeys.length > VIEWS_SHOWN
            ? `<button type="button" class="config-bm-rail-more" data-bm-rail-more="views">${esc(viewsOpen
                ? this.t('config.bmShowFewer', 'fewer')
                : this.t('config.bmShowMore', '+{n} more').replace('{n}', String(viewKeys.length - VIEWS_SHOWN)))}</button>`
            : '';

        const pages = (this.dash.pages || [])
            .map((p) => entry('page', String(p.id), p.name || String(p.id),
                counts.page.get(String(p.id)) || 0, String(this.bmPageFilter || '') === String(p.id)))
            .join('');

        const categories = [...counts.category.entries()]
            .filter(([key]) => {
                const { pageId } = global.DashboardConfig.parseCategoryFilter(key);
                return !this.bmPageFilter || String(pageId) === String(this.bmPageFilter);
            })
            .sort((a, b) => b[1] - a[1])
            .map(([key, n]) => {
                const { pageId, categoryId } = global.DashboardConfig.parseCategoryFilter(key);
                const label = this.bmPageFilter
                    ? this.railCategoryLabel(pageId, categoryId)
                    : `${this.pageLabel(pageId)} › ${this.railCategoryLabel(pageId, categoryId)}`;
                return entry('category', key, label, n, this.bmCategoryFilter === key
                    || (this.bmCategoryFilter === categoryId && String(this.bmPageFilter) === String(pageId)));
            })
            .join('');

        const TAGS_SHOWN = 12;
        const tagsOpen = this._bmRailTagsOpen === true;
        const allTags = global.BookmarkWorkbenchModel.tagCounts(this.dash.allBookmarks || []).map(([t]) => t);
        const shownTags = allTags.filter((t, i) => tagsOpen || i < TAGS_SHOWN || tags.includes(t));
        const tagList = shownTags
            .map((t) => entry('tag', t, `#${t}`, counts.tag.get(t) || 0, tags.includes(t)))
            .join('');
        const tagsMore = allTags.length > TAGS_SHOWN
            ? `<button type="button" class="config-bm-rail-more" data-bm-rail-more="tags">${esc(tagsOpen
                ? this.t('config.bmShowFewer', 'fewer')
                : this.t('config.bmAllTags', 'all'))}</button>`
            : '';

        const anyChecked = (this.dash.allBookmarks || []).some((b) => b.checkStatus === true);
        const health = anyChecked
            ? global.DashboardConfig.HEALTH_FILTERS
                .map((k) => entry('health', k, this.railHealthLabel(k), counts.health.get(k) || 0,
                    this.bmHealthFilter === k, `<span class="config-bm-health-dot is-${k}" aria-hidden="true"></span>`))
                .join('')
            : '';

        return `
            ${tokenRow}
            ${group(this.t('config.bmViews', 'Views'), views, viewsMore)}
            ${group(this.t('config.bmPages', 'Pages'), pages)}
            ${group(this.t('config.bmCategories', 'Categories'), categories)}
            ${group(this.t('config.bmTags', 'Tags'), tagList, tagsMore)}
            ${group(this.t('config.bmHealth', 'Health'), health)}`;
    },

    railHealthLabel(key) {
        return {
            healthy: this.t('config.bmHealthHealthy', 'Healthy'),
            broken: this.t('config.bmHealthBroken', 'Broken'),
            down: this.t('config.bmHealthDown', 'Monitor down'),
            unchecked: this.t('config.bmHealthUnchecked', 'Never checked'),
        }[key] || key;
    },

    repaintWorkbenchRail() {
        const host = document.getElementById('config-bm-rail-facets');
        if (host) host.innerHTML = this.renderWorkbenchFacets();
    },

    toggleRailFilter(kind, value) {
        if (kind === 'page') {
            this.bmPageFilter = String(this.bmPageFilter || '') === value ? '' : value;
            this.resetBookmarkVisibleLimit();
            void this.onBookmarksPageFilterChange();
            return;
        }
        if (kind === 'category') this.bmCategoryFilter = this.bmCategoryFilter === value ? '' : value;
        if (kind === 'cleanup') this.bmCleanupFilter = this.bmCleanupFilter === value ? '' : value;
        if (kind === 'health') this.bmHealthFilter = this.bmHealthFilter === value ? '' : value;
        if (kind === 'tag') {
            const current = this.bookmarkTagFilters();
            this.bmTagFilter = current.includes(value)
                ? current.filter((t) => t !== value)
                : [...current, value];
        }
        this.resetBookmarkVisibleLimit();
        this._bmDuplicateUrls = null;
        this.repaintBookmarksList();
        this.restoreConfigHash();
        this.updateConfigShellHead();
    },

    bindWorkbenchRail(rail) {
        if (!rail || rail.dataset.bmRailWired === '1') return;
        rail.dataset.bmRailWired = '1';
        rail.addEventListener('click', (e) => {
            const more = e.target.closest('[data-bm-rail-more]');
            if (more) {
                const which = more.getAttribute('data-bm-rail-more');
                if (which === 'tags') this._bmRailTagsOpen = !this._bmRailTagsOpen;
                if (which === 'views') this._bmRailViewsOpen = !this._bmRailViewsOpen;
                this.repaintWorkbenchRail();
                return;
            }
            const clear = e.target.closest('[data-bm-rail-clear]');
            if (clear) {
                this.clearBookmarkFilterChip(clear.getAttribute('data-bm-rail-clear'));
                return;
            }
            const item = e.target.closest('[data-bm-rail]');
            if (item) this.toggleRailFilter(item.getAttribute('data-bm-rail'), item.getAttribute('data-value') || '');
        });
    },

    bindWorkbench(container) {
        this.bindWorkbenchRail(container.querySelector('#config-bm-rail'));
    },
```

`toggleRailFilter('cleanup', '')` on *All* with nothing active leaves it at `''` — correct: All is on when no view is.

Add strings:

```bash
# the File Map locale helper, with:
node -e "$LOCALE_HELPER" '{"bmViews":"Views","bmViewAll":"All","bmPages":"Pages","bmCategories":"Categories","bmTags":"Tags","bmHealth":"Health","bmHealthHealthy":"Healthy","bmHealthBroken":"Broken","bmHealthDown":"Monitor down","bmHealthUnchecked":"Never checked","bmShowMore":"+{n} more","bmShowFewer":"fewer","bmAllTags":"all","bmEmptyHealth":"No bookmark is in that state right now."}'
```

- [ ] **Step 5: Rail styling**

Append to `static/css/config-bookmarks-workbench.css`:

```css
/* ── Rail ─────────────────────────────────────────────────────────────── */

.config-bm-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
}

.config-bm-rail-tokens {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 0.25rem);
    align-items: center;
    margin-top: var(--space-2, 0.5rem);
}

.config-bm-rail-token {
    display: inline-flex;
    gap: 0.3em;
    align-items: center;
    border: 0;
    border-radius: var(--radius-3, 4px);
    padding: 1px 6px;
    font: inherit;
    font-size: var(--font-size-small);
    font-family: var(--font-family-mono, ui-monospace, monospace);
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    cursor: pointer;
}

.config-bm-rail-clear-all,
.config-bm-rail-more {
    margin-left: auto;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--font-size-small);
    cursor: pointer;
}

.config-bm-rail-group {
    background: var(--bm-slab-bg);
    border-radius: var(--bm-slab-radius);
    padding: var(--space-1, 0.25rem) var(--space-2, 0.5rem) var(--space-2, 0.5rem);
}

html[data-theme] body:not([data-depth="flat"]) .config-bm-rail-group {
    box-shadow: var(--edge-light), var(--edge-dark), var(--surface-cast);
}

.config-bm-rail-title {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: var(--space-1, 0.25rem) 0;
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
}

.config-bm-rail-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    width: 100%;
    border: 0;
    border-radius: var(--radius-3, 4px);
    padding: 2px var(--space-1, 0.25rem);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-controls);
    text-align: left;
    cursor: pointer;
}

.config-bm-rail-item:hover,
.config-bm-rail-item:focus-visible {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
}

.config-bm-rail-item.is-on {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
}

.config-bm-rail-item.is-empty:not(.is-on) {
    opacity: 0.45;
}

.config-bm-rail-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.config-bm-rail-count {
    font-family: var(--font-family-mono, ui-monospace, monospace);
    font-size: var(--font-size-small);
    color: var(--text-secondary);
}

.config-bm-health-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--text-secondary);
}

.config-bm-health-dot.is-healthy { background: var(--accent-success); }
.config-bm-health-dot.is-broken { background: var(--accent-error); }
.config-bm-health-dot.is-down { background: var(--accent-warning); }
```

- [ ] **Step 6: Adapt the existing specs**

Run `grep -n "config-bm-page\|config-bm-category\|data-bm-sort-chip\|data-bm-changed-toggle\|config-bm-cloud\|config-bm-filter-chip\|config-cleanup-banner\|data-cleanup-clear\|config-bm-select-all\|config-bm-tiles" tests/*.spec.js`. For each hit:

- `selectOption('#config-bm-page', id)` → `click('#config-bm-rail [data-bm-rail="page"][data-value="<id>"]')`.
- `selectOption('#config-bm-category', key)` → `click('#config-bm-rail [data-bm-rail="category"][data-value="<key>"]')` (the value is `pageId::category`).
- `[data-bm-sort-chip="x"]` → `selectOption('#config-bm-sort', 'x')`.
- `[data-bm-changed-toggle]` → `[data-bm-rail="cleanup"][data-value="changed"]` (open *more* first with `[data-bm-rail-more="views"]`, it is the sixth view).
- tag cloud chip → `[data-bm-rail="tag"][data-value="<tag>"]`.
- `.config-bm-filter-chip[data-bm-filter-clear="k"]` → `[data-bm-rail-clear="k"]`.
- cleanup banner / `[data-cleanup-clear]` → `[data-bm-rail-clear="cleanup"]`; drop assertions that the banner exists.
- select-all button → delete the test; its replacement is *select group* (Task 5).
- tiles in this tab → delete the assertion.

In `tests/config-bookmarks-filters.spec.js`, rename the test `'the quick bar sorts, and asks what changed this week'` to `'the sort menu sorts, and the rail asks what changed this week'` and apply the mappings above.

- [ ] **Step 7: Run the tests**

```bash
go run scripts/gen-asset-hashes.go
npm run test:workbench-model
PW_WORKERS=2 npx playwright test tests/config-bookmarks-rail.spec.js tests/config-bookmarks-filters.spec.js tests/config-stats-cleanup.spec.js tests/config-tag-suggestions.spec.js tests/config-new-sections.spec.js tests/config-view-tools.spec.js tests/config-dashboard-category-sync.spec.js tests/config-bookmarks-duplicates.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -40 /tmp/pw.txt
```

Run in the background (over 30 s). Expected: exit 0.

- [ ] **Step 8: Falsify**

1. In `toggleRailFilter`, delete `this.restoreConfigHash();`. Run the rail spec: the view-reload test fails. Restore.
2. In `bookmarkFacetCounts`, change the query facet to `test: (b) => tests.query(b) && tests.page(b)` (the page filter now narrows its own entries). Run the rail spec: the page test fails because the other page drops to 0. Restore.
3. `go run scripts/gen-asset-hashes.go`, run the rail spec once more: exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A static/js static/css locales/en.json internal/app/asset_hashes_gen.go tests CHANGELOG.md
git commit -m "move the bookmark filters into the rail"
```

---
### Task 4: Slab rows, grouping and selection keys

Rows become fixed-height grid rows. Under *Page order* they sit in slabs per page › category with a header that can select its group; any other order is one slab with a crumb per row. The list windows over rows *and* headers. `x`, Space and `⇧x` select; `m` and `c` go with the row menus.

**Files:**
- Modify: `static/js/dashboard/dashboard-config-bookmarks-workbench.js` (adds `renderBookmarksList`, `renderWorkbenchRow`, `workbenchItems`, `bindWorkbenchList`)
- Modify: `static/js/dashboard/dashboard-config-bookmarks.js` — delete `renderBookmarksList`, `renderBookmarkRow`
- Modify: `static/js/dashboard/dashboard-config.js` — `bookmarkRowWindow` (≈20756), `bindBookmarkWindowScroll` (≈20795), `bookmarkRowHeight` (≈20731), `moveBookmarkKeyboardSelectionWindowed` (≈2257), `scrollBookmarkRowIntoWindow` (≈2290), `applyBookmarkKeyboardSelection` (≈2200), `handleBookmarkKeyboardNavigation` (≈2461), `renderBookmarkKeyboardLegend` (≈22676), `bindBookmarkRows` (≈22972)
- Modify: `static/css/config-bookmarks-workbench.css`
- Modify: `locales/en.json`
- Create: `tests/config-bookmarks-helpers.js`
- Create: `tests/config-bookmarks-grouping.spec.js`
- Adapt: `tests/config-bookmarks-keyboard.spec.js`, `tests/config-bookmarks-window.spec.js`, `tests/config-bookmarks-paging.spec.js`, `tests/config-list-keyboard.spec.js`, `tests/config-keyboard-legend-style.spec.js`, `tests/config-bookmarks-open-tracking.spec.js`, `tests/config-bookmarks-context-menu.spec.js`, `tests/view-visual-alignment.spec.js`, `tests/health-multi-select.spec.js`, `tests/context-menu-pin-icon.spec.js`, `tests/bookmark-icon-fetch.spec.js`

**Interfaces:**
- Consumes: `BookmarkWorkbenchModel.buildItems`, `.itemWindow`, `.itemOffset`, `.rangeKeys` (Task 1); `bookmarkHealthState` (Task 3).
- Produces:
  - `workbenchItems() → Item[]` over the loaded rows (`visibleBookmarks().slice(0, bookmarkVisibleLimit(n))`).
  - `workbenchGrouped() → boolean` (`bmSort === 'page'`).
  - Row: `.config-bm-row[data-bm-key][role="row"][aria-selected]`, `.is-group-start`/`.is-group-end`, children `.config-bm-tick`, `.config-bm-title`, `.config-bm-domain`, `.config-bm-crumb` (flat only), `.config-bm-tags`, `.config-bm-key`, `.config-bm-opens`, `.config-bm-last`, `.config-bm-health-dot`.
  - Header: `.config-bm-group-head[data-bm-group]` with `button[data-bm-select-group]`.
  - `bookmarkRowWindow(total)` now returns the item window `{ start, end, above, below }` (item indices) or `null`.
  - `this.bmSelectAnchor: string | null`.
  - `toggleBookmarkSelection(key) → void`, `selectBookmarkRange(key) → void`, `selectBookmarkGroup(groupKey) → void`, `afterSelectionChange() → void` (repaints rows' tick state and calls `repaintWorkbenchPanel?.()` and `repaintBulkToolbar()`).

- [ ] **Step 1: Shared test helper**

Create `tests/config-bookmarks-helpers.js` by moving `openBookmarksWithRows` out of `tests/config-bookmarks-keyboard.spec.js` unchanged, and export it:

```js
// @ts-check
const { expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/** Config → Bookmarks over a fixed set of rows, served by route. */
async function openBookmarksWithRows(page, bookmarks) {
    // (body moved verbatim from config-bookmarks-keyboard.spec.js)
}

module.exports = { openBookmarksWithRows };
```

In `config-bookmarks-keyboard.spec.js`, replace the local function with `const { openBookmarksWithRows } = require('./config-bookmarks-helpers');`.

- [ ] **Step 2: Write the failing tests**

Create `tests/config-bookmarks-grouping.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithRows } = require('./config-bookmarks-helpers');

const ROWS = [
    { name: 'Grafana', url: 'https://grafana.example', pageId: 1, category: 'mon', openCount: 3 },
    { name: 'Prometheus', url: 'https://prom.example', pageId: 1, category: 'mon', openCount: 9 },
    { name: 'Proxmox', url: 'https://pve.example', pageId: 1, category: 'virt', openCount: 1 },
    { name: 'Plex', url: 'https://plex.example', pageId: 1, category: '', openCount: 5 },
];

test.describe('groups in the bookmark list', () => {
    test('page order draws one slab per category, with a header per slab', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-sort', 'page');
        const heads = page.locator('#config-bm-list .config-bm-group-head');
        await expect(heads).toHaveCount(3);
        await expect(heads.first()).toContainText('2');
        await expect(page.locator('#config-bm-list .config-bm-crumb')).toHaveCount(0);
        await expect(page.locator('#config-bm-list .config-bm-row.is-group-start')).toHaveCount(3);
    });

    test('any other order is one slab, and every row says where it lives', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-sort', 'opens');
        await expect(page.locator('#config-bm-list .config-bm-group-head')).toHaveCount(0);
        await expect(page.locator('#config-bm-list .config-bm-crumb')).toHaveCount(4);
        await expect(page.locator('#config-bm-list .config-bm-title').first()).toHaveText('Prometheus');
    });

    test('select group ticks the whole group', async ({ page }) => {
        await openBookmarksWithRows(page, ROWS);
        await page.selectOption('#config-bm-sort', 'page');
        await page.locator('#config-bm-list .config-bm-group-head').first()
            .locator('[data-bm-select-group]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(2);
        await expect(page.locator('#config-bm-list .config-bm-row[aria-selected="true"]')).toHaveCount(2);
    });

    test('select group reaches rows the window has not drawn', async ({ page }) => {
        const many = Array.from({ length: 400 }, (_, i) => ({
            name: `Row ${String(i).padStart(3, '0')}`, url: `https://r${i}.example`, pageId: 1, category: 'big',
        }));
        await openBookmarksWithRows(page, many);
        await page.selectOption('#config-bm-sort', 'page');
        await page.evaluate(() => { window.dashboardInstance.config.bmVisibleLimit = 400; });
        await page.selectOption('#config-bm-sort', 'name');
        await page.selectOption('#config-bm-sort', 'page');
        const drawn = await page.locator('#config-bm-list .config-bm-row').count();
        expect(drawn, 'the list is windowed').toBeLessThan(400);
        await page.locator('[data-bm-select-group]').first().click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(400);
    });
});
```

Append to `tests/config-bookmarks-keyboard.spec.js` inside its `describe`:

```js
    test('x and Space tick the row under the cursor, shift+x ticks a range', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'A', url: 'https://a.example', pageId: 1 },
            { name: 'B', url: 'https://b.example', pageId: 1 },
            { name: 'C', url: 'https://c.example', pageId: 1 },
            { name: 'D', url: 'https://d.example', pageId: 1 },
        ]);
        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('x');
        const selected = () => page.evaluate(() => [...window.dashboardInstance.config.bmSelected].sort());
        await expect.poll(selected).toEqual(['1::https://a.example']);

        await page.keyboard.press('j');
        await page.keyboard.press('j');
        await page.keyboard.press('Shift+X');
        await expect.poll(selected).toEqual(['1::https://a.example', '1::https://b.example', '1::https://c.example']);

        await page.keyboard.press('j');
        await page.keyboard.press(' ');
        await expect.poll(async () => (await selected()).length).toBe(4);
        await page.keyboard.press(' ');
        await expect.poll(async () => (await selected()).length).toBe(3);
    });

    test('m and c no longer open row menus', async ({ page }) => {
        await openBookmarksWithRows(page, [{ name: 'A', url: 'https://a.example', pageId: 1 }]);
        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('m');
        await page.keyboard.press('c');
        await expect(page.locator('#config-bm-list .health-view-menu:not([hidden])')).toHaveCount(0);
    });
```

In the same file, delete the tests that press `m`, `c`, or expect Space to open a bookmark (`grep -n "'m'\|'c'\|' '" tests/config-bookmarks-keyboard.spec.js`), and change any `Space opens` expectation to Enter.

- [ ] **Step 3: Run to verify they fail**

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-grouping.spec.js tests/config-bookmarks-keyboard.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -40 /tmp/pw.txt`
Expected: FAIL on `.config-bm-group-head`, `.config-bm-crumb`, the `x` test and the `m`/`c` test.

- [ ] **Step 4: Rows and list in the workbench module**

Add to `dashboard-config-bookmarks-workbench.js`:

```js
    workbenchGrouped() {
        return (this.bmSort ?? this.defaultBookmarksSort()) === 'page';
    },

    workbenchGroupKey(b) {
        return `${b.pageId}::${b.category || ''}`;
    },

    workbenchGroupLabel(b) {
        const page = this.pageLabel(b.pageId);
        if (!b.category) return page;
        return `${page} › ${this.railCategoryLabel(b.pageId, b.category)}`;
    },

    workbenchItems() {
        const all = this.visibleBookmarks();
        const rows = all.slice(0, this.bookmarkVisibleLimit(all.length));
        const token = JSON.stringify([this._bmVisibleToken, rows.length]);
        if (this._bmItemsToken === token && this._bmItemsRows === all && this._bmItems) return this._bmItems;
        const items = global.BookmarkWorkbenchModel.buildItems(rows, {
            grouped: this.workbenchGrouped(),
            groupKey: (b) => this.workbenchGroupKey(b),
            groupLabel: (b) => this.workbenchGroupLabel(b),
        });
        this._bmItemsToken = token;
        this._bmItemsRows = all;
        this._bmItems = items;
        return items;
    },

    renderWorkbenchRow(item, ctx) {
        const esc = ctx.esc;
        const b = item.bookmark;
        const key = this.bookmarkKey(b);
        const ticked = this.bmSelected.has(key);
        const title = b.name || this.formatBookmarkUrlDisplay(b.url) || b.url;
        const domain = this.formatBookmarkUrlDisplay(b.url);
        const state = this.bookmarkHealthState(b);
        const tags = (b.tags || []).map((t) => String(t).trim()).filter(Boolean);
        const TAGS_SHOWN = 2;
        const tagChips = tags.slice(0, TAGS_SHOWN)
            .map((t) => `<span class="config-bm-tag">${esc(t)}</span>`).join('')
            + (tags.length > TAGS_SHOWN ? `<span class="config-bm-tag config-bm-tag--more">+${tags.length - TAGS_SHOWN}</span>` : '');
        const last = global.formatLastOpened?.(b.lastOpened, { t: this.lastOpenedTranslator() })
            || { label: '—', never: true };
        const crumb = ctx.grouped ? '' : `<span class="config-bm-crumb">${esc(this.workbenchGroupLabel(b))}</span>`;
        const classes = ['config-bm-row'];
        if (ticked) classes.push('is-checked');
        if (item.groupStart) classes.push('is-group-start');
        if (item.groupEnd) classes.push('is-group-end');
        const feed = global.BookmarkFeedRow;
        return `
            <div class="${classes.join(' ')}" data-bm-key="${esc(key)}" role="row" tabindex="-1"
                 aria-selected="${ticked ? 'true' : 'false'}" aria-posinset="${item.index + 1}" aria-setsize="${ctx.setSize}">
                <label class="config-bm-check" role="gridcell">
                    <input type="checkbox" class="config-bm-tick" data-bm-tick="${esc(key)}" ${ticked ? 'checked' : ''}
                           aria-label="${esc(this.t('config.selectBookmark', 'Select bookmark'))}">
                </label>
                <span class="config-bm-icon" role="gridcell">${feed?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                <span class="config-bm-name" role="gridcell">
                    <span class="config-bm-health-dot is-${esc(state)}" title="${esc(this.railHealthLabel(state))}"></span>
                    <span class="config-bm-title">${esc(title)}</span>
                    <span class="config-bm-domain">${esc(domain)}</span>
                    ${b.pinned ? `<span class="config-bm-pin" aria-label="${esc(this.t('config.bookmarkPinnedAria', 'Pinned'))}">📌</span>` : ''}
                    ${ctx.isDuplicate(b) ? `<span class="config-bm-duplicate-badge">${esc(this.t('config.bookmarkDuplicateBadge', 'Duplicate'))}</span>` : ''}
                    ${crumb}
                </span>
                <span class="config-bm-tags" role="gridcell">${tagChips}</span>
                <span class="config-bm-key" role="gridcell">${b.shortcut
                    ? `<kbd>${esc(b.shortcut)}</kbd>`
                    : '<span class="config-bm-key--empty" aria-hidden="true">+</span>'}</span>
                <span class="config-bm-opens" role="gridcell" title="${esc(this.bookmarkUsageTooltip(b))}">${Number(b.openCount || 0)}</span>
                <span class="config-bm-last" role="gridcell">${esc(last.label)}</span>
            </div>`;
    },

    renderWorkbenchGroupHead(item, esc) {
        return `
            <div class="config-bm-group-head" data-bm-group="${esc(item.key)}" role="row">
                <span class="config-bm-group-label" role="rowheader">${esc(item.label)}
                    <span class="config-bm-group-count">${item.count}</span></span>
                <button type="button" class="config-bm-group-select" data-bm-select-group="${esc(item.key)}">${esc(this.t('config.bmSelectGroup', 'select group'))}</button>
            </div>`;
    },

    /** The rows themselves, re-rendered on every search/filter/edit change. */
    renderBookmarksList() {
        const esc = (v) => this.dash.escapeHtml(v);
        this._bmDuplicateUrls = null;
        const dupes = this.ensureDuplicateUrlSet();
        if (!(this.dash.allBookmarks || []).length) {
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const all = this.visibleBookmarks();
        if (!all.length) {
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.bookmarksEmptyReason())}</p>
                    ${this.bookmarksFiltersActive() ? `<button type="button" class="config-btn" data-bm-empty-clear>${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const items = this.workbenchItems();
        const rowCount = items.filter((i) => i.type === 'row').length;
        const ctx = {
            esc,
            grouped: this.workbenchGrouped(),
            setSize: all.length,
            isDuplicate: (b) => {
                const url = this.canonicalStatsUrlKey(b.url);
                return Boolean(url && dupes.has(url));
            },
        };
        const win = this.bookmarkRowWindow(items.length);
        const slice = win ? items.slice(win.start, win.end) : items;
        const body = slice.map((item) => (item.type === 'head'
            ? this.renderWorkbenchGroupHead(item, esc)
            : this.renderWorkbenchRow(item, ctx))).join('');
        const spacer = (px) => (px > 0 ? `<div class="config-bm-spacer" aria-hidden="true" style="height:${Math.round(px)}px"></div>` : '');
        const more = all.length > rowCount
            ? `<div class="config-bm-load-sentinel" data-bm-load-more hidden aria-hidden="true"></div>
               <p class="config-bm-load-hint">${esc(this.t('config.bookmarksLoadMoreHint', '{shown} of {total} shown — scroll for more')
                   .replace('{shown}', String(rowCount)).replace('{total}', String(all.length)))}</p>`
            : '';
        return `<div class="config-bm-feed${ctx.grouped ? ' is-grouped' : ''}" role="grid" aria-rowcount="${all.length}"
                     aria-label="${esc(this.t('config.bookmarks', 'Bookmarks'))}" data-bm-rows="${rowCount}">${win ? spacer(win.above) : ''}${body}${win ? spacer(win.below) : ''}${more}</div>`;
    },

    workbenchItemHeights() {
        const styles = getComputedStyle(document.getElementById('config-bm-workbench') || document.documentElement);
        const px = (name, fallback) => parseFloat(styles.getPropertyValue(name)) || fallback;
        return { rowHeight: px('--bm-row-h', 44), headHeight: px('--bm-head-h', 32) };
    },
```

In `dashboard-config-bookmarks.js`, delete `renderBookmarksList` and `renderBookmarkRow`. Keep `renderBookmarkRowActions` until Task 8.

Add `"bmSelectGroup":"select group"` with the locale helper.

- [ ] **Step 5: Window over items in `dashboard-config.js`**

Replace `bookmarkRowHeight()` with:

```js
    bookmarkRowHeight() {
        return this.workbenchItemHeights?.().rowHeight || 44;
    }
```

Replace `bookmarkRowWindow(total)` with:

```js
    /**
     * Which slice of the list's items (rows and group headers) to draw, or
     * null for all of them. Heights are fixed by the stylesheet, so the
     * spacers are exact.
     */
    bookmarkRowWindow() {
        const model = window.BookmarkWorkbenchModel;
        if (!model || typeof this.workbenchItems !== 'function') return null;
        const items = this.workbenchItems();
        const host = this.bookmarkListScrollHost();
        const list = document.getElementById('config-bm-list');
        let offset = 0;
        let viewport = window.innerHeight;
        if (list) {
            const box = list.getBoundingClientRect();
            if (host) {
                offset = host.scrollTop + (box.top - host.getBoundingClientRect().top);
                viewport = host.clientHeight;
            } else {
                offset = window.scrollY + box.top;
            }
        }
        const scrollTop = (host ? host.scrollTop : window.scrollY) - offset;
        return model.itemWindow(items, { scrollTop, viewport, ...this.workbenchItemHeights() });
    }
```

In `bindBookmarkWindowScroll`, replace the three lines computing `rows`, `shown`, `next` with:

```js
                const next = this.bookmarkRowWindow();
```

In `moveBookmarkKeyboardSelectionWindowed(delta)`, replace `if (!this.bookmarkRowWindow(shown)) return false;` with `if (!this.bookmarkRowWindow()) return false;`, and replace `this.scrollBookmarkRowIntoWindow(index, keys.length);` with `this.scrollBookmarkRowIntoWindow(index);`.

Replace `scrollBookmarkRowIntoWindow(index, total)` with:

```js
    scrollBookmarkRowIntoWindow(rowIndex) {
        const list = document.getElementById('config-bm-list');
        const model = window.BookmarkWorkbenchModel;
        if (!list || !model) return;
        const items = this.workbenchItems();
        const itemIndex = items.findIndex((i) => i.type === 'row' && i.index === rowIndex);
        if (itemIndex < 0) return;
        const { rowHeight, headHeight } = this.workbenchItemHeights();
        const host = this.bookmarkListScrollHost();
        const box = list.getBoundingClientRect();
        const viewport = host ? host.clientHeight : window.innerHeight;
        const listTop = host
            ? host.scrollTop + (box.top - host.getBoundingClientRect().top)
            : window.scrollY + box.top;
        const rowTop = listTop + model.itemOffset(items, itemIndex, rowHeight, headHeight);
        const current = host ? host.scrollTop : window.scrollY;
        const above = rowTop < current + rowHeight;
        const below = rowTop > current + viewport - rowHeight * 2;
        if (!above && !below) return;
        const target = Math.max(0, Math.round(rowTop - viewport / 3));
        if (host) host.scrollTop = target;
        else window.scrollTo(0, target);
        const next = this.bookmarkRowWindow();
        this._bmWindowKey = next ? `${next.start}-${next.end}` : 'all';
        this.repaintBookmarkRowsOnly();
    }
```

`grep -n "bookmarkRowWindow(" static/js` — every remaining caller passes no argument or an ignored one; update them to `bookmarkRowWindow()`.

- [ ] **Step 6: Selection helpers and keys in `dashboard-config.js`**

Add next to `hiddenSelectionCount()`:

```js
    toggleBookmarkSelection(key) {
        if (!key) return;
        if (this.bmSelected.has(key)) this.bmSelected.delete(key);
        else this.bmSelected.add(key);
        this.bmSelectAnchor = key;
        this.afterSelectionChange();
    }

    /** Tick everything between the anchor and `key`, in the order the list shows. */
    selectBookmarkRange(key) {
        const keys = this.visibleBookmarks().map((b) => this.bookmarkKey(b));
        const anchor = keys.includes(this.bmSelectAnchor) ? this.bmSelectAnchor : key;
        window.BookmarkWorkbenchModel.rangeKeys(keys, anchor, key).forEach((k) => this.bmSelected.add(k));
        this.bmSelectAnchor = key;
        this.afterSelectionChange();
    }

    /** Every row of a page › category group, drawn or not. */
    selectBookmarkGroup(groupKey) {
        this.visibleBookmarks()
            .filter((b) => this.workbenchGroupKey(b) === groupKey)
            .forEach((b) => this.bmSelected.add(this.bookmarkKey(b)));
        this.afterSelectionChange();
    }

    afterSelectionChange() {
        document.querySelectorAll('#config-bm-list .config-bm-row').forEach((row) => {
            const on = this.bmSelected.has(this.bookmarkRowKey(row));
            row.classList.toggle('is-checked', on);
            row.setAttribute('aria-selected', on ? 'true' : 'false');
            const box = row.querySelector('.config-bm-tick');
            if (box) box.checked = on;
        });
        this.repaintBulkToolbar();
        this.repaintWorkbenchPanel?.();
    }
```

Add `this.bmSelectAnchor = null;` to the constructor after `this.bmSelected = new Set();`.

In `applyBookmarkKeyboardSelection`, the cursor no longer writes `aria-selected` (that now means *ticked*). Replace `row.setAttribute('aria-selected', 'true');` with `row.setAttribute('aria-current', 'true');` and `row.removeAttribute('aria-selected');` with `row.removeAttribute('aria-current');`. Do the same in `clearBookmarkKeyboardSelection`. After the loop, add:

```js
        this.repaintWorkbenchPanel?.();
```

In `handleBookmarkKeyboardNavigation`:

- Replace `if ((e.key === 'Enter' || e.key === ' ') && this._bmKeyboardKey) {` with `if (e.key === 'Enter' && this._bmKeyboardKey) {`.
- Inside `if (this._bmKeyboardKey) {`, delete the `'m'` and `'c'` branches and add first:

```js
            if (e.key === 'x' || e.key === ' ') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.toggleBookmarkSelection(this._bmKeyboardKey);
                return true;
            }
            if (e.key === 'X') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.selectBookmarkRange(this._bmKeyboardKey);
                return true;
            }
```

Replace the `keys` array in `renderBookmarkKeyboardLegend()` with:

```js
        const keys = [
            ['j / k', this.t('config.bookmarksKeyMove', 'move')],
            ['x', this.t('config.bmKeySelect', 'select')],
            ['⇧x', this.t('config.bmKeyRange', 'range')],
            ['e', this.t('config.bookmarksKeyEdit', 'edit')],
            ['i', this.t('config.bmKeyPanel', 'panel')],
            ['Enter', this.t('config.bookmarksKeyOpen', 'open')],
            ['d', this.t('config.bookmarksKeyDelete', 'delete')],
            ['g / G', this.t('config.bookmarksKeyFirstLast', 'first / last')],
            ['/', this.t('config.bookmarksKeySearch', 'search')],
            ['Esc', this.t('config.bookmarksKeyClear', 'clear')],
        ];
```

`appendBookmarkKeyboardLegend` looks for `.config-bm-feed`; that class is kept, so it still attaches. `e` and `i` are wired in Task 5 — the legend lists them now, which is harmless for one task.

Add `{"bmKeySelect":"select","bmKeyRange":"range","bmKeyPanel":"panel"}` with the locale helper.

- [ ] **Step 7: Row binding**

Replace the body of `bindBookmarkRows(root)` with:

```js
    bindBookmarkRows(root) {
        this.bookmarkContextMenu()?.bindList(root);
        const listRoot = root.querySelector('#config-bm-list') || root;
        listRoot.querySelectorAll('.health-view-item-icon-img').forEach((img) => {
            window.BookmarkFeedRow?.bindIconFallback?.(img);
        });
        // Delegated once per host: rows are replaced on every repaint.
        if (listRoot.dataset.bmRowsWired === '1') return;
        listRoot.dataset.bmRowsWired = '1';
        listRoot.addEventListener('change', (e) => {
            const box = e.target.closest('[data-bm-tick]');
            if (!box) return;
            const key = box.getAttribute('data-bm-tick');
            if (box.checked) this.bmSelected.add(key);
            else this.bmSelected.delete(key);
            this.bmSelectAnchor = key;
            this.afterSelectionChange();
        });
        listRoot.addEventListener('click', (e) => {
            const group = e.target.closest('[data-bm-select-group]');
            if (group) {
                this.selectBookmarkGroup(group.getAttribute('data-bm-select-group'));
                return;
            }
            const tick = e.target.closest('.config-bm-check');
            const row = e.target.closest('.config-bm-row');
            if (tick && row && e.shiftKey) {
                e.preventDefault();
                this.selectBookmarkRange(this.bookmarkRowKey(row));
            }
        });
        listRoot.addEventListener('dblclick', (e) => {
            if (e.target.closest('button, label, input, select, a')) return;
            const key = e.target.closest('.config-bm-row')?.getAttribute('data-bm-key');
            if (key) this.openBookmarkByKey(key);
        });
    }
```

The old per-row listeners (inline edit, feed action buttons, More/check menus, crumb/tag filter buttons) go with the markup they bound. `startInlineBookmarkEdit` becomes unused here; it is deleted in Task 5.

- [ ] **Step 8: Row and slab styling**

Append to `static/css/config-bookmarks-workbench.css`:

```css
/* ── List ─────────────────────────────────────────────────────────────── */

.config-bm-feed {
    display: flex;
    flex-direction: column;
}

.config-bm-row,
.config-bm-group-head {
    background: var(--bm-slab-bg);
    padding-inline: var(--space-2, 0.5rem);
}

.config-bm-row {
    display: grid;
    grid-template-columns: 16px 18px minmax(0, 1fr) minmax(0, 9rem) 3rem 3rem 4.5rem;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    height: var(--bm-row-h);
    box-sizing: border-box;
    overflow: hidden;
    cursor: default;
}

.config-bm-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--bm-head-h);
    box-sizing: border-box;
    /* The gap above a slab is drawn inside the head's own fixed height, so
       the window's arithmetic stays exact. */
    border-top: var(--space-2, 0.5rem) solid transparent;
    background-clip: padding-box;
    border-radius: calc(var(--bm-slab-radius) + var(--space-2, 0.5rem)) calc(var(--bm-slab-radius) + var(--space-2, 0.5rem)) 0 0;
    font-size: var(--font-size-small);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
}

.config-bm-feed:not(.is-grouped) .config-bm-row.is-group-start {
    border-radius: var(--bm-slab-radius) var(--bm-slab-radius) 0 0;
}

.config-bm-row.is-group-end {
    border-radius: 0 0 var(--bm-slab-radius) var(--bm-slab-radius);
}

.config-bm-feed:not(.is-grouped) .config-bm-row.is-group-start.is-group-end {
    border-radius: var(--bm-slab-radius);
}

html[data-theme] body:not([data-depth="flat"]) .config-bm-row.is-group-end {
    box-shadow: 0 6px 14px -10px var(--shadow-color, rgba(0, 0, 0, 0.5));
}

.config-bm-group-select {
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
    opacity: 0;
}

.config-bm-group-head:hover .config-bm-group-select,
.config-bm-group-select:focus-visible {
    opacity: 1;
}

.config-bm-group-count {
    margin-left: 0.4em;
    font-family: var(--font-family-mono, ui-monospace, monospace);
}

.config-bm-row:hover {
    background: color-mix(in srgb, var(--accent-primary) 6%, var(--bm-slab-bg));
}

.config-bm-row.is-checked {
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bm-slab-bg));
}

.config-bm-row.keyboard-selected {
    background: color-mix(in srgb, var(--accent-primary) 18%, var(--bm-slab-bg));
    box-shadow: inset 2px 0 0 var(--accent-primary);
}

.config-bm-name {
    display: flex;
    align-items: baseline;
    gap: var(--space-2, 0.5rem);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
}

.config-bm-name .config-bm-health-dot {
    align-self: center;
}

.config-bm-title {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
}

.config-bm-domain,
.config-bm-crumb {
    font-family: var(--font-family-mono, ui-monospace, monospace);
    font-size: var(--font-size-small);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
}

.config-bm-crumb {
    font-family: inherit;
    opacity: 0.7;
}

.config-bm-tags {
    display: flex;
    gap: var(--space-1, 0.25rem);
    overflow: hidden;
}

.config-bm-tag {
    padding: 1px 7px;
    border-radius: var(--radius-pill, 999px);
    background: var(--surface-3, var(--background-secondary));
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.config-bm-key--empty {
    opacity: 0.35;
}

.config-bm-opens,
.config-bm-last {
    font-family: var(--font-family-mono, ui-monospace, monospace);
    font-size: var(--font-size-small);
    color: var(--text-secondary);
    text-align: right;
    white-space: nowrap;
}
```

The window depends only on `--bm-head-h` being the head's full box height, which `box-sizing: border-box` guarantees. Check the rounded top corners in the browser on a glass, a rich and a flat theme; if the transparent border shows the radius wrong, keep the border and set `border-radius` on an inner `::before` instead — never add margin.

- [ ] **Step 9: Adapt the other specs**

`grep -n "feed-action\|data-bm-inline\|health-check-mode\|health-view-more-btn\|config-bm-item\|config-bm-meta\|config-bm-crumb\|config-bm-tag-chip\|config-bm-shortcut-pill\|role=\"listitem\"\|aria-selected" tests/*.spec.js` and per hit:

- Open button → `dblclick` on `.config-bm-row .config-bm-title`, or Enter after `j`.
- `.config-bm-tag-chip` click-to-filter → rail tag entry (Task 3 mapping).
- `.config-bm-shortcut-pill` → `.config-bm-key kbd` for reading; editing moves to Task 5 (leave those tests for Task 5).
- `data-bm-inline` → leave for Task 5.
- More menu / check-mode badge in the row → the right-click menu (`click({ button: 'right' })`) which keeps the same items.
- Keyboard cursor asserting `aria-selected` → `aria-current`.
- `config-bm-item` → `config-bm-row`.

In `tests/config-bookmarks-window.spec.js`, keep every assertion about drawn-row counts and spacers; if one reads row height from `getBoundingClientRect`, it now equals `44`.

- [ ] **Step 10: Run the tests**

```bash
go run scripts/gen-asset-hashes.go
PW_WORKERS=2 npx playwright test tests/config-bookmarks-grouping.spec.js tests/config-bookmarks-keyboard.spec.js tests/config-bookmarks-window.spec.js tests/config-bookmarks-paging.spec.js tests/config-list-keyboard.spec.js tests/config-keyboard-legend-style.spec.js tests/config-bookmarks-open-tracking.spec.js tests/config-bookmarks-context-menu.spec.js tests/config-bookmarks-rail.spec.js tests/config-bookmarks-filters.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -40 /tmp/pw.txt
```

Background run. Expected: exit 0. Then separately `tests/view-visual-alignment.spec.js tests/health-multi-select.spec.js tests/context-menu-pin-icon.spec.js tests/bookmark-icon-fetch.spec.js`.

- [ ] **Step 11: Falsify**

1. In `workbenchGrouped`, return `false`. Grouping spec: the page-order test fails. Restore.
2. In `selectBookmarkGroup`, replace `this.visibleBookmarks()` with the drawn rows (`[...document.querySelectorAll('#config-bm-list .config-bm-row')].map((r) => this.findBookmarkByKey(this.bookmarkRowKey(r)))`). The windowed select-group test fails. Restore.
3. In the keyboard handler, drop the `' '` from `e.key === 'x' || e.key === ' '`. The x/Space test fails. Restore. Regenerate hashes.

- [ ] **Step 12: Commit**

```bash
git add -A static/js static/css locales/en.json internal/app/asset_hashes_gen.go tests CHANGELOG.md
git commit -m "draw bookmark rows as slabs and select them from the keyboard"
```

---
### Task 5: Detail panel for one bookmark

The panel becomes the only place a bookmark is edited. Fields save when you leave them; `e` jumps into the panel, `i` folds it away and the choice is remembered. Inline editing in rows and the edit modal from the list go. The bulk writers learn to take arguments, because moving one bookmark to another page is a bulk move of one.

**Files:**
- Modify: `static/js/dashboard/dashboard-config-bookmarks-workbench.js` (panel render, repaint, binding, collapse)
- Modify: `static/js/dashboard/dashboard-config.js` — `saveInlineBookmarkField` → `saveBookmarkFields` (≈22310), delete `startInlineBookmarkEdit` (≈22170), `bulkMove` / `bulkTags` / `bulkStatus` / `bulkPin` (≈23827–23930), `handleBulkAction` (≈23681), `activateBookmarkKeyboardRow` (≈2309), `handleBookmarkKeyboardNavigation`, the Escape handler guard (≈949)
- Modify: `static/js/dashboard/dashboard-config-context-menu.js` — `edit` and `pin` cases
- Modify: `static/css/config-bookmarks-workbench.css`
- Modify: `locales/en.json`
- Create: `tests/config-bookmarks-panel.spec.js`
- Adapt: `tests/config-bookmarks-editor.spec.js`, `tests/config-bookmarks-context-menu.spec.js`, `tests/config-four-fixes.spec.js`, `tests/monitor-visibility-reveal.spec.js`, `tests/config-bookmarks-trash.spec.js`

**Interfaces:**
- Consumes: `afterSelectionChange`, `workbenchGroupLabel`, `railHealthLabel`, `railCategoryLabel` (Tasks 3–4).
- Produces:
  - `saveBookmarkFields(key, patch) → Promise<boolean>` — `patch` holds any of `name, url, category, tags, shortcut, note, pinned`; writes one page, refreshes, and moves the panel focus to the bookmark's new key.
  - `bulkMove(picked, { pageId, category })`, `bulkTags(picked, { tags, mode })`, `bulkStatus(picked, mode)`, `bulkPin(picked, pinned)` — no DOM reads. `pinned` is `true`/`false`; `undefined` keeps the old "pin all unless all pinned" rule.
  - `bulkArgsFromToolbar(action) → object` — reads the legacy bulk bar inputs (deleted in Task 6).
  - `renderWorkbenchPanel() → string`, `repaintWorkbenchPanel() → void`, `bindWorkbenchPanel(panel) → void`, `focusWorkbenchPanel(key?) → void`, `toggleWorkbenchPanel(force?, { remember = true }?) → void`.
  - `bmPanelCollapsed()` (Task 2) now also returns `false` while `this._bmPanelTempOpen` is set.
  - Panel fields: `[data-bm-field="name|url|page|category|tags|shortcut|note|pinned|checkMode"]`; each followed by `.config-bm-field-status`; the error state is `.is-error` on the field wrapper `.config-bm-field`.
  - `#config-bm-panel[data-bm-panel-mode="empty|single|bulk"][data-bm-panel-key]`.
  - Toggle button `[data-bm-panel-toggle]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/config-bookmarks-panel.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-rail.spec.js');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

/** Capture page writes instead of storing them. */
async function capturePosts(page) {
    const posts = [];
    await page.route('**/api/bookmarks?page=*', async (route) => {
        if (route.request().method() === 'POST') {
            posts.push(JSON.parse(route.request().postData() || '[]'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fallback();
    });
    return posts;
}

async function focusFirstRow(page) {
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('j');
    return page.locator('#config-bm-list .config-bm-row.keyboard-selected').getAttribute('data-bm-key');
}

test.describe('the bookmark panel', () => {
    test('follows the row under the cursor', async ({ page }) => {
        await openBookmarks(page);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'empty');
        const first = await focusFirstRow(page);
        await expect(panel).toHaveAttribute('data-bm-panel-key', first);
        await page.keyboard.press('j');
        const second = await page.locator('#config-bm-list .config-bm-row.keyboard-selected').getAttribute('data-bm-key');
        await expect(panel).toHaveAttribute('data-bm-panel-key', second);
        const name = await page.evaluate((k) => window.dashboardInstance.config.findBookmarkByKey(k).name, second);
        await expect(panel.locator('[data-bm-field="name"]')).toHaveValue(name);
    });

    test('e jumps into the panel, and leaving a field saves it', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const name = page.locator('#config-bm-panel [data-bm-field="name"]');
        await expect(name).toBeFocused();
        await name.fill('Renamed from the panel');
        await page.keyboard.press('Tab');
        await expect.poll(() => posts.some((list) => list.some((b) => b.name === 'Renamed from the panel'))).toBe(true);
    });

    test('a failed save keeps what was typed and says so', async ({ page }) => {
        await page.route('**/api/bookmarks?page=*', async (route) => (route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'no' })
            : route.fallback()));
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const note = page.locator('#config-bm-panel [data-bm-field="note"]');
        await note.fill('will not save');
        await page.keyboard.press('Tab');
        const wrap = page.locator('#config-bm-panel .config-bm-field', { has: note });
        await expect(wrap).toHaveClass(/is-error/);
        await expect(note).toHaveValue('will not save');
    });

    test('a shortcut someone else holds is refused', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const key = await focusFirstRow(page);
        const taken = await page.evaluate((k) => {
            const c = window.dashboardInstance.config;
            const other = c.dash.allBookmarks.find((b) => c.bookmarkKey(b) !== k);
            other.shortcut = 'ZQ';
            return other.shortcut;
        }, key);
        await page.keyboard.press('e');
        const field = page.locator('#config-bm-panel [data-bm-field="shortcut"]');
        await field.fill(taken);
        await page.keyboard.press('Tab');
        await expect(page.locator('#config-bm-panel .config-bm-field', { has: field })).toHaveClass(/is-error/);
        await expect(page.locator('#config-bm-panel .config-bm-field', { has: field })).toContainText('ZQ');
        expect(posts.length).toBe(0);
    });

    test('i folds the panel away, and it stays folded after a reload', async ({ page }) => {
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('i');
        await expect(page.locator('#config-bm-workbench')).toHaveClass(/is-panel-collapsed/);
        await page.reload();
        await page.waitForSelector('#config-bm-workbench', { timeout: 15_000 });
        await expect(page.locator('#config-bm-workbench')).toHaveClass(/is-panel-collapsed/);
        await page.click('[data-bm-panel-toggle]');
        await expect(page.locator('#config-bm-workbench')).not.toHaveClass(/is-panel-collapsed/);
    });

    test('Edit in the right-click menu opens the panel, not a dialog', async ({ page }) => {
        await openBookmarks(page);
        const row = page.locator('#config-bm-list .config-bm-row').first();
        await row.click({ button: 'right' });
        await page.locator('.config-bm-context-menu [data-action="edit"], .config-bm-context-menu :text("Edit")').first().click();
        await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
        await expect(page.locator('#config-bm-panel [data-bm-field="name"]')).toBeFocused();
    });

    test('Escape in a field puts the old value back and returns to the list', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        await focusFirstRow(page);
        await page.keyboard.press('e');
        const name = page.locator('#config-bm-panel [data-bm-field="name"]');
        const before = await name.inputValue();
        await name.fill('typo');
        await page.keyboard.press('Escape');
        await expect(name).toHaveValue(before);
        await expect(page.locator('#config-bm-view, .config-view').first()).toBeVisible();
        expect(posts.length).toBe(0);
    });
});
```

If the context menu's item selector differs, read `show()` in `dashboard-config-context-menu.js` for the attribute it renders per item and use that; keep the test clicking the real menu.

Also export `openBookmarks` from `tests/config-bookmarks-rail.spec.js` (it already has `module.exports`). Playwright tolerates requiring a spec file; if it complains about duplicate test registration, move `openBookmarks` into `tests/config-bookmarks-helpers.js` and import it from both specs.

- [ ] **Step 2: Run to verify they fail**

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-panel.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt`
Expected: FAIL — `data-bm-panel-mode` missing.

- [ ] **Step 3: Bulk writers take arguments**

In `dashboard-config.js`:

```js
    /** What the legacy bulk bar's inputs say, for the one caller left that reads them. */
    bulkArgsFromToolbar(action) {
        const val = (id) => document.getElementById(id)?.value || '';
        if (action === 'move') {
            const { categoryId } = DashboardConfig.parseCategoryFilter(val('config-bulk-category'));
            return { pageId: val('config-bulk-page'), category: categoryId };
        }
        if (action === 'tags') {
            return {
                tags: val('config-bulk-tags').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
                mode: val('config-bulk-tags-mode') || 'add',
            };
        }
        if (action === 'status') return val('config-bulk-status') || 'off';
        return undefined;
    }
```

`handleBulkAction(action)` dispatch becomes:

```js
            if (action === 'move') await this.bulkMove(picked, this.bulkArgsFromToolbar('move'));
            else if (action === 'tags') await this.bulkTags(picked, this.bulkArgsFromToolbar('tags'));
            else if (action === 'status') await this.bulkStatus(picked, this.bulkArgsFromToolbar('status'));
            else if (action === 'pin') await this.bulkPin(picked);
```

`bulkMove(picked)` → `bulkMove(picked, { pageId = '', category = '' } = {})`; replace its first three lines with:

```js
        const targetPage = String(pageId || '');
        const targetCat = String(category || '');
        const catPage = null;
```

(the rest of the method is unchanged; `catPage` stays `null` because the caller now passes the page explicitly).

`bulkTags(picked)` → `bulkTags(picked, { tags = [], mode = 'add' } = {})`; delete its `raw`/`mode`/`tags` reading lines and keep `if (!tags.length) return;`.

`bulkStatus(picked)` → `bulkStatus(picked, mode = 'off')`; delete its `const mode = …` line.

`bulkPin(picked)` → `bulkPin(picked, pinned)`; replace its first lines with:

```js
        // Explicit when asked; otherwise a mixed selection pins everything
        // rather than flipping each.
        const target = typeof pinned === 'boolean' ? pinned : !picked.every((b) => b.pinned === true);
        const snapshots = await this.mutateSelected(picked, (b) => ({ ...b, pinned: target }));
```

`grep -n "bulkMove(\|bulkTags(\|bulkStatus(\|bulkPin(" static/js` — update every other caller (the tag-suggestion panel and the context menu `pin` case keep working: `bulkPin([bookmark])` is still valid).

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-editor.spec.js -g "bulk" > /tmp/pw.txt 2>&1; echo "exit $?"` — Expected: exit 0 (the bulk bar still drives these).

- [ ] **Step 4: Generic field save**

Replace `saveInlineBookmarkField(key, field, value)` with:

```js
    /**
     * Write some fields of one bookmark, then refresh.
     *
     * Returns false without writing when the page no longer has the bookmark
     * or the server refuses; the panel keeps what was typed in that case. The
     * panel follows the bookmark afterwards, because a new URL is a new key.
     */
    async saveBookmarkFields(key, patch) {
        const record = await this.findBookmarkRecord(key);
        if (!record) return false;
        const { pageId, index } = record;
        try {
            const res = await fetch(`/api/bookmarks?page=${encodeURIComponent(pageId)}`);
            const list = res.ok ? await res.json() : null;
            if (!Array.isArray(list) || !list[index]) throw new Error('bookmark not found');
            const next = { ...list[index], ...patch };
            if ('shortcut' in patch) next.shortcut = String(patch.shortcut || '').trim().toUpperCase();
            // An emptied name or URL keeps what was there: a row with neither
            // has nothing to show and nowhere to go.
            if ('name' in patch && !String(patch.name || '').trim()) next.name = list[index].name;
            if ('url' in patch) {
                const url = window.BookmarkUrlUtils?.ensureHttpUrl?.(patch.url) || String(patch.url || '').trim();
                next.url = url || list[index].url;
            }
            next.updatedAt = Date.now();
            list[index] = next;
            const saved = await this.writeFetch(`/api/bookmarks?page=${encodeURIComponent(pageId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list),
            });
            if (!saved.ok) throw new Error(`HTTP ${saved.status}`);
            this._bmPendingFocus = { pageId: String(pageId), index };
            await this.refreshBookmarksAfterWrite();
            return true;
        } catch {
            return false;
        }
    }

    /** The key of the n-th bookmark on a page, as the list now holds it. */
    bookmarkKeyAt(pageId, index) {
        const onPage = (this.dash.allBookmarks || []).filter((b) => String(b.pageId) === String(pageId));
        const b = index < 0 ? onPage[onPage.length - 1] : onPage[index];
        return b ? this.bookmarkKey(b) : null;
    }
```

Check `grep -n "updatedAt" internal/app/*.go | head` — if the server sets `updatedAt` itself on write, drop the `next.updatedAt` line.

Delete `startInlineBookmarkEdit` and every reference (`grep -n "startInlineBookmarkEdit\|saveInlineBookmarkField\|config-bm-inline" static/js` must return nothing except CSS, removed in Task 8). In the Escape handler, delete the line `if (document.activeElement?.classList?.contains('config-bm-inline-input')) return;` and add in its place:

```js
            // A panel field owns Escape: it means "put the old value back".
            if (document.activeElement?.closest?.('#config-bm-panel')) return;
```

- [ ] **Step 5: Keys `e` and `i`**

Replace `activateBookmarkKeyboardRow(key)` body with:

```js
        if (!key) return;
        this.focusWorkbenchPanel(key);
```

In `handleBookmarkKeyboardNavigation`, inside `if (this._bmKeyboardKey) {`, add:

```js
            if (e.key === 'i') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.toggleWorkbenchPanel();
                return true;
            }
```

`i` also works without a focused row — add the same branch once more just before `if (e.key === '/' …`.

In `dashboard-config-context-menu.js`, change `case 'edit':` to:

```js
            case 'edit':
                c.focusWorkbenchPanel(key);
                break;
```

- [ ] **Step 6: The panel**

Add to `dashboard-config-bookmarks-workbench.js` (replacing the Task 2 stub of `renderWorkbenchPanel` and extending `bindWorkbench`):

```js
    workbenchPanelMode() {
        if (this.bmSelected.size > 1) return 'bulk';
        return this.workbenchPanelKey() ? 'single' : 'empty';
    },

    workbenchPanelKey() {
        if (this._bmPendingFocus) {
            const key = this.bookmarkKeyAt(this._bmPendingFocus.pageId, this._bmPendingFocus.index);
            this._bmPendingFocus = null;
            if (key) this._bmKeyboardKey = key;
        }
        const key = this._bmKeyboardKey;
        return key && this.findBookmarkByKey(key) ? key : null;
    },

    renderWorkbenchPanelToggle() {
        const esc = (v) => this.dash.escapeHtml(v);
        const collapsed = this.bmPanelCollapsed();
        const label = collapsed ? this.t('config.bmDetails', 'Details') : this.t('config.bmHideDetails', 'Hide details');
        return `<button type="button" class="config-bm-panel-toggle" data-bm-panel-toggle
                        aria-expanded="${collapsed ? 'false' : 'true'}" title="${esc(label)} (i)">
                    <span class="config-bm-panel-toggle-label">${esc(label)}</span><span aria-hidden="true">${collapsed ? '‹' : '›'}</span>
                </button>`;
    },

    renderWorkbenchPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const mode = this.workbenchPanelMode();
        let body;
        if (mode === 'bulk') body = this.renderWorkbenchBulkPanel?.() || '';
        else if (mode === 'single') body = this.renderWorkbenchSinglePanel(this.workbenchPanelKey());
        else body = `<p class="config-bm-panel-empty">${esc(this.t('config.bmPanelEmpty', 'Select a bookmark to see it here.'))}</p>`;
        return `${this.renderWorkbenchPanelToggle()}<div class="config-bm-panel-body">${body}</div>`;
    },

    renderWorkbenchField(name, label, control) {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <label class="config-bm-field" data-bm-field-wrap="${name}">
                <span class="config-bm-field-label">${esc(label)}</span>
                ${control}
                <span class="config-bm-field-status" role="status"></span>
            </label>`;
    },

    renderWorkbenchSinglePanel(key) {
        const esc = (v) => this.dash.escapeHtml(v);
        const b = this.findBookmarkByKey(key);
        const facts = global.HealthFacts?.get?.(b.url) || null;
        const state = this.bookmarkHealthState(b);
        const fmt = (ts) => global.formatLastOpened?.(ts, { t: this.lastOpenedTranslator() }) || { label: '—' };
        const pageOptions = (this.dash.pages || []).map((p) =>
            `<option value="${esc(p.id)}"${String(p.id) === String(b.pageId) ? ' selected' : ''}>${esc(p.name || p.id)}</option>`).join('');
        const categories = this.knownCategories(b.pageId);
        const catOptions = [`<option value="">${esc(this.t('config.bmNoCategory', 'No category'))}</option>`]
            .concat(categories.map((c) => {
                const id = global.DashboardConfig.parseCategoryFilter(c.id).categoryId;
                return `<option value="${esc(id)}"${id === (b.category || '') ? ' selected' : ''}>${esc(c.label)}</option>`;
            })).join('');
        const mode = global.CheckMode?.of?.(b) || 'off';
        const modeOptions = (global.CheckMode?.options?.() || []).map((o) =>
            `<option value="${esc(o.mode)}"${o.mode === mode ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
        const input = (name, value, extra = '') =>
            `<input type="text" class="config-text" data-bm-field="${name}" value="${esc(value ?? '')}" data-original="${esc(value ?? '')}" ${extra}>`;
        const feed = global.BookmarkFeedRow;
        return `
            <header class="config-bm-panel-head">
                <span class="config-bm-panel-icon">${feed?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                <span class="config-bm-panel-title">${esc(b.name || this.formatBookmarkUrlDisplay(b.url))}</span>
                <button type="button" class="config-btn config-btn--small" data-bm-panel-action="open">${esc(this.t('config.openBookmark', 'Open'))}</button>
            </header>
            <div class="config-bm-panel-fields">
                ${this.renderWorkbenchField('name', this.t('config.bookmarkNameLabel', 'Name'), input('name', b.name))}
                ${this.renderWorkbenchField('url', this.t('config.bmFieldUrl', 'URL'), input('url', b.url, 'spellcheck="false"'))}
                ${this.renderWorkbenchField('page', this.t('config.page', 'Page'), `<select class="config-select" data-bm-field="page">${pageOptions}</select>`)}
                ${this.renderWorkbenchField('category', this.t('config.category', 'Category'), `<select class="config-select" data-bm-field="category">${catOptions}</select>`)}
                ${this.renderWorkbenchField('tags', this.t('config.bmFieldTags', 'Tags'), input('tags', (b.tags || []).join(', ')))}
                ${this.renderWorkbenchField('shortcut', this.t('config.bmFieldShortcut', 'Shortcut'), input('shortcut', b.shortcut, 'maxlength="5"'))}
                ${this.renderWorkbenchField('note', this.t('config.bmFieldNote', 'Note'),
                    `<textarea class="config-text" rows="2" data-bm-field="note" data-original="${esc(b.note || '')}">${esc(b.note || '')}</textarea>`)}
                <label class="config-bm-field config-bm-field--inline" data-bm-field-wrap="pinned">
                    <input type="checkbox" data-bm-field="pinned"${b.pinned ? ' checked' : ''}>
                    <span class="config-bm-field-label">${esc(this.t('config.pinnedShort', 'Pinned'))}</span>
                    <span class="config-bm-field-status" role="status"></span>
                </label>
                ${this.renderWorkbenchField('checkMode', this.t('config.bmFieldChecking', 'Checking'), `<select class="config-select" data-bm-field="checkMode">${modeOptions}</select>`)}
            </div>
            <section class="config-bm-panel-facts">
                <h3>${esc(this.t('config.bmHealth', 'Health'))}</h3>
                <p><span class="config-bm-health-dot is-${esc(state)}"></span> ${esc(this.railHealthLabel(state))}</p>
                ${facts?.lastError ? `<p class="config-bm-panel-muted">${esc(facts.lastError)}</p>` : ''}
                ${facts?.uptime7d != null ? `<p class="config-bm-panel-muted">${esc(this.t('config.bmUptime7d', '{pct}% up this week').replace('{pct}', String(Math.round(facts.uptime7d * 100))))}</p>` : ''}
                <h3>${esc(this.t('config.bmUsage', 'Usage'))}</h3>
                <p class="config-bm-panel-muted">${esc(this.bookmarkUsageTooltip(b))}</p>
                <p class="config-bm-panel-muted">${esc(this.t('config.bookmarkStatLastOpened', 'Last opened'))}: ${esc(fmt(b.lastOpened).label)}</p>
            </section>
            <footer class="config-bm-panel-foot">
                <button type="button" class="config-btn config-btn--small" data-bm-panel-action="dashboard">${esc(this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-panel-action="favicon">${esc(this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'))}</button>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-panel-action="delete">${esc(this.t('config.delete', 'Delete'))}</button>
            </footer>`;
    },

    repaintWorkbenchPanel() {
        const panel = document.getElementById('config-bm-panel');
        if (!panel) return;
        // A save in flight owns the panel until it lands: repainting now would
        // take the field (and what was typed into it) away mid-write.
        if (this._bmPanelSaving) {
            this._bmPanelRepaintQueued = true;
            return;
        }
        const mode = this.workbenchPanelMode();
        const key = mode === 'single' ? this.workbenchPanelKey() : '';
        const sig = `${mode}|${key}|${mode === 'bulk' ? [...this.bmSelected].sort().join(',') : ''}|${(this.dash.allBookmarks || []).length}`;
        // Typing in the panel while the list repaints around it must not lose
        // the field; the same bookmark in the same mode is left alone.
        if (panel.dataset.bmPanelSig === sig && panel.contains(document.activeElement)) return;
        panel.innerHTML = this.renderWorkbenchPanel();
        panel.dataset.bmPanelSig = sig;
        panel.dataset.bmPanelMode = mode;
        panel.dataset.bmPanelKey = key || '';
        if (mode === 'bulk') this.toggleWorkbenchPanel(false, { remember: false });
    },

    /**
     * Fold or unfold the panel. Only the reader's own toggle (the button, `i`)
     * is remembered; `e` and a multi-row selection open it for now without
     * overwriting that choice.
     */
    toggleWorkbenchPanel(force, { remember = true } = {}) {
        const collapsed = typeof force === 'boolean' ? force : !this.bmPanelCollapsed();
        if (remember) {
            this._bmPanelTempOpen = false;
            try {
                global.localStorage?.setItem('nextdash.bmPanelCollapsed', collapsed ? '1' : '0');
            } catch { /* private window: the choice lasts this visit */ }
        } else {
            this._bmPanelTempOpen = !collapsed;
        }
        const root = document.getElementById('config-bm-workbench');
        root?.classList.toggle('is-panel-collapsed', collapsed);
        const toggle = document.querySelector('#config-bm-panel [data-bm-panel-toggle]');
        if (toggle) toggle.outerHTML = this.renderWorkbenchPanelToggle();
    },

    focusWorkbenchPanel(key) {
        if (key) this._bmKeyboardKey = key;
        this.toggleWorkbenchPanel(false, { remember: false });
        this.repaintWorkbenchPanel();
        const field = document.querySelector('#config-bm-panel [data-bm-field="name"], #config-bm-panel [data-bm-field]');
        field?.focus();
        field?.select?.();
    },

    /** Read a field into a patch for saveBookmarkFields, or null when nothing changed. */
    workbenchFieldPatch(el) {
        const name = el.getAttribute('data-bm-field');
        if (el.type === 'checkbox') return { [name]: el.checked };
        const value = el.value;
        if ((el.getAttribute('data-original') ?? null) === value) return null;
        if (name === 'tags') {
            return { tags: [...new Set(value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))] };
        }
        return { [name]: value };
    },

    setWorkbenchFieldStatus(el, message, isError) {
        const wrap = el.closest('.config-bm-field');
        if (!wrap) return;
        wrap.classList.toggle('is-error', Boolean(isError));
        const status = wrap.querySelector('.config-bm-field-status');
        if (status) status.textContent = message || '';
    },

    async commitWorkbenchField(el) {
        const key = document.getElementById('config-bm-panel')?.dataset.bmPanelKey;
        const name = el.getAttribute('data-bm-field');
        if (!key || !name) return;
        const b = this.findBookmarkByKey(key);
        if (!b) return;
        if (name === 'shortcut') {
            const owner = this.findShortcutOwner(el.value, key);
            if (owner) {
                this.setWorkbenchFieldStatus(el, this.t('config.bookmarkShortcutTaken', '“{key}” is already {name}')
                    .replace('{key}', String(el.value || '').trim().toUpperCase())
                    .replace('{name}', owner.name || owner.url || ''), true);
                return;
            }
        }
        let run;
        if (name === 'page') {
            if (String(el.value) === String(b.pageId)) return;
            this._bmPendingFocus = { pageId: String(el.value), index: -1 };
            run = this.bulkMove([b], { pageId: el.value, category: b.category || '' }).then(() => true, () => false);
        } else if (name === 'checkMode') {
            run = this.setBookmarkCheckMode(key, el.value).then(() => true, () => false);
        } else {
            const patch = this.workbenchFieldPatch(el);
            if (!patch) return;
            if (name === 'category' && el.value) await this.ensureCategoryOnPage(b.pageId, el.value);
            run = this.saveBookmarkFields(key, patch);
        }
        this.setWorkbenchFieldStatus(el, '', false);
        this._bmPanelSaving = run;
        const ok = await run;
        this._bmPanelSaving = null;
        if (!ok) {
            this._bmPendingFocus = null;
            this._bmKeyboardKey = key;
            this.setWorkbenchFieldStatus(el, this.t('config.bmNotSaved', 'Not saved — retry'), true);
            this._bmPanelRepaintQueued = false;
            return;
        }
        if (this._bmPanelRepaintQueued) {
            this._bmPanelRepaintQueued = false;
            document.getElementById('config-bm-panel').dataset.bmPanelSig = '';
            this.repaintWorkbenchPanel();
        }
    },

    bindWorkbenchPanel(panel) {
        if (!panel || panel.dataset.bmPanelWired === '1') return;
        panel.dataset.bmPanelWired = '1';
        panel.addEventListener('click', (e) => {
            if (e.target.closest('[data-bm-panel-toggle]')) {
                this.toggleWorkbenchPanel();
                return;
            }
            const action = e.target.closest('[data-bm-panel-action]')?.getAttribute('data-bm-panel-action');
            const key = panel.dataset.bmPanelKey;
            if (!action || !key) return;
            if (action === 'open') this.openBookmarkByKey(key);
            else if (action === 'delete') void this.deleteBookmarkByKey(key);
            else this.handleBookmarkMenuAction(action, key);
        });
        // Selects and the checkbox save on change; text on leaving the field.
        panel.addEventListener('change', (e) => {
            const el = e.target.closest('[data-bm-field]');
            if (!el || panel.dataset.bmPanelMode !== 'single') return;
            if (el.tagName === 'SELECT' || el.type === 'checkbox') void this.commitWorkbenchField(el);
        });
        panel.addEventListener('focusout', (e) => {
            const el = e.target.closest('input[data-bm-field]:not([type="checkbox"]), textarea[data-bm-field]');
            if (!el || panel.dataset.bmPanelMode !== 'single') return;
            void this.commitWorkbenchField(el);
        });
        panel.addEventListener('keydown', (e) => {
            const el = e.target.closest('[data-bm-field]');
            if (!el) return;
            e.stopPropagation();
            if (e.key === 'Enter' && el.tagName === 'INPUT') {
                e.preventDefault();
                el.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (el.hasAttribute('data-original')) el.value = el.getAttribute('data-original');
                this.setWorkbenchFieldStatus(el, '', false);
                // Back to the row, without a save: the value is the old one.
                el.removeAttribute('data-bm-field');
                el.blur();
                const row = [...document.querySelectorAll('#config-bm-list .config-bm-row')]
                    .find((r) => this.bookmarkRowKey(r) === panel.dataset.bmPanelKey);
                row?.focus({ preventScroll: true });
                document.getElementById('config-bm-panel').dataset.bmPanelSig = '';
                this.repaintWorkbenchPanel();
            }
        });
    },

    bindWorkbench(container) {
        this.bindWorkbenchRail(container.querySelector('#config-bm-rail'));
        const panel = container.querySelector('#config-bm-panel');
        this.bindWorkbenchPanel(panel);
        if (panel) {
            panel.dataset.bmPanelSig = '';
            this.repaintWorkbenchPanel();
        }
    },
```

`renderBookmarksWorkbench` (Task 2) already calls `renderWorkbenchPanel()`; `bindWorkbench` repaints once to stamp the data attributes.

Add strings:

```bash
# the File Map locale helper, with:
node -e "$LOCALE_HELPER" '{"bmHideDetails":"Hide details","bmNoCategory":"No category","bmFieldUrl":"URL","bmFieldTags":"Tags","bmFieldShortcut":"Shortcut","bmFieldNote":"Note","bmFieldChecking":"Checking","bmUsage":"Usage","bmUptime7d":"{pct}% up this week","bmNotSaved":"Not saved — retry"}'
```

- [ ] **Step 7: Panel styling**

Append to `static/css/config-bookmarks-workbench.css`:

```css
/* ── Panel ────────────────────────────────────────────────────────────── */

.config-bm-panel {
    position: sticky;
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 0.75rem);
}

.config-bm-panel-toggle {
    align-self: flex-end;
    display: inline-flex;
    gap: var(--space-1, 0.25rem);
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--font-size-small);
    cursor: pointer;
}

.config-bm-workbench.is-panel-collapsed .config-bm-panel {
    padding: var(--space-2, 0.5rem) 0;
    background: none;
    box-shadow: none;
}

.config-bm-workbench.is-panel-collapsed .config-bm-panel-body {
    display: none;
}

.config-bm-workbench.is-panel-collapsed .config-bm-panel-toggle {
    writing-mode: vertical-rl;
    align-self: center;
    color: var(--accent-primary);
}

.config-bm-panel-head {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
}

.config-bm-panel-title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.config-bm-panel-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
}

.config-bm-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.config-bm-field--inline {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2, 0.5rem);
}

.config-bm-field-label,
.config-bm-panel-facts h3 {
    margin: 0;
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-secondary);
}

.config-bm-field .config-text,
.config-bm-field .config-select {
    width: 100%;
    box-sizing: border-box;
}

.config-bm-field-status:empty {
    display: none;
}

.config-bm-field.is-error .config-text,
.config-bm-field.is-error .config-select {
    border-color: var(--accent-error);
}

.config-bm-field.is-error .config-bm-field-status {
    color: var(--accent-error);
    font-size: var(--font-size-small);
}

.config-bm-panel-facts p {
    margin: 2px 0;
}

.config-bm-panel-muted {
    color: var(--text-secondary);
    font-size: var(--font-size-small);
}

.config-bm-panel-foot {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 0.5rem);
}

.config-bm-panel-foot .config-btn--danger {
    margin-left: auto;
}
```

- [ ] **Step 8: Adapt the existing specs**

In `tests/config-bookmarks-editor.spec.js`:

- Replace `openFirstEditor` with a helper that focuses the first row and presses `e`, then returns `page.locator('#config-bm-panel')`.
- `'the editor carries every field the old detail panel had'` → assert every `[data-bm-field]` name listed in this task's Interfaces is present in the panel.
- `'editing and Save persists the change'` → fill `[data-bm-field="note"]`, press Tab, poll the captured POST.
- `'availability mode reveals the interval only for Monitor'` → delete; the interval stays in the add/edit dialog, which the list no longer opens. Add to the plan's Out-of-scope note in the final report.
- `'a shortcut already used on the same page is flagged'` → covered by the panel spec; delete here.
- URL auto-fill tests → change to the panel's URL field: fill `example.com`, Tab, poll POST for `https://example.com`. The "name never overwritten" test stays with the add dialog (`#config-bm-add`), unchanged.
- `'the editor selects the bookmark's own category'` → panel `[data-bm-field="category"]` has the bookmark's category selected.
- Category/page filter tests (`'filtering by a category…'`, `'the category filter lists only…'`, `'with all pages, category labels…'`, `'a categorised row reads page then category…'`) → use the rail (Task 3 mapping); the crumb assertion becomes the flat-mode `.config-bm-crumb` text `Page › Category` under a non-page sort.

In the other listed specs, replace any `data-feed-action="edit"` / edit-modal flow started from the config list with the panel flow.

- [ ] **Step 9: Run the tests**

```bash
go run scripts/gen-asset-hashes.go
PW_WORKERS=2 npx playwright test tests/config-bookmarks-panel.spec.js tests/config-bookmarks-editor.spec.js tests/config-bookmarks-context-menu.spec.js tests/config-four-fixes.spec.js tests/monitor-visibility-reveal.spec.js tests/config-bookmarks-trash.spec.js tests/config-bookmarks-keyboard.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -40 /tmp/pw.txt
```

Background run. Expected: exit 0.

- [ ] **Step 10: Falsify**

1. In `commitWorkbenchField`, delete the `if (owner) { … return; }` block. The shortcut test fails (a POST happens). Restore.
2. In the failure branch, add `el.value = el.getAttribute('data-original');`. The failed-save test fails. Restore.
3. In `toggleWorkbenchPanel`, delete the `localStorage.setItem` line. The reload test fails. Restore. Regenerate hashes.

- [ ] **Step 11: Commit**

```bash
git add -A static/js static/css locales/en.json internal/app/asset_hashes_gen.go tests CHANGELOG.md
git commit -m "edit bookmarks in the side panel"
```

---
### Task 6: Bulk form in the panel

With two or more rows ticked the panel becomes one form for all of them: place, tags, pins and checking, with *mixed* where the selection disagrees and one *Apply*. The bulk bar goes.

**Files:**
- Modify: `static/js/dashboard/dashboard-config-bookmarks-workbench.js` (bulk render, draft, apply, binding)
- Modify: `static/js/dashboard/dashboard-config.js` — `handleBulkAction`, `afterSelectionChange`, `repaintBookmarksList`, `bindBookmarksListTab`, `renderLegacyBookmarkControls`; delete `renderBulkToolbarSafe`, `repaintBulkToolbar`, `bindBulkToolbar`, `bulkArgsFromToolbar`, `renderBulkOffscreenNotice`
- Modify: `static/js/dashboard/dashboard-config-bookmarks.js` — delete `renderBulkToolbar`
- Modify: `static/js/dashboard/dashboard-config-context-menu.js` — bulk cases
- Modify: `static/css/config-bookmarks-workbench.css`
- Modify: `locales/en.json`
- Create: `tests/config-bookmarks-bulk.spec.js`
- Adapt: `tests/config-bookmarks-editor.spec.js` (bulk tests), `tests/config-bookmarks-filters.spec.js` (selection test), `tests/config-bookmarks-context-menu.spec.js`, `tests/config-tag-suggestions.spec.js`

**Interfaces:**
- Consumes: `bulkMove/bulkTags/bulkStatus/bulkPin` with arguments, `saveBookmarkFields`, `repaintWorkbenchPanel`, `workbenchPanelMode` (Task 5); `BookmarkWorkbenchModel.sharedValue`, `.tagCounts`, `.bulkMutation` (Task 1); `mutateSelected`, `bulkUndo`, `bookmarksFromKeys`, `bulkKnownCategories`, `bulkDelete`, `bulkExportCsv`, `bulkFavicons` (existing).
- Produces:
  - `renderWorkbenchBulkPanel() → string`.
  - `this._bmBulkDraft: { pageId?: string, category?: string, tags?: { mode, list }, pinned?: boolean, checkMode?: string }`, reset whenever the selection set changes.
  - `applyWorkbenchBulk() → Promise<void>`.
  - `focusWorkbenchBulkField(name) → void`, names `page | tags | checkMode`.
  - Bulk markup: `[data-bm-bulk-field="page|category|tagsMode|tags|checkMode"]`, `[data-bm-bulk-pin="true|false"][aria-pressed]`, `[data-bm-bulk-action="apply|export|favicons|delete|clear|keep-visible"]`, `.config-bm-bulk-hidden`, `.config-bm-bulk-tagcounts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/config-bookmarks-bulk.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-rail.spec.js');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

async function capturePosts(page) {
    const posts = [];
    await page.route('**/api/bookmarks?page=*', async (route) => {
        if (route.request().method() === 'POST') {
            posts.push(JSON.parse(route.request().postData() || '[]'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fallback();
    });
    return posts;
}

/** Tick the first `n` rows with the keyboard. */
async function tickRows(page, n) {
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < n; i += 1) {
        await page.keyboard.press('j');
        await page.keyboard.press('x');
    }
    return page.evaluate(() => [...window.dashboardInstance.config.bmSelected]);
}

test.describe('the bulk form', () => {
    test('two ticked rows turn the panel into one form for both', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'bulk');
        await expect(panel).toContainText('2');
        await expect(panel.locator('[data-bm-bulk-action="apply"]')).toBeDisabled();
    });

    test('fields the selection disagrees on read mixed', async ({ page }) => {
        await openBookmarks(page);
        const keys = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const all = c.dash.allBookmarks;
            const a = all[0];
            const b = all.find((x) => x.pinned !== a.pinned) || all[1];
            b.pinned = !a.pinned;
            return [c.bookmarkKey(a), c.bookmarkKey(b)];
        });
        await page.evaluate((ks) => {
            const c = window.dashboardInstance.config;
            ks.forEach((k) => c.bmSelected.add(k));
            c.afterSelectionChange();
        }, keys);
        await expect(page.locator('#config-bm-panel .config-bm-bulk-pinned')).toContainText(/mixed|1 of 2/i);
    });

    test('adding a tag changes only the tags of the ticked rows', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const keys = await tickRows(page, 2);
        const before = await page.evaluate((ks) => ks.map((k) => {
            const b = window.dashboardInstance.config.findBookmarkByKey(k);
            return { url: b.url, pinned: Boolean(b.pinned), name: b.name };
        }), keys);

        await page.fill('#config-bm-panel [data-bm-bulk-field="tags"]', 'bulkadded');
        await page.click('#config-bm-panel [data-bm-bulk-action="apply"]');

        await expect.poll(() => posts.length).toBeGreaterThan(0);
        const written = posts.flat();
        for (const b of before) {
            const row = written.find((w) => w.url === b.url);
            expect(row, `${b.url} was written`).toBeTruthy();
            expect(row.tags).toContain('bulkadded');
            expect(Boolean(row.pinned)).toBe(b.pinned);
            expect(row.name).toBe(b.name);
        }
        const untouched = written.filter((w) => !before.some((b) => b.url === w.url));
        expect(untouched.every((w) => !(w.tags || []).includes('bulkadded'))).toBe(true);
    });

    test('pin all pins every ticked row', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const keys = await tickRows(page, 2);
        const urls = await page.evaluate((ks) => ks.map((k) =>
            window.dashboardInstance.config.findBookmarkByKey(k).url), keys);
        await page.click('#config-bm-panel [data-bm-bulk-pin="true"]');
        await expect(page.locator('#config-bm-panel [data-bm-bulk-pin="true"]')).toHaveAttribute('aria-pressed', 'true');
        await page.click('#config-bm-panel [data-bm-bulk-action="apply"]');
        await expect.poll(() => posts.length).toBeGreaterThan(0);
        for (const url of urls) {
            expect(posts.flat().find((w) => w.url === url).pinned).toBe(true);
        }
    });

    test('the form says how many ticked rows the filter hides', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        await page.fill('#config-bm-search', 'zzzznothingmatches');
        await expect(page.locator('#config-bm-panel .config-bm-bulk-hidden')).toContainText('2');
    });

    test('Tag selected in the right-click menu goes to the tags field', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        await page.locator('#config-bm-list .config-bm-row.is-checked').first().click({ button: 'right' });
        await page.getByText(/Tag 2 selected/).click();
        await expect(page.locator('#config-bm-panel [data-bm-bulk-field="tags"]')).toBeFocused();
    });

    test('the bulk bar is gone', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        await expect(page.locator('.config-bulk-bar, #config-bm-bulk')).toHaveCount(0);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-bulk.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt`
Expected: FAIL — panel stays `single`/`empty`, bulk bar present.

- [ ] **Step 3: The bulk form**

Add to `dashboard-config-bookmarks-workbench.js`:

```js
    bulkDraft() {
        const sig = [...this.bmSelected].sort().join('\n');
        if (this._bmBulkDraftSig !== sig) {
            this._bmBulkDraftSig = sig;
            this._bmBulkDraft = {};
        }
        return this._bmBulkDraft;
    },

    renderWorkbenchBulkPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const M = global.BookmarkWorkbenchModel;
        const picked = this.bookmarksFromKeys([...this.bmSelected]);
        const n = picked.length;
        const draft = this.bulkDraft();
        const mixed = esc(this.t('config.bmMixed', 'mixed'));

        const page = M.sharedValue(picked.map((b) => String(b.pageId)));
        const pageValue = draft.pageId ?? (page.mixed ? '' : page.value);
        const pageOptions = [`<option value="">${mixed}</option>`]
            .concat((this.dash.pages || []).map((p) =>
                `<option value="${esc(p.id)}"${String(p.id) === String(pageValue) ? ' selected' : ''}>${esc(p.name || p.id)}</option>`))
            .join('');

        const cat = M.sharedValue(picked.map((b) => b.category || ''));
        const catValue = draft.category ?? (cat.mixed ? null : cat.value);
        const catScope = draft.pageId ? [{ pageId: draft.pageId }] : picked;
        const catOptions = [`<option value="__keep__"${catValue === null ? ' selected' : ''}>${mixed}</option>`,
            `<option value=""${catValue === '' ? ' selected' : ''}>${esc(this.t('config.bmNoCategory', 'No category'))}</option>`]
            .concat(this.bulkKnownCategories(catScope).map((c) => {
                const id = global.DashboardConfig.parseCategoryFilter(c.id).categoryId;
                return `<option value="${esc(id)}"${id === catValue ? ' selected' : ''}>${esc(c.label)}</option>`;
            }))
            .join('');

        const tagCounts = M.tagCounts(picked)
            .map(([t, k]) => `<span class="config-bm-tag">${esc(t)} <span class="config-bm-rail-count">${k}</span></span>`)
            .join('');
        const tagsMode = draft.tags?.mode || 'add';
        const modeButtons = [
            ['add', this.t('config.bulkTagsAdd', 'Add')],
            ['replace', this.t('config.bulkTagsReplace', 'Replace')],
            ['remove', this.t('config.bulkTagsRemove', 'Remove')],
        ].map(([v, l]) => `<button type="button" data-bm-bulk-field="tagsMode" data-value="${v}"
                aria-pressed="${tagsMode === v ? 'true' : 'false'}">${esc(l)}</button>`).join('');

        const pinnedCount = picked.filter((b) => b.pinned === true).length;
        const pinSummary = pinnedCount === 0 || pinnedCount === n
            ? this.t(pinnedCount ? 'config.bmAllPinned' : 'config.bmNonePinned', pinnedCount ? 'all pinned' : 'none pinned')
            : this.t('config.bmSomePinned', '{k} of {n} pinned').replace('{k}', String(pinnedCount)).replace('{n}', String(n));

        const modeShared = M.sharedValue(picked.map((b) => global.CheckMode?.of?.(b) || 'off'));
        const modeValue = draft.checkMode ?? (modeShared.mixed ? '' : modeShared.value);
        const modeOptions = [`<option value="">${mixed}</option>`]
            .concat((global.CheckMode?.options?.() || []).map((o) =>
                `<option value="${esc(o.mode)}"${o.mode === modeValue ? ' selected' : ''}>${esc(o.label)}</option>`))
            .join('');

        const hidden = this.hiddenSelectionCount();
        const states = picked.reduce((acc, b) => {
            const s = this.bookmarkHealthState(b);
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, {});
        const health = global.DashboardConfig.HEALTH_FILTERS.filter((k) => states[k])
            .map((k) => `<span><span class="config-bm-health-dot is-${k}"></span> ${states[k]} ${esc(this.railHealthLabel(k).toLowerCase())}</span>`)
            .join(' · ');
        const dirty = Object.keys(draft).length > 0;
        const field = (label, control, cls = '') => `
            <div class="config-bm-field ${cls}">
                <span class="config-bm-field-label">${esc(label)}</span>
                ${control}
            </div>`;

        return `
            <header class="config-bm-panel-head">
                <span class="config-bm-panel-title">${esc(this.t('config.bmBulkTitle', '{n} bookmarks').replace('{n}', String(n)))}</span>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="clear">${esc(this.t('config.bulkClearSelection', 'Clear selection'))}</button>
            </header>
            ${hidden ? `<p class="config-bm-bulk-hidden">${esc(this.t('config.bmHiddenByFilter', '{n} hidden by the filter — still included').replace('{n}', String(hidden)))}
                <button type="button" class="config-bm-rail-more" data-bm-bulk-action="keep-visible">${esc(this.t('config.bulkKeepVisible', 'Select only these'))}</button></p>` : ''}
            <div class="config-bm-panel-fields">
                ${field(this.t('config.page', 'Page'), `<select class="config-select" data-bm-bulk-field="page">${pageOptions}</select>`)}
                ${field(this.t('config.category', 'Category'), `<select class="config-select" data-bm-bulk-field="category">${catOptions}</select>`)}
                ${field(this.t('config.bmFieldTags', 'Tags'), `
                    <div class="config-bm-bulk-tagcounts">${tagCounts || `<span class="config-bm-panel-muted">${esc(this.t('config.bmNoTags', 'no tags'))}</span>`}</div>
                    <div class="config-bm-segmented" role="group">${modeButtons}</div>
                    <input type="text" class="config-text" data-bm-bulk-field="tags"
                           value="${esc((draft.tags?.list || []).join(', '))}"
                           placeholder="${esc(this.t('config.detailTagsPlaceholder', 'work, dev, personal…'))}">`)}
                ${field(this.t('config.pinnedShort', 'Pinned'), `
                    <span class="config-bm-panel-muted">${esc(pinSummary)}</span>
                    <span class="config-bm-segmented" role="group">
                        <button type="button" data-bm-bulk-pin="true" aria-pressed="${draft.pinned === true}">${esc(this.t('config.bmPinAll', 'Pin all'))}</button>
                        <button type="button" data-bm-bulk-pin="false" aria-pressed="${draft.pinned === false}">${esc(this.t('config.bmUnpinAll', 'Unpin all'))}</button>
                    </span>`, 'config-bm-bulk-pinned')}
                ${field(this.t('config.bmFieldChecking', 'Checking'), `<select class="config-select" data-bm-bulk-field="checkMode">${modeOptions}</select>`)}
            </div>
            ${health ? `<section class="config-bm-panel-facts"><h3>${esc(this.t('config.bmHealth', 'Health'))}</h3><p>${health}</p></section>` : ''}
            <footer class="config-bm-panel-foot">
                <button type="button" class="config-btn config-btn--primary config-btn--small" data-bm-bulk-action="apply"${dirty ? '' : ' disabled'}>${esc(this.t('config.bmApplyTo', 'Apply to {n}').replace('{n}', String(n)))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="export">${esc(this.t('config.bulkExportCsv', 'Export CSV'))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="favicons">${esc(this.t('config.bulkRefreshFavicons', 'Refresh favicons'))}</button>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-bulk-action="delete">${esc(this.t('config.bmDeleteN', 'Delete {n}').replace('{n}', String(n)))}</button>
            </footer>`;
    },

    /** Record one bulk control into the draft; returns true when the panel must redraw. */
    readBulkControl(el) {
        const draft = this.bulkDraft();
        const name = el.getAttribute('data-bm-bulk-field');
        if (name === 'page') {
            if (el.value) draft.pageId = el.value; else delete draft.pageId;
            return true;
        }
        if (name === 'category') {
            if (el.value === '__keep__') delete draft.category; else draft.category = el.value;
            return false;
        }
        if (name === 'checkMode') {
            if (el.value) draft.checkMode = el.value; else delete draft.checkMode;
            return false;
        }
        if (name === 'tags' || name === 'tagsMode') {
            const mode = name === 'tagsMode' ? el.getAttribute('data-value') : (draft.tags?.mode || 'add');
            const input = el.closest('#config-bm-panel').querySelector('[data-bm-bulk-field="tags"]');
            const list = String(input?.value || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
            if (list.length || mode === 'replace') draft.tags = { mode, list }; else delete draft.tags;
            return name === 'tagsMode';
        }
        return false;
    },

    syncBulkApply() {
        const btn = document.querySelector('#config-bm-panel [data-bm-bulk-action="apply"]');
        if (btn) btn.disabled = Object.keys(this.bulkDraft()).length === 0;
    },

    redrawBulkPanel() {
        const panel = document.getElementById('config-bm-panel');
        if (!panel) return;
        const focused = document.activeElement?.getAttribute?.('data-bm-bulk-field');
        panel.dataset.bmPanelSig = '';
        this.repaintWorkbenchPanel();
        if (focused) panel.querySelector(`[data-bm-bulk-field="${focused}"]`)?.focus();
    },

    async applyWorkbenchBulk() {
        const keys = [...this.bmSelected];
        const picked = this.bookmarksFromKeys(keys);
        const draft = { ...this.bulkDraft() };
        if (!picked.length || !Object.keys(draft).length) return;
        const { pageId, ...rest } = draft;
        const moving = pageId && picked.some((b) => String(b.pageId) !== String(pageId));
        // A category travels with the move when there is one; otherwise it is
        // an in-place edit like the rest.
        const inPlace = { ...rest };
        if (moving) delete inPlace.category;
        const assign = (b, mode) => {
            b.monitorIntervalMinutes = global.CheckMode.intervalOf?.(b)
                || Number(this.dash?.settings?.defaultMonitorIntervalMinutes) || 15;
            global.CheckMode.assign(b, mode);
        };
        try {
            if (Object.keys(inPlace).length) {
                if (inPlace.category) {
                    for (const pid of new Set(picked.map((b) => String(b.pageId)))) {
                        await this.ensureCategoryOnPage(pid, inPlace.category);
                    }
                }
                const snapshots = await this.mutateSelected(picked,
                    global.BookmarkWorkbenchModel.bulkMutation(inPlace, assign));
                this.notify(this.t('config.bmBulkDone', 'Bookmarks updated.'), 'success', {
                    undoCallback: this.bulkUndo(snapshots, 'config.bmBulkUndone', 'Changes put back.',
                        'config.bulkUndoFailed', 'Could not undo that.'),
                    duration: 8000,
                });
            }
            if (moving) {
                // In-place edits never change a key (page and URL stay), so the
                // same keys still find the same bookmarks after that refresh.
                await this.bulkMove(this.bookmarksFromKeys(keys), { pageId, category: rest.category || '' });
            }
        } catch {
            this.notify(this.t('config.bulkActionError', 'Could not apply the bulk action.'), 'error');
            await this.refreshBookmarksAfterWrite();
        }
        this._bmBulkDraft = {};
        this.afterSelectionChange();
    },

    focusWorkbenchBulkField(name) {
        this.toggleWorkbenchPanel(false, { remember: false });
        this.redrawBulkPanel();
        document.querySelector(`#config-bm-panel [data-bm-bulk-field="${name}"]`)?.focus();
    },

    bindWorkbenchBulk(panel) {
        if (!panel || panel.dataset.bmBulkWired === '1') return;
        panel.dataset.bmBulkWired = '1';
        panel.addEventListener('click', (e) => {
            if (panel.dataset.bmPanelMode !== 'bulk') return;
            const pin = e.target.closest('[data-bm-bulk-pin]');
            if (pin) {
                const draft = this.bulkDraft();
                const want = pin.getAttribute('data-bm-bulk-pin') === 'true';
                if (draft.pinned === want) delete draft.pinned; else draft.pinned = want;
                this.redrawBulkPanel();
                return;
            }
            const mode = e.target.closest('[data-bm-bulk-field="tagsMode"]');
            if (mode) {
                this.readBulkControl(mode);
                this.redrawBulkPanel();
                return;
            }
            const action = e.target.closest('[data-bm-bulk-action]')?.getAttribute('data-bm-bulk-action');
            if (!action) return;
            if (action === 'apply') void this.applyWorkbenchBulk();
            else void this.handleBulkAction(action).then(() => this.afterSelectionChange());
        });
        panel.addEventListener('change', (e) => {
            const el = e.target.closest('[data-bm-bulk-field]');
            if (!el || panel.dataset.bmPanelMode !== 'bulk') return;
            if (this.readBulkControl(el)) this.redrawBulkPanel();
            else this.syncBulkApply();
        });
        panel.addEventListener('input', (e) => {
            const el = e.target.closest('[data-bm-bulk-field="tags"]');
            if (!el || panel.dataset.bmPanelMode !== 'bulk') return;
            this.readBulkControl(el);
            this.syncBulkApply();
        });
        panel.addEventListener('keydown', (e) => {
            const el = e.target.closest('[data-bm-bulk-field="tags"]');
            if (!el) return;
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.applyWorkbenchBulk();
            }
        });
    },
```

In `bindWorkbench`, after `this.bindWorkbenchPanel(panel);` add `this.bindWorkbenchBulk(panel);`.

`handleBookmarkMenuAction`-style actions reuse `handleBulkAction`, whose `export`, `favicons`, `delete`, `clear` and `keep-visible` branches already exist.

In `repaintWorkbenchPanel`, the bulk sig already includes the selection; add the draft so a draft change redraws when asked: replace the `sig` line's bulk part with `[...this.bmSelected].sort().join(',') + JSON.stringify(this._bmBulkDraft || {})`.

Add strings:

```bash
# the File Map locale helper, with:
node -e "$LOCALE_HELPER" '{"bmMixed":"mixed","bmNoTags":"no tags","bmAllPinned":"all pinned","bmNonePinned":"none pinned","bmSomePinned":"{k} of {n} pinned","bmPinAll":"Pin all","bmUnpinAll":"Unpin all","bmBulkTitle":"{n} bookmarks","bmHiddenByFilter":"{n} hidden by the filter — still included","bmApplyTo":"Apply to {n}","bmDeleteN":"Delete {n}","bmBulkDone":"Bookmarks updated.","bmBulkUndone":"Changes put back."}'
```

- [ ] **Step 4: Remove the bulk bar**

In `dashboard-config.js`:
- `handleBulkAction`: delete the `move`, `tags` and `status` branches.
- Delete `renderBulkToolbarSafe`, `repaintBulkToolbar`, `bindBulkToolbar`, `bulkArgsFromToolbar`, `renderBulkOffscreenNotice`, `renderLegacyBookmarkControls`.
- Remove the calls: `this.repaintBulkToolbar()` in `repaintBookmarksList` and `afterSelectionChange`; `this.bindBulkToolbar(container)` in `bindBookmarksListTab`.

In the Escape handler, directly before `if (this._bmKeyboardKey) {`, add the spec's order (selection, then filters, then the cursor, then the view):

```js
            if (this.section === 'bookmarks' && this.bmSelected.size) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.bmSelected.clear();
                this.afterSelectionChange();
                return;
            }
            if (this.section === 'bookmarks' && this.bookmarksFiltersActive()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.clearBookmarkFilters();
                return;
            }
```

Add to `tests/config-bookmarks-bulk.spec.js`:

```js
    test('Escape clears the selection first, then the filters', async ({ page }) => {
        await openBookmarks(page);
        await page.fill('#config-bm-search', 'a');
        await page.locator('#config-bm-search').blur();
        await tickRows(page, 2);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(0);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmQuery)).toBe('');
        await expect(page.locator('#config-bm-list')).toBeVisible();
    });
```

Existing specs that expect one Escape to leave config with filters on (`grep -n "Escape" tests/config-*.spec.js`) now need a second press; update them.

In `dashboard-config-bookmarks-workbench.js`, delete `${this.renderLegacyBookmarkControls()}` from `renderBookmarksWorkbench`.

In `dashboard-config-bookmarks.js`, delete `renderBulkToolbar`.

`grep -n "renderBulkToolbar\|repaintBulkToolbar\|bindBulkToolbar\|bulkArgsFromToolbar\|renderBulkOffscreenNotice\|renderLegacyBookmarkControls\|config-bulk-" static/js` → only CSS hits remain (removed in Task 8).

In `dashboard-config-context-menu.js`, replace the grouped bulk cases with:

```js
            case 'bulk-move':
                c.focusWorkbenchBulkField('page');
                break;
            case 'bulk-tags':
                c.focusWorkbenchBulkField('tags');
                break;
            case 'bulk-status':
                c.focusWorkbenchBulkField('checkMode');
                break;
            case 'bulk-pin':
            case 'bulk-export':
            case 'bulk-delete':
            case 'clear':
                await c.handleBulkAction(action.replace(/^bulk-/, ''));
                c.afterSelectionChange();
                break;
```

and in `case 'select':` replace `c.repaintBookmarksList();` with `c.afterSelectionChange();`.

- [ ] **Step 5: Bulk styling**

Append to `static/css/config-bookmarks-workbench.css`:

```css
/* ── Bulk form ────────────────────────────────────────────────────────── */

.config-bm-segmented {
    display: inline-flex;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-4, 6px);
    overflow: hidden;
    align-self: flex-start;
}

.config-bm-segmented button {
    border: 0;
    padding: 2px 8px;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-small);
    cursor: pointer;
}

.config-bm-segmented button[aria-pressed="true"] {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
}

.config-bm-bulk-tagcounts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 0.25rem);
}

.config-bm-bulk-hidden {
    margin: 0;
    color: var(--accent-warning);
    font-size: var(--font-size-small);
}

.config-bm-panel-foot .config-btn--primary:disabled {
    opacity: 0.5;
    cursor: default;
}
```

- [ ] **Step 6: Adapt the existing specs**

- `tests/config-bookmarks-editor.spec.js`: `'ticking rows reveals the bulk toolbar with every action'` → tick two rows, assert the panel is in `bulk` mode and shows `apply`, `export`, `favicons`, `delete`, `clear`. `'bulk tags posts the tag onto every ticked bookmark'` → fill `[data-bm-bulk-field="tags"]`, click apply. `'bulk-moving to another page carries the category into its list'` → choose page and category in the bulk form, apply.
- `tests/config-bookmarks-filters.spec.js`: the selection test's `hiddenSelectionCount()` assertion stays; add `await expect(page.locator('#config-bm-panel .config-bm-bulk-hidden')).toBeVisible()` only when two rows are ticked (with one ticked the panel is in single mode).
- `tests/config-bookmarks-context-menu.spec.js` and `tests/config-tag-suggestions.spec.js`: replace `.config-bulk-bar` / `[data-bulk=…]` with the bulk form equivalents.

- [ ] **Step 7: Run the tests**

```bash
go run scripts/gen-asset-hashes.go
npm run test:workbench-model
PW_WORKERS=2 npx playwright test tests/config-bookmarks-bulk.spec.js tests/config-bookmarks-editor.spec.js tests/config-bookmarks-filters.spec.js tests/config-bookmarks-context-menu.spec.js tests/config-tag-suggestions.spec.js tests/config-bookmarks-panel.spec.js tests/config-bookmarks-grouping.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -40 /tmp/pw.txt
```

Background run. Expected: exit 0.

- [ ] **Step 8: Falsify**

1. In `bulkMutation` usage, pass `{ ...inPlace, pinned: true }`. The tag test fails on `pinned`. Restore.
2. In `workbenchPanelMode`, change `> 1` to `> 2`. The two-rows test fails. Restore.
3. In `hiddenSelectionCount` usage, drop the `.config-bm-bulk-hidden` paragraph. The hidden test fails. Restore. Regenerate hashes.

- [ ] **Step 9: Commit**

```bash
git add -A static/js static/css locales/en.json internal/app/asset_hashes_gen.go tests CHANGELOG.md
git commit -m "edit a selection of bookmarks in the side panel"
```

---
### Task 7: Narrow widths

Below 1200px the panel is a drawer over the list; below 800px the rail is a sheet behind a *Filters (n)* button. Both lock page scroll through `ScrollLock` and close on Escape or the scrim.

**Files:**
- Modify: `static/js/dashboard/dashboard-config-bookmarks-workbench.js`
- Modify: `static/js/dashboard/dashboard-config.js` — Escape handler (≈1015), `closeConfigView` (≈880)
- Modify: `static/css/config-bookmarks-workbench.css`
- Modify: `locales/en.json`
- Create: `tests/config-bookmarks-narrow.spec.js`

**Interfaces:**
- Consumes: `focusWorkbenchPanel`, `repaintWorkbenchPanel`, `bookmarksFiltersActive` (earlier tasks).
- Produces:
  - `workbenchNarrow() → boolean` (`max-width: 1199px`), `workbenchPhone() → boolean` (`max-width: 799px`).
  - `openWorkbenchOverlay(kind)` with `kind` `'drawer' | 'sheet'`; `closeWorkbenchOverlays() → boolean` (true when something was open).
  - Classes on `#config-bm-workbench`: `is-drawer-open`, `is-sheet-open`. Scrim `[data-bm-scrim]`. Toolbar buttons `[data-bm-open-sheet]`, `[data-bm-open-drawer]`.
  - ScrollLock owner tokens `bm-drawer`, `bm-sheet`.

- [ ] **Step 1: Write the failing tests**

Create `tests/config-bookmarks-narrow.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarks } = require('./config-bookmarks-rail.spec.js');

const locked = (page) => page.evaluate(() => window.ScrollLock.holders.size);

test.describe('the workbench on a narrow screen', () => {
    test('below 1200px the panel is a drawer that e opens and Escape closes', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toBeHidden();
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(panel).toBeVisible();
        await expect(page.locator('[data-bm-scrim]')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
        await page.locator('#config-bm-panel [data-bm-field="name"]').blur();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        expect(await locked(page)).toBe(0);
        // Escape closed the drawer, not the view.
        await expect(page.locator('#config-bm-list')).toBeVisible();
    });

    test('below 800px the rail is a sheet behind a Filters button', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 800 });
        await openBookmarks(page);
        await expect(page.locator('#config-bm-rail')).toBeHidden();
        await page.click('[data-bm-open-sheet]');
        await expect(page.locator('#config-bm-rail')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
        await page.click('[data-bm-scrim]', { position: { x: 5, y: 5 } });
        await expect(page.locator('#config-bm-rail')).toBeHidden();
        expect(await locked(page)).toBe(0);
    });

    test('the Filters button counts what is on', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 800 });
        await openBookmarks(page);
        await page.click('[data-bm-open-sheet]');
        await page.locator('#config-bm-rail [data-bm-rail="page"]').first().click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bm-open-sheet]')).toContainText('1');
    });

    test('leaving config releases the lock', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.click('[data-bm-open-drawer]');
        expect(await locked(page)).toBeGreaterThan(0);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => locked(page)).toBe(0);
    });
});
```

`ScrollLock.holders` is the Set the class keeps (`static/js/scroll-lock.js`); if it is private under another name, read the file and use its public count.

- [ ] **Step 2: Run to verify they fail**

Run: `PW_WORKERS=2 npx playwright test tests/config-bookmarks-narrow.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt`
Expected: FAIL — the panel is visible at 1000px.

- [ ] **Step 3: Overlay logic**

Add to `dashboard-config-bookmarks-workbench.js`:

```js
    workbenchNarrow() {
        return Boolean(global.matchMedia?.('(max-width: 1199px)').matches);
    },

    workbenchPhone() {
        return Boolean(global.matchMedia?.('(max-width: 799px)').matches);
    },

    openWorkbenchOverlay(kind) {
        const root = document.getElementById('config-bm-workbench');
        if (!root) return;
        this.closeWorkbenchOverlays();
        root.classList.add(kind === 'sheet' ? 'is-sheet-open' : 'is-drawer-open');
        const scrim = root.querySelector('[data-bm-scrim]');
        if (scrim) scrim.hidden = false;
        this._bmOverlayLock = global.ScrollLock?.acquire?.(kind === 'sheet' ? 'bm-sheet' : 'bm-drawer') || null;
    },

    closeWorkbenchOverlays() {
        const root = document.getElementById('config-bm-workbench');
        const wasOpen = Boolean(root?.classList.contains('is-drawer-open') || root?.classList.contains('is-sheet-open'));
        root?.classList.remove('is-drawer-open', 'is-sheet-open');
        const scrim = root?.querySelector('[data-bm-scrim]');
        if (scrim) scrim.hidden = true;
        if (this._bmOverlayLock) {
            global.ScrollLock?.release?.(this._bmOverlayLock);
            this._bmOverlayLock = null;
        }
        if (wasOpen) this.syncWorkbenchToolbar();
        return wasOpen;
    },

    renderWorkbenchNarrowButtons() {
        const esc = (v) => this.dash.escapeHtml(v);
        const active = [this.bmQuery, this.bmPageFilter, this.bmCategoryFilter, this.bmCleanupFilter, this.bmHealthFilter]
            .filter((v) => String(v || '').trim()).length + this.bookmarkTagFilters().length;
        const n = this.bmSelected.size;
        return `
            <button type="button" class="config-btn config-btn--small config-bm-narrow-only config-bm-phone-only" data-bm-open-sheet>${esc(
                this.t('config.bmFilters', 'Filters'))}${active ? ` (${active})` : ''}</button>
            <button type="button" class="config-btn config-btn--small config-bm-narrow-only" data-bm-open-drawer>${esc(
                this.t('config.bmDetails', 'Details'))}${n > 1 ? ` (${n})` : ''}</button>`;
    },

    syncWorkbenchToolbar() {
        const host = document.getElementById('config-bm-narrow-buttons');
        if (host) host.innerHTML = this.renderWorkbenchNarrowButtons();
    },
```

In `renderBookmarksWorkbench`, inside `.config-bm-toolbar` right after the count spans add:

```js
                        <span id="config-bm-narrow-buttons" class="config-bm-narrow-buttons">${this.renderWorkbenchNarrowButtons()}</span>
```

and as the last child of `#config-bm-workbench`:

```js
                <div class="config-bm-scrim" data-bm-scrim hidden></div>
```

In `focusWorkbenchPanel(key)`, replace `this.toggleWorkbenchPanel(false, { remember: false });` with:

```js
        if (this.workbenchNarrow()) this.openWorkbenchOverlay('drawer');
        else this.toggleWorkbenchPanel(false, { remember: false });
```

In `repaintWorkbenchPanel`, change the bulk line to:

```js
        if (mode === 'bulk' && !this.workbenchNarrow()) this.toggleWorkbenchPanel(false, { remember: false });
        this.syncWorkbenchToolbar();
```

In `focusWorkbenchBulkField`, apply the same narrow branch as `focusWorkbenchPanel`.

In `updateBookmarkListChrome` (dashboard-config.js), after `this.repaintWorkbenchRail?.();` add `this.syncWorkbenchToolbar?.();`.

Extend `bindWorkbench(container)` — first line:

```js
        this.closeWorkbenchOverlays();
```

and at the end:

```js
        const root = container.querySelector('#config-bm-workbench');
        if (root && root.dataset.bmOverlayWired !== '1') {
            root.dataset.bmOverlayWired = '1';
            root.addEventListener('click', (e) => {
                if (e.target.closest('[data-bm-scrim]')) this.closeWorkbenchOverlays();
                else if (e.target.closest('[data-bm-open-sheet]')) this.openWorkbenchOverlay('sheet');
                else if (e.target.closest('[data-bm-open-drawer]')) {
                    this.openWorkbenchOverlay('drawer');
                    this.repaintWorkbenchPanel();
                }
            });
        }
```

In `dashboard-config.js`:
- Escape handler: directly before `if (this.handleBookmarkMenuKeys?.(e)) return;` add:

```js
            if (this.closeWorkbenchOverlays?.()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
```

  and change the panel guard added in Task 5 to let Escape through when the field is inside an open drawer only after the field itself handled it — the field's own keydown handler (Task 5) runs in the bubble phase after this capture handler returns, so leave the guard as is; the test blurs the field before pressing Escape.
- `closeConfigView()`: first line `this.closeWorkbenchOverlays?.();`.

Add `{"bmFilters":"Filters","bmDetails":"Details"}` (already present from Task 2 — the helper skips existing keys).

- [ ] **Step 4: Narrow styling**

Append to `static/css/config-bookmarks-workbench.css`:

```css
/* ── Narrow widths ────────────────────────────────────────────────────── */

.config-bm-narrow-buttons {
    display: contents;
}

.config-bm-narrow-only,
.config-bm-scrim {
    display: none;
}

@media (max-width: 1199px) {
    .config-bm-workbench,
    .config-bm-workbench.is-panel-collapsed {
        grid-template-columns: var(--bm-rail-w) minmax(0, 1fr);
    }

    .config-bm-narrow-only:not(.config-bm-phone-only) {
        display: inline-flex;
    }

    .config-bm-panel {
        display: none;
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(420px, 100vw);
        max-height: none;
        border-radius: 0;
        z-index: 1200;
        overflow: auto;
    }

    .config-bm-workbench.is-drawer-open .config-bm-panel {
        display: flex;
    }

    .config-bm-workbench.is-panel-collapsed .config-bm-panel-body {
        display: block;
    }

    .config-bm-panel-toggle {
        display: none;
    }

    .config-bm-scrim:not([hidden]) {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 1100;
        background: color-mix(in srgb, var(--background-primary) 60%, transparent);
    }
}

@media (max-width: 799px) {
    .config-bm-workbench,
    .config-bm-workbench.is-panel-collapsed {
        grid-template-columns: minmax(0, 1fr);
    }

    .config-bm-narrow-only.config-bm-phone-only {
        display: inline-flex;
    }

    .config-bm-rail {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: min(320px, 100vw);
        max-height: none;
        padding: var(--space-3, 0.75rem);
        background: var(--surface-3, var(--background-secondary));
        z-index: 1200;
        overflow: auto;
    }

    .config-bm-workbench.is-sheet-open .config-bm-rail {
        display: flex;
    }

    .config-bm-row {
        grid-template-columns: 16px 18px minmax(0, 1fr) 3rem;
    }

    .config-bm-tags,
    .config-bm-opens,
    .config-bm-last {
        display: none;
    }
}
```

- [ ] **Step 5: Run the tests**

```bash
go run scripts/gen-asset-hashes.go
PW_WORKERS=2 npx playwright test tests/config-bookmarks-narrow.spec.js tests/config-bookmarks-panel.spec.js tests/config-bookmarks-rail.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -30 /tmp/pw.txt
```

Background run. Expected: exit 0.

- [ ] **Step 6: Falsify**

1. In `closeWorkbenchOverlays`, delete the `ScrollLock.release` call. The drawer test fails on the lock count. Restore.
2. In the Escape handler, delete the `closeWorkbenchOverlays` branch. The drawer test fails (the view closes). Restore. Regenerate hashes.

- [ ] **Step 7: Commit**

```bash
git add -A static/js static/css locales/en.json internal/app/asset_hashes_gen.go tests CHANGELOG.md
git commit -m "fold the bookmark workbench into a drawer and a sheet on narrow screens"
```

---

### Task 8: Remove what the workbench replaced, and check it by hand

**Files:**
- Modify: `static/css/config-view.css`
- Modify: `static/js/dashboard/dashboard-config-bookmarks.js`
- Modify: `static/js/dashboard/dashboard-config.js`
- Adapt: `tests/view-visual-alignment.spec.js`, `tests/config-keyboard-legend-style.spec.js`, `tests/config-view-performance.spec.js`

**Interfaces:**
- Consumes: everything above.
- Produces: no new names. After this task, these return nothing:

```bash
grep -n "renderBookmarkRowActions\|renderBookmarkPlaceCrumb\|bookmarksSummaryTiles(this.bookmarksFiltersActive\|config-bm-inline\|config-bulk-\|config-cleanup-banner\|config-bm-quickbar\|config-bm-cloud\|config-bm-filter-chip\|config-bm-tiles\|config-bm-meta-\|config-bm-usage\|config-bm-actions\|config-bm-action-btn\|config-bm-shortcut-pill\|config-bm-tag-chip\|config-bm-tag-row\|config-bm-crumb-" static/js static/css
```

- [ ] **Step 1: Delete the dead JS**

In `dashboard-config-bookmarks.js`, delete `renderBookmarkRowActions` and `renderBookmarkPlaceCrumb` (check `grep -n "renderBookmarkPlaceCrumb" static/js` first — Task 4 removed its only caller). Update the file's top comment: it now holds the usage tooltip, the count label and the empty reason; the list is in `dashboard-config-bookmarks-workbench.js`.

In `dashboard-config.js`, delete any method whose only callers were removed: check each of `toggleBookmarkMenu`, `fillBookmarkMenu`, `closeBookmarkMenus`, `handleBookmarkMenuKeys`, `renderBookmarkCountLabelSafe`, `selectAllBookmarksLabel`, `toggleSelectAllBookmarks`, `filterBookmarksByTag`, `filterBookmarksByCategory`, `filterBookmarksByPage` with `grep -n "<name>(" static/js`. Keep a method if anything outside its own definition still calls it (the context menu calls the three `filterBookmarksBy*`, so those stay).

- [ ] **Step 2: Delete the dead CSS**

For each selector family in the grep above, delete its rules from `static/css/config-view.css` (the line ranges in the spec — tiles 367–600 where List-only, legend duplicate at 5035, row 3868–4004, fallback actions 4005–4065, feed overrides/crumb/footer/usage 4111–4253, hint/meta/chips 4254–4310, cloud 4311–4419, chip/pin/badge 4420–4472, load/hover/row 4473–4525, bulk 4526–4576, banner 4641–4670, usage 4671–4685, inline edit 5488–5560, quick bar 5692–5714). Line numbers have moved since the spec; find each block by selector, not by number.

Keep: `.config-bm-keyboard-legend` (one copy), `.config-bm-spacer`, `.config-bm-load-sentinel`, `.config-bm-load-hint`, `.config-bm-duplicate-badge`, `.config-bm-pin`, `.config-bm-subtabs` and anything the Tags, Tag suggestions, Tag rules, Settings or Local copies subtabs use (`grep -n "<selector>" static/js/dashboard/dashboard-config.js` must show only List-tab code before a rule goes).

- [ ] **Step 3: Run the specs that read styles or structure**

```bash
go run scripts/gen-asset-hashes.go
npm run test:workbench-model
PW_WORKERS=2 npx playwright test tests/view-visual-alignment.spec.js tests/config-keyboard-legend-style.spec.js tests/config-view-performance.spec.js tests/config-bookmarks-rail.spec.js tests/config-bookmarks-grouping.spec.js tests/config-bookmarks-panel.spec.js tests/config-bookmarks-bulk.spec.js tests/config-bookmarks-narrow.spec.js tests/config-bookmarks-tabs.spec.js > /tmp/pw.txt 2>&1; echo "exit $?"; tail -40 /tmp/pw.txt
```

Background run. Expected: exit 0. A failure in `view-visual-alignment` that measures the old row → update it to measure `.config-bm-row` height `44`.

This is cleanup, not new behaviour: no falsification step.

- [ ] **Step 4: Check it by hand**

1. Ask Jordi for the path of a copy of the real data directory if it is not already known, then:
   `NEXTDASH_DATA_DIR=<copy> PORT=8099 go run .` with `run_in_background`.
2. In Chrome at `http://localhost:8099/#config/bookmarks`, on a glass, a rich and a flat theme:
   - rail counts add up (All = total; a page's count matches the list after clicking it);
   - slabs under Page order, crumbs under Most opened;
   - `j`/`k` scroll a long list without the cursor leaving the screen; group headers do not jump;
   - edit a name, a URL and a page in the panel; the panel follows the bookmark;
   - tick three rows, add a tag, Apply, Undo from the toast;
   - resize to 1000px and 700px: drawer and sheet open, close, and the page scrolls again afterwards.
3. Repeat the panel edit and the bulk Apply in Safari (hit-testing on the panel).
4. Stop the server (only the one on 8099).

Report what was checked and anything that looked wrong; do not fix visual issues in this task without saying so first.

- [ ] **Step 5: Commit**

```bash
git add -A static/js static/css internal/app/asset_hashes_gen.go tests CHANGELOG.md
git commit -m "drop the old bookmark list controls"
```

---

## Out of scope (from the spec)

User-defined saved views, a group-by selector, drag reordering, changes to the Tags subtab, and the docs round (What's New, MANUAL, Help, tips, cheat sheet, the other five locales). The monitor-interval choice stays in the add/edit dialog; the panel sets the mode only.
