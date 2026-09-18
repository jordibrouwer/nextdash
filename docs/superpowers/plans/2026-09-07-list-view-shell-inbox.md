# List View Shell — Inbox Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared list-view shell (sticky header, left rail carrying summary figures and filters, single toolbar row, shared row grid with a density control) and adopt it in the inbox view, removing the full-teardown render that forces the caret workarounds.

**Architecture:** A new `window.ListViewShell` module builds and owns the persistent chrome and returns a handle whose `body` element is the only thing the view repaints. Its CSS joins the existing lazily-loaded `bundle:css-views`; the row grid extends the already-shared `feed-row.css` rather than any per-view stylesheet. The inbox's inline header/tiles/toolbar construction is replaced by shell configuration, and its four near-duplicate "reset and re-render" handlers collapse into the shell's filter handling.

**Tech Stack:** Vanilla ES-class JavaScript in classic (non-module) scripts, plain CSS with the repo's `--space-*` / `--text-*` / `--layout-radius-*` token vocabulary, Go backend (untouched), Playwright for DOM tests, `node tests/*.test.cjs` for pure logic.

**Spec:** `docs/superpowers/specs/2026-09-07-health-inbox-shell-design.md`

## Scope note

The spec covers five phases. This plan implements phases 1 and 2 — the shell
plus inbox adoption plus the row anatomy — which together produce working,
shippable software: the inbox is fully redesigned and the shell is proven.
**Health's adoption (spec phases 3 and 4) gets its own plan** once this one
lands, because health adds the tile/filter merge over eleven filters, score
badges, the monitor strips and a new `#health/monitors` destination — a second
plan's worth of work that should be written against a shell that has already
survived contact with a real view.

Spec phase 0 (verify sticky) is already done; its findings are recorded in the
spec and are assumed here.

## Global Constraints

Copied from the spec and from project conventions. Every task's requirements
implicitly include this section.

- **Preserve the data-attribute contract.** Class names may change; the
  `data-*` hooks the specs select on must not. Filter buttons keep
  `data-inbox-filter="<key>"`. The overflow button keeps
  `data-inbox-toolbar-more`. The overflow menu keeps `data-inbox-menu`. Menu
  items keep `data-inbox-bulk`, `data-inbox-export`, `data-inbox-import`,
  `data-inbox-stats`. Search keeps `data-inbox-search`, sort keeps
  `data-inbox-sort`, the domain select keeps `data-inbox-domain-filter`.
- **A merged tile carries both attributes.** Where a tile folds into the filter
  list, the single resulting control carries `data-inbox-filter="<key>"` **and**
  `data-inbox-tile="<key>"`, so existing `[data-inbox-tile]` selectors resolve.
- **The row grid is declared once.** `grid-template-columns` for feed rows lives
  in `static/css/feed-row.css` only. `tests/view-visual-alignment.spec.js`
  asserts the string `grid-template-columns: 3rem 1fr` appears in none of
  `health-view.css`, `dashboard-inbox.css`, `config-view.css`.
- **No squared corners.** `tests/view-visual-alignment.spec.js` asserts zero
  occurrences of `border-radius: 0;` in `health-view.css`,
  `dashboard-inbox.css` and `view-explainers.css`.
- **`config-view.css` and `dashboard-config.js` are not touched in this plan.**
- **Tokens only.** Use `--space-*`, `--text-*`, `--layout-radius-*`,
  `--border-primary`, `--background-secondary`, `--accent-primary`. Do not
  introduce new raw hex values or the legacy variable names config remaps.
- **Rail width is 200px**, matching `.config-nav-column` (`config-view.css:51`).
- **Narrow breakpoint is 720px**, matching config (`config-view.css:83`).
- **Five locale files.** Any new UI string lands in all of
  `locales/{en,nl,de,fr,zh}.json`. Count them with `ls locales`, never from a
  commit diff.
- **Changelog line per phase**, added under `## Unreleased` in `CHANGELOG.md`.
  No What's New modal entry and no release notes until a version number is set.
- **Commit messages are short and human.** A plain subject line, no literary
  phrasing.
- **Do not `git push`.** Do not commit anything under `docs/` — it is
  deliberately gitignored (`.gitignore:41`).
- **Test commands:** `PW_WORKERS=2 npx playwright test <spec> > /tmp/pw.log 2>&1;
  echo "exit=$?"` — always redirect to a file, never pipe to `tail`; a pipe
  reports exit 0 while tests fail. Run only the specs covering the change; no
  full-suite sweep, not even as a final check.
- **Manual dev server:** `PORT=8099 NEXTDASH_DATA_DIR=<a copy> go run .`. Never
  8080 — that is the user's, and it is also the Go default when `PORT` is unset.

---

### Task 1: Shell module skeleton and mount contract

**Files:**
- Create: `static/js/shared/list-view-shell.js`
- Create: `static/css/list-view-shell.css`
- Modify: `templates/dashboard.html:113-119` (add the stylesheet to `bundle:css-views`)
- Modify: `templates/dashboard.html` (add the script tag alongside the other `static/js/shared/*.js` scripts)
- Test: `tests/list-view-shell.spec.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `window.ListViewShell.mount(container, config)` → `handle`
  - `config` fields used in this task: `{ id: string, title: string, description: string }`
  - `handle` fields produced in this task: `{ root: HTMLElement, body: HTMLElement, destroy(): void }`
  - `handle.body` is the element views repaint; it carries class `lvs-body`.
  - `handle.toolbar` points at `.lvs-toolbar-slot`, **not** at the `.lvs-toolbar`
    row. The row also holds shell-owned controls (the density toggle, Task 4);
    a view fills its slot with `innerHTML =` and must not be able to wipe them.
  - Emitted classes: `lvs`, `lvs-header`, `lvs-header-text`, `lvs-title`,
    `lvs-description`, `lvs-header-actions`, `lvs-rail`, `lvs-main`,
    `lvs-toolbar`, `lvs-toolbar-slot`, `lvs-body`.
  - `container` gains the class `lvs-host` and the attribute
    `data-lvs-id="<config.id>"`.

- [ ] **Step 1: Write the failing test**

Create `tests/list-view-shell.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The shell owns everything that persists; a view owns only `handle.body`.
 * These tests drive the module directly on a scratch container, because at this
 * point no view has adopted it yet.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
}

/** Mounts the shell on a throwaway container and returns a structural summary. */
const mountScratch = (page, config) => page.evaluate((cfg) => {
    const host = document.createElement('div');
    host.id = '__lvs_scratch__';
    document.body.appendChild(host);
    const handle = window.ListViewShell.mount(host, cfg);
    window.__lvsHandle = handle;
    const q = (sel) => host.querySelector(sel);
    return {
        hostClass: host.className,
        hostDataId: host.getAttribute('data-lvs-id'),
        hasRoot: !!q('.lvs'),
        hasHeader: !!q('.lvs-header'),
        hasRail: !!q('.lvs-rail'),
        hasMain: !!q('.lvs-main'),
        hasToolbar: !!q('.lvs-toolbar'),
        hasToolbarSlot: !!q('.lvs-toolbar-slot'),
        toolbarIsSlot: handle.toolbar === q('.lvs-toolbar-slot'),
        hasBody: !!q('.lvs-body'),
        title: q('.lvs-title')?.textContent || '',
        description: q('.lvs-description')?.textContent || '',
        bodyIsHandleBody: handle.body === q('.lvs-body'),
        rootIsHandleRoot: handle.root === q('.lvs'),
    };
}, config);

test('mount builds every region and hands back the body element', async ({ page }) => {
    await openDashboard(page);
    const shape = await mountScratch(page, { id: 'scratch', title: 'Scratch', description: 'A test view' });

    expect(shape.hasRoot).toBe(true);
    expect(shape.hasHeader).toBe(true);
    expect(shape.hasRail).toBe(true);
    expect(shape.hasMain).toBe(true);
    expect(shape.hasToolbar).toBe(true);
    expect(shape.hasToolbarSlot).toBe(true);
    expect(shape.toolbarIsSlot, 'handle.toolbar must be the slot, not the row').toBe(true);
    expect(shape.hasBody).toBe(true);
    expect(shape.title).toBe('Scratch');
    expect(shape.description).toBe('A test view');
    expect(shape.hostClass).toContain('lvs-host');
    expect(shape.hostDataId).toBe('scratch');
    expect(shape.bodyIsHandleBody, 'handle.body must be the .lvs-body node').toBe(true);
    expect(shape.rootIsHandleRoot, 'handle.root must be the .lvs node').toBe(true);
});

test('the body is the only region a repaint touches', async ({ page }) => {
    await openDashboard(page);
    await mountScratch(page, { id: 'scratch', title: 'Scratch', description: 'A test view' });

    // Mark every region, wipe the body the way a view does, and check the marks.
    const survived = await page.evaluate(() => {
        const host = document.getElementById('__lvs_scratch__');
        const regions = ['.lvs-header', '.lvs-rail', '.lvs-toolbar'];
        regions.forEach((sel, i) => { host.querySelector(sel).dataset.mark = String(i); });
        const body = window.__lvsHandle.body;
        body.innerHTML = '<p>repainted</p>';
        return regions.map((sel, i) => host.querySelector(sel)?.dataset.mark === String(i));
    });
    expect(survived, 'a body repaint destroyed a persistent region').toEqual([true, true, true]);
});

test('destroy removes the shell and its host marks', async ({ page }) => {
    await openDashboard(page);
    await mountScratch(page, { id: 'scratch', title: 'Scratch', description: 'A test view' });

    const after = await page.evaluate(() => {
        window.__lvsHandle.destroy();
        const host = document.getElementById('__lvs_scratch__');
        return {
            hasRoot: !!host.querySelector('.lvs'),
            hostClass: host.className,
            hostDataId: host.getAttribute('data-lvs-id'),
        };
    });
    expect(after.hasRoot).toBe(false);
    expect(after.hostClass).not.toContain('lvs-host');
    expect(after.hostDataId).toBeNull();
});

test('the stylesheet is in the lazily loaded view bundle', async ({ page }) => {
    await openDashboard(page);
    const loaded = await page.evaluate(() => [...document.styleSheets]
        .map((s) => s.href).filter(Boolean).some((h) => h.includes('css/list-view-shell.css')));
    expect(loaded, 'list-view-shell.css is not in bundle:css-views').toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell.spec.js > /tmp/pw-t1.log 2>&1; echo "exit=$?"; tail -40 /tmp/pw-t1.log
```

Expected: FAIL — `window.ListViewShell` is undefined, so `mountScratch` throws
`TypeError: Cannot read properties of undefined (reading 'mount')`.

- [ ] **Step 3: Write the module**

Create `static/js/shared/list-view-shell.js`:

```js
'use strict';

/**
 * The chrome shared by the list views: a sticky header, a rail carrying summary
 * figures and filters, one toolbar row, and a body the view repaints.
 *
 * The split matters more than the markup. A view rebuilding its whole container
 * on every keystroke has to put the caret back by hand; a view that repaints
 * only `handle.body` does not.
 */
class ListViewShell {
    static mount(container, config = {}) {
        if (!container) {
            throw new Error('ListViewShell.mount needs a container');
        }
        const id = String(config.id || 'view');

        const root = document.createElement('div');
        root.className = 'lvs';

        const header = document.createElement('div');
        header.className = 'lvs-header';
        const headerText = document.createElement('div');
        headerText.className = 'lvs-header-text';
        const title = document.createElement('h2');
        title.className = 'lvs-title';
        title.textContent = String(config.title || '');
        const description = document.createElement('p');
        description.className = 'lvs-description';
        description.textContent = String(config.description || '');
        headerText.append(title, description);
        const headerActions = document.createElement('div');
        headerActions.className = 'lvs-header-actions';
        header.append(headerText, headerActions);

        const rail = document.createElement('div');
        rail.className = 'lvs-rail';

        const main = document.createElement('div');
        main.className = 'lvs-main';
        const toolbar = document.createElement('div');
        toolbar.className = 'lvs-toolbar';
        // The view owns the slot, not the row: it fills its slot with
        // innerHTML, and shell-owned controls beside it must survive that.
        const toolbarSlot = document.createElement('div');
        toolbarSlot.className = 'lvs-toolbar-slot';
        toolbar.appendChild(toolbarSlot);
        const body = document.createElement('div');
        body.className = 'lvs-body';
        main.append(toolbar, body);

        root.append(header, rail, main);
        container.appendChild(root);
        container.classList.add('lvs-host');
        container.setAttribute('data-lvs-id', id);

        return {
            id,
            root,
            header,
            headerActions,
            rail,
            toolbarRow: toolbar,
            toolbar: toolbarSlot,
            body,
            destroy() {
                root.remove();
                container.classList.remove('lvs-host');
                container.removeAttribute('data-lvs-id');
            },
        };
    }
}

window.ListViewShell = ListViewShell;
```

- [ ] **Step 4: Write the stylesheet**

Create `static/css/list-view-shell.css`:

```css
/*
 * The shared list-view shell. Header spans both columns; the rail is the same
 * 200px as config's section rail so the views line up on one vertical.
 */
.lvs {
    display: grid;
    grid-template-columns: 200px 1fr;
    grid-template-areas:
        'header header'
        'rail   main';
    align-items: start;
    column-gap: var(--space-4);
}

.lvs-header {
    grid-area: header;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-primary);
}

.lvs-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 500;
}

.lvs-description {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.lvs-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
}

.lvs-rail {
    grid-area: rail;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-3);
}

.lvs-main {
    grid-area: main;
    min-width: 0;
    padding-top: var(--space-3);
}

.lvs-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
}

.lvs-body {
    min-width: 0;
}

@media (max-width: 720px) {
    .lvs {
        grid-template-columns: 1fr;
        grid-template-areas:
            'header'
            'rail'
            'main';
    }

    .lvs-rail {
        flex-direction: row;
        overflow-x: auto;
        gap: var(--space-2);
    }
}
```

- [ ] **Step 5: Register the stylesheet and the script**

In `templates/dashboard.html`, add the stylesheet to the `bundle:css-views`
link list (the block at `:113-119`, alongside the health/inbox/config
stylesheets) so `ViewStyles.ensureViewStyles()` fetches it:

```html
<link rel="stylesheet" href="{{asset "css/list-view-shell.css"}}">
```

And add the script beside the other shared modules:

```html
<script src="{{asset "js/shared/list-view-shell.js"}}"></script>
```

Use the `{{asset}}` helper for both — never hand-write a `?v=` cache token.

- [ ] **Step 6: Run the test to verify it passes**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell.spec.js > /tmp/pw-t1.log 2>&1; echo "exit=$?"; tail -40 /tmp/pw-t1.log
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Falsify the tests**

Temporarily change `body.className = 'lvs-body'` to `'lvs-content'` in the
module and re-run. Expected: the first two tests FAIL. Revert the change and
confirm they pass again. This proves the tests observe the contract rather than
merely running.

- [ ] **Step 8: Commit**

```bash
git add static/js/shared/list-view-shell.js static/css/list-view-shell.css templates/dashboard.html tests/list-view-shell.spec.js
git commit -m "add the shared list view shell"
```

---

### Task 2: Rail — summary, filters, sections, and in-place setters

**Files:**
- Modify: `static/js/shared/list-view-shell.js`
- Modify: `static/css/list-view-shell.css`
- Test: `tests/list-view-shell.spec.js` (append)

**Interfaces:**
- Consumes: `ListViewShell.mount(container, config)` and the `handle` from Task 1.
- Produces, added to `config`:
  - `summary: Array<{ key, label, value, tone? }>` — `tone` is one of
    `'default' | 'good' | 'warn' | 'bad'`.
  - `filters: Array<{ key, label, count, tone?, dataAttrs?: Record<string,string> }>`
  - `sections: Array<{ key, label, count?, href? }>`
  - `activeFilter: string`
  - `onFilter: (key: string, via: 'click' | 'keyboard') => void`
  - `filterClass?: string` — an extra class added to every filter button
    alongside `lvs-filter`.
  - `filterCountClass?: string` — an extra class added to every count span
    alongside `lvs-filter-count`.
  - These two exist because specs select on the view's own class names inside a
    filter row (`[data-inbox-filter="all"] .inbox-filter-count` in
    `tests/inbox-explainers.spec.js:156` and `tests/inbox-view-fixes.spec.js:96`).
    Preserving the data attribute alone is not enough to keep them green.
- Produces, added to `handle`:
  - `handle.setSummary(entries: Array<{key,label,value,tone?}>): void`
  - `handle.setCounts(counts: Record<string, number>): void`
  - `handle.setActive(key: string): void`
  - `handle.railScrollTop: number` (getter, for tests)
- Emitted classes: `lvs-summary`, `lvs-summary-row`, `lvs-summary-label`,
  `lvs-summary-value`, `lvs-group`, `lvs-group-title`, `lvs-filter`,
  `lvs-filter-label`, `lvs-filter-count`, `lvs-section`, and `is-active`.
- Tone maps to a class suffix: `lvs-tone-good` / `lvs-tone-warn` / `lvs-tone-bad`.
- Each filter button carries `role="tab"`, `aria-selected`, `tabindex` (0 when
  active, -1 otherwise), plus every entry of its `dataAttrs` verbatim. The rail's
  filter group carries `role="tablist"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/list-view-shell.spec.js`:

```js
const RAIL_CONFIG = {
    id: 'scratch',
    title: 'Scratch',
    description: 'A test view',
    summary: [
        { key: 'score', label: 'Score', value: '99%', tone: 'good' },
        { key: 'broken', label: 'Broken', value: 1, tone: 'bad' },
    ],
    filters: [
        { key: 'all', label: 'All', count: 108, dataAttrs: { 'data-scratch-filter': 'all' } },
        { key: 'broken', label: 'Broken', count: 1, tone: 'bad', dataAttrs: { 'data-scratch-filter': 'broken' } },
        { key: 'stale', label: 'Stale', count: 7, tone: 'warn', dataAttrs: { 'data-scratch-filter': 'stale' } },
    ],
    sections: [{ key: 'monitors', label: 'Monitors', count: 6 }],
    activeFilter: 'all',
};

const mountRail = (page, extra = {}) => page.evaluate((cfg) => {
    document.getElementById('__lvs_scratch__')?.remove();
    const host = document.createElement('div');
    host.id = '__lvs_scratch__';
    document.body.appendChild(host);
    window.__lvsCalls = [];
    const handle = window.ListViewShell.mount(host, {
        ...cfg,
        onFilter: (key, via) => window.__lvsCalls.push([key, via]),
    });
    window.__lvsHandle = handle;
    return true;
}, { ...RAIL_CONFIG, ...extra });

test('the rail renders summary, filters and sections as three blocks', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    const rail = await page.evaluate(() => {
        const host = document.getElementById('__lvs_scratch__');
        return {
            summary: [...host.querySelectorAll('.lvs-summary-row')].map((r) => ({
                label: r.querySelector('.lvs-summary-label').textContent,
                value: r.querySelector('.lvs-summary-value').textContent,
                tone: r.className,
            })),
            filters: [...host.querySelectorAll('.lvs-filter')].map((f) => ({
                label: f.querySelector('.lvs-filter-label').textContent,
                count: f.querySelector('.lvs-filter-count').textContent,
                active: f.classList.contains('is-active'),
                selected: f.getAttribute('aria-selected'),
                tabindex: f.getAttribute('tabindex'),
                dataAttr: f.getAttribute('data-scratch-filter'),
            })),
            sections: [...host.querySelectorAll('.lvs-section')].map((s) => s.textContent.trim()),
            tablist: host.querySelector('[role=tablist]') !== null,
        };
    });

    expect(rail.summary).toEqual([
        { label: 'Score', value: '99%', tone: expect.stringContaining('lvs-tone-good') },
        { label: 'Broken', value: '1', tone: expect.stringContaining('lvs-tone-bad') },
    ]);
    expect(rail.filters.map((f) => f.label)).toEqual(['All', 'Broken', 'Stale']);
    expect(rail.filters.map((f) => f.count)).toEqual(['108', '1', '7']);
    expect(rail.filters[0].active).toBe(true);
    expect(rail.filters[0].selected).toBe('true');
    expect(rail.filters[0].tabindex).toBe('0');
    expect(rail.filters[1].tabindex).toBe('-1');
    expect(rail.filters.map((f) => f.dataAttr), 'dataAttrs must be emitted verbatim')
        .toEqual(['all', 'broken', 'stale']);
    expect(rail.sections[0]).toContain('Monitors');
    expect(rail.tablist).toBe(true);
});

test('clicking and arrowing a filter reports through onFilter', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    await page.locator('[data-scratch-filter="stale"]').click();
    await page.locator('[data-scratch-filter="stale"]').press('ArrowRight');

    // ArrowRight from the last pill wraps to the first.
    expect(await page.evaluate(() => window.__lvsCalls))
        .toEqual([['stale', 'click'], ['all', 'keyboard']]);
});

test('setCounts and setActive update the rail without rebuilding it', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    const result = await page.evaluate(() => {
        const host = document.getElementById('__lvs_scratch__');
        const before = host.querySelector('[data-scratch-filter="all"]');
        before.dataset.mark = 'kept';
        window.__lvsHandle.setCounts({ all: 42, broken: 0, stale: 7 });
        window.__lvsHandle.setActive('broken');
        const after = host.querySelector('[data-scratch-filter="all"]');
        return {
            sameNode: before === after,
            markSurvived: after.dataset.mark === 'kept',
            counts: [...host.querySelectorAll('.lvs-filter-count')].map((c) => c.textContent),
            activeKey: host.querySelector('.lvs-filter.is-active')?.getAttribute('data-scratch-filter'),
            allTabindex: after.getAttribute('tabindex'),
        };
    });

    expect(result.sameNode, 'setCounts replaced the filter node instead of updating it').toBe(true);
    expect(result.markSurvived).toBe(true);
    expect(result.counts).toEqual(['42', '0', '7']);
    expect(result.activeKey).toBe('broken');
    expect(result.allTabindex).toBe('-1');
});

test('a view can add its own class names to the filter rows', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page, { filterClass: 'inbox-filter-btn', filterCountClass: 'inbox-filter-count' });

    // Specs select `[data-inbox-filter="all"] .inbox-filter-count`, so the
    // view's class has to ride along with the shell's.
    const classes = await page.evaluate(() => {
        const btn = document.querySelector('[data-scratch-filter="all"]');
        return {
            btn: [...btn.classList],
            count: [...btn.querySelector('.lvs-filter-count').classList],
        };
    });
    expect(classes.btn).toEqual(expect.arrayContaining(['lvs-filter', 'inbox-filter-btn']));
    expect(classes.count).toEqual(expect.arrayContaining(['lvs-filter-count', 'inbox-filter-count']));
});

test('setSummary rewrites the figures in place', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page);

    const values = await page.evaluate(() => {
        window.__lvsHandle.setSummary([{ key: 'score', label: 'Score', value: '87%', tone: 'warn' }]);
        const host = document.getElementById('__lvs_scratch__');
        return [...host.querySelectorAll('.lvs-summary-row')].map((r) => ({
            value: r.querySelector('.lvs-summary-value').textContent,
            tone: r.className,
        }));
    });
    expect(values).toEqual([{ value: '87%', tone: expect.stringContaining('lvs-tone-warn') }]);
});

test('the rail keeps its scroll position across a body repaint', async ({ page }) => {
    await openDashboard(page);
    await mountRail(page, {
        filters: Array.from({ length: 30 }, (_, i) => ({
            key: `f${i}`, label: `Filter ${i}`, count: i,
            dataAttrs: { 'data-scratch-filter': `f${i}` },
        })),
        activeFilter: 'f0',
    });

    const kept = await page.evaluate(() => {
        const rail = document.querySelector('.lvs-rail');
        rail.style.maxHeight = '120px';
        rail.style.overflowY = 'auto';
        rail.scrollTop = 60;
        const before = rail.scrollTop;
        window.__lvsHandle.body.innerHTML = '<p>repainted</p>';
        window.__lvsHandle.setCounts({ f0: 999 });
        return { before, after: document.querySelector('.lvs-rail').scrollTop };
    });
    expect(kept.after, 'the rail lost its scroll position').toBe(kept.before);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell.spec.js > /tmp/pw-t2.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t2.log
```

Expected: the four new tests FAIL — the rail is empty, so
`.lvs-summary-row` / `.lvs-filter` queries return `[]` and
`window.__lvsHandle.setCounts` is not a function.

- [ ] **Step 3: Build the rail**

In `static/js/shared/list-view-shell.js`, add these private helpers above the
class and extend `mount` to fill the rail and return the setters:

```js
const TONE_CLASS = { good: 'lvs-tone-good', warn: 'lvs-tone-warn', bad: 'lvs-tone-bad' };

function toneClass(tone) {
    return TONE_CLASS[tone] || '';
}

function buildSummary(entries) {
    const wrap = document.createElement('div');
    wrap.className = 'lvs-summary';
    (entries || []).forEach((entry) => {
        const row = document.createElement('div');
        row.className = ['lvs-summary-row', toneClass(entry.tone)].filter(Boolean).join(' ');
        row.dataset.lvsSummaryKey = String(entry.key);
        const label = document.createElement('span');
        label.className = 'lvs-summary-label';
        label.textContent = String(entry.label);
        const value = document.createElement('span');
        value.className = 'lvs-summary-value';
        value.textContent = String(entry.value);
        row.append(label, value);
        wrap.appendChild(row);
    });
    return wrap;
}

function buildFilter(entry, isActive, classes = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = ['lvs-filter', classes.filterClass, toneClass(entry.tone),
        isActive ? 'is-active' : ''].filter(Boolean).join(' ');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(isActive));
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
    btn.dataset.lvsFilterKey = String(entry.key);
    Object.entries(entry.dataAttrs || {}).forEach(([name, value]) => {
        btn.setAttribute(name, String(value));
    });
    const label = document.createElement('span');
    label.className = 'lvs-filter-label';
    label.textContent = String(entry.label);
    const count = document.createElement('span');
    count.className = ['lvs-filter-count', classes.filterCountClass].filter(Boolean).join(' ');
    count.textContent = String(entry.count ?? '');
    btn.append(label, count);
    return btn;
}
```

Then, inside `mount`, after the rail element is created and before
`root.append(...)`:

```js
        const summaryHost = buildSummary(config.summary);
        rail.appendChild(summaryHost);

        const filterGroup = document.createElement('div');
        filterGroup.className = 'lvs-group lvs-group--filters';
        filterGroup.setAttribute('role', 'tablist');
        let activeKey = String(config.activeFilter || (config.filters?.[0]?.key ?? ''));
        const filterClasses = {
            filterClass: config.filterClass,
            filterCountClass: config.filterCountClass,
        };
        (config.filters || []).forEach((entry) => {
            filterGroup.appendChild(
                buildFilter(entry, String(entry.key) === activeKey, filterClasses));
        });
        rail.appendChild(filterGroup);

        if ((config.sections || []).length) {
            const sectionGroup = document.createElement('div');
            sectionGroup.className = 'lvs-group lvs-group--sections';
            (config.sections || []).forEach((entry) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'lvs-section';
                item.dataset.lvsSectionKey = String(entry.key);
                item.textContent = entry.count == null
                    ? String(entry.label)
                    : `${entry.label} ${entry.count}`;
                sectionGroup.appendChild(item);
            });
            rail.appendChild(sectionGroup);
        }

        const filterButtons = () => [...filterGroup.querySelectorAll('.lvs-filter')];

        const setActive = (key) => {
            activeKey = String(key);
            filterButtons().forEach((btn) => {
                const on = btn.dataset.lvsFilterKey === activeKey;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', String(on));
                btn.setAttribute('tabindex', on ? '0' : '-1');
            });
        };

        const report = (key, via) => {
            if (typeof config.onFilter === 'function') {
                config.onFilter(key, via);
            }
        };

        filterGroup.addEventListener('click', (event) => {
            const btn = event.target.closest('.lvs-filter');
            if (btn && filterGroup.contains(btn)) {
                report(btn.dataset.lvsFilterKey, 'click');
            }
        });

        filterGroup.addEventListener('keydown', (event) => {
            const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            const buttons = filterButtons();
            const current = buttons.indexOf(event.target.closest('.lvs-filter'));
            if (current < 0) return;
            event.preventDefault();
            let next = current;
            if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
            if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            report(buttons[next].dataset.lvsFilterKey, 'keyboard');
        });
```

Extend the returned handle with:

```js
            setSummary(entries) {
                summaryHost.replaceChildren(...buildSummary(entries).childNodes);
            },
            setCounts(counts) {
                filterButtons().forEach((btn) => {
                    const key = btn.dataset.lvsFilterKey;
                    if (Object.prototype.hasOwnProperty.call(counts || {}, key)) {
                        btn.querySelector('.lvs-filter-count').textContent = String(counts[key]);
                    }
                });
            },
            setActive,
            get railScrollTop() { return rail.scrollTop; },
```

- [ ] **Step 4: Style the rail**

Append to `static/css/list-view-shell.css`:

```css
.lvs-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--background-secondary);
    border-radius: var(--layout-radius-md);
}

.lvs-summary-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-sm);
}

.lvs-summary-label { color: var(--text-secondary); }
.lvs-summary-value { font-weight: 500; }

.lvs-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.lvs-group-title {
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding: 0 var(--space-2) var(--space-1);
}

.lvs-filter,
.lvs-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    border-radius: var(--layout-radius-sm);
    cursor: pointer;
}

.lvs-filter:hover,
.lvs-section:hover { background: var(--background-secondary); }

.lvs-filter.is-active {
    background: var(--background-secondary);
    color: var(--accent-primary);
    font-weight: 500;
}

.lvs-filter:focus-visible,
.lvs-section:focus-visible { outline: var(--layout-focus-ring); }

/*
 * The repo's status colours are --accent-{success,warning,error}, generated
 * per theme in internal/app/handlers.go:2654 and used throughout health-view.css.
 * There is no --text-danger / --text-warning / --text-success in this codebase.
 */
.lvs-tone-good { color: var(--accent-success); }
.lvs-tone-warn { color: var(--accent-warning); }
.lvs-tone-bad  { color: var(--accent-error); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell.spec.js > /tmp/pw-t2.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t2.log
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Falsify the in-place assertion**

In `setCounts`, temporarily replace the in-place text update with a rebuild:

```js
            setCounts(counts) {
                filterGroup.replaceChildren(
                    ...(config.filters || []).map((e) => buildFilter(
                        { ...e, count: counts[e.key] ?? e.count }, String(e.key) === activeKey)));
            },
```

Re-run. Expected: `setCounts and setActive update the rail without rebuilding
it` FAILS on `sameNode`. Revert and confirm it passes. This is the assertion the
whole design rests on, so it must be shown to bite.

- [ ] **Step 7: Commit**

```bash
git add static/js/shared/list-view-shell.js static/css/list-view-shell.css tests/list-view-shell.spec.js
git commit -m "give the shell its rail and in-place setters"
```

---

### Task 3: Sticky header that collapses on scroll

**Files:**
- Modify: `static/js/shared/list-view-shell.js`
- Modify: `static/css/list-view-shell.css`
- Test: `tests/list-view-shell-sticky.spec.js`

**Interfaces:**
- Consumes: `mount`, `handle.root`, `handle.header` from Tasks 1–2.
- Produces:
  - `config.actions: Array<{ key, label, kind?: 'primary'|'secondary', dataAttrs?, onClick? }>`
    rendered into `.lvs-header-actions`; each button carries its `dataAttrs`
    verbatim and class `lvs-action` plus `lvs-action--primary` when
    `kind === 'primary'`.
  - `handle.setBreadcrumb(text: string): void` — fills `.lvs-crumb`, shown only
    in the collapsed state.
  - The header gains class `is-collapsed` once the page is scrolled past the
    header's natural height; removed when scrolled back.
  - `handle.destroy()` also removes the scroll listener.

- [ ] **Step 1: Write the failing test**

Create `tests/list-view-shell-sticky.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Phase 0 established that `position: sticky` works inside #dashboard-layout.
 * These tests hold that result in place and cover the collapse behaviour.
 */
async function mountTall(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
    await page.evaluate(() => {
        const host = document.getElementById('dashboard-layout');
        host.innerHTML = '';
        window.__lvsHandle = window.ListViewShell.mount(host, {
            id: 'scratch',
            title: 'Scratch',
            description: 'A test view',
            filters: [{ key: 'all', label: 'All', count: 1, dataAttrs: { 'data-scratch-filter': 'all' } }],
            activeFilter: 'all',
            actions: [
                { key: 'go', label: 'Work through', kind: 'primary', dataAttrs: { 'data-scratch-go': '' } },
                { key: 'more', label: '⋯', dataAttrs: { 'data-scratch-more': '' } },
            ],
        });
        window.__lvsHandle.body.innerHTML = '<div style="height:4000px">tall</div>';
    });
}

test('the header is sticky and stays on screen while the list scrolls', async ({ page }) => {
    await mountTall(page);

    const result = await page.evaluate(async () => {
        const header = document.querySelector('.lvs-header');
        const position = getComputedStyle(header).position;
        const before = header.getBoundingClientRect().top;
        window.scrollTo(0, 1200);
        await new Promise((r) => setTimeout(r, 400));
        const after = header.getBoundingClientRect().top;
        const scrolled = window.scrollY;
        window.scrollTo(0, 0);
        return { position, before, after, scrolled };
    });

    expect(result.position).toBe('sticky');
    expect(result.scrolled).toBeGreaterThan(0);
    expect(result.after, 'the header scrolled away instead of sticking').toBeLessThan(40);
});

test('the header collapses on scroll and expands again at the top', async ({ page }) => {
    await mountTall(page);

    const states = await page.evaluate(async () => {
        const header = document.querySelector('.lvs-header');
        const at = async (y) => {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 350));
            return header.classList.contains('is-collapsed');
        };
        const top = await at(0);
        const down = await at(1200);
        const back = await at(0);
        return { top, down, back };
    });

    expect(states).toEqual({ top: false, down: true, back: false });
});

test('the primary action stays reachable in the collapsed header', async ({ page }) => {
    await mountTall(page);

    const visible = await page.evaluate(async () => {
        window.scrollTo(0, 1200);
        await new Promise((r) => setTimeout(r, 350));
        const btn = document.querySelector('[data-scratch-go]');
        const box = btn.getBoundingClientRect();
        return { top: box.top, height: box.height, inView: box.top >= 0 && box.bottom <= window.innerHeight };
    });

    expect(visible.height).toBeGreaterThan(0);
    expect(visible.inView, 'the primary action left the viewport when collapsed').toBe(true);
});

test('the breadcrumb shows the active filter only when collapsed', async ({ page }) => {
    await mountTall(page);

    const seen = await page.evaluate(async () => {
        window.__lvsHandle.setBreadcrumb('Broken · 1');
        const crumb = document.querySelector('.lvs-crumb');
        const at = async (y) => {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 350));
            return getComputedStyle(crumb).display !== 'none';
        };
        return { text: crumb.textContent, top: await at(0), down: await at(1200) };
    });

    expect(seen.text).toBe('Broken · 1');
    expect(seen.top).toBe(false);
    expect(seen.down).toBe(true);
});

test('destroy detaches the scroll listener', async ({ page }) => {
    await mountTall(page);

    const leaked = await page.evaluate(async () => {
        window.__lvsHandle.destroy();
        let threw = null;
        window.onerror = (msg) => { threw = String(msg); };
        window.scrollTo(0, 800);
        await new Promise((r) => setTimeout(r, 300));
        window.scrollTo(0, 0);
        return threw;
    });

    expect(leaked, 'the scroll handler ran after destroy').toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell-sticky.spec.js > /tmp/pw-t3.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t3.log
```

Expected: FAIL — `position` is `static`, `is-collapsed` never appears,
`[data-scratch-go]` does not exist, `setBreadcrumb` is not a function.

- [ ] **Step 3: Render the actions and the breadcrumb**

In `mount`, after `headerText.append(title, description);` add the breadcrumb,
and after `headerActions` is created render the action buttons:

```js
        const crumb = document.createElement('span');
        crumb.className = 'lvs-crumb';
        crumb.textContent = '';
        headerText.appendChild(crumb);

        (config.actions || []).forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = ['lvs-action', action.kind === 'primary' ? 'lvs-action--primary' : '']
                .filter(Boolean).join(' ');
            btn.dataset.lvsActionKey = String(action.key);
            btn.textContent = String(action.label);
            Object.entries(action.dataAttrs || {}).forEach(([name, value]) => {
                btn.setAttribute(name, String(value));
            });
            if (typeof action.onClick === 'function') {
                btn.addEventListener('click', action.onClick);
            }
            headerActions.appendChild(btn);
        });
```

- [ ] **Step 4: Add the collapse behaviour**

Still inside `mount`, after the header is in the DOM:

```js
        let collapsed = false;
        const syncCollapse = () => {
            const should = window.scrollY > header.offsetHeight;
            if (should === collapsed) return;
            collapsed = should;
            header.classList.toggle('is-collapsed', collapsed);
        };
        window.addEventListener('scroll', syncCollapse, { passive: true });
        syncCollapse();
```

Extend the handle:

```js
            setBreadcrumb(text) { crumb.textContent = String(text || ''); },
```

and make `destroy` remove the listener:

```js
            destroy() {
                window.removeEventListener('scroll', syncCollapse);
                root.remove();
                container.classList.remove('lvs-host');
                container.removeAttribute('data-lvs-id');
            },
```

- [ ] **Step 5: Style the sticky and collapsed states**

Append to `static/css/list-view-shell.css`:

```css
.lvs-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--background-primary);
}

.lvs-crumb {
    display: none;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.lvs-header.is-collapsed {
    align-items: center;
    padding-block: var(--space-1);
}

.lvs-header.is-collapsed .lvs-header-text {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
}

.lvs-header.is-collapsed .lvs-title { font-size: var(--text-base); }
.lvs-header.is-collapsed .lvs-description { display: none; }
.lvs-header.is-collapsed .lvs-crumb { display: inline; }

.lvs-action {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-primary);
    border-radius: var(--layout-radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}

.lvs-action:hover { background: var(--background-secondary); }
.lvs-action:focus-visible { outline: var(--layout-focus-ring); }

.lvs-action--primary {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 500;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell-sticky.spec.js > /tmp/pw-t3.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t3.log
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Falsify**

Temporarily change `.lvs-header`'s `position: sticky` to `position: relative`
and re-run. Expected: the first test FAILS on both `position` and `after`.
Revert and confirm.

- [ ] **Step 8: Commit**

```bash
git add static/js/shared/list-view-shell.js static/css/list-view-shell.css tests/list-view-shell-sticky.spec.js
git commit -m "make the shell header sticky and collapsible"
```

---

### Task 4: Row grid and the density control

**Files:**
- Modify: `static/css/feed-row.css`
- Modify: `static/js/shared/list-view-shell.js`
- Modify: `static/css/list-view-shell.css`
- Create: `static/js/shared/list-density.js`
- Modify: `templates/dashboard.html` (script tag)
- Test: `tests/list-view-density.spec.js`

**Interfaces:**
- Consumes: `mount`, `handle.toolbar` from Tasks 1–3.
- Produces:
  - `window.ListDensity.get(): 'compact' | 'comfortable'`
  - `window.ListDensity.set(value): void` — persists to
    `localStorage['nextdash:list-density']` and stamps
    `document.body.dataset.listDensity`.
  - `window.ListDensity.DEFAULT === 'comfortable'`
  - `config.density: boolean` — when true, the shell renders a two-button
    density toggle into `.lvs-toolbar` with `data-lvs-density="compact"` and
    `data-lvs-density="comfortable"`.
  - CSS: `.feed-row--grid` sets `grid-template-columns: 3rem 1fr auto`;
    `body[data-list-density="compact"]` tightens its block padding.
- Because the setting is app-level, it is stamped on `<body>`, not on the shell
  root — a second mounted view must pick up the same value.

- [ ] **Step 1: Write the failing test**

Create `tests/list-view-density.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function mountWithDensity(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
    await page.evaluate(() => {
        const host = document.getElementById('dashboard-layout');
        host.innerHTML = '';
        window.__lvsHandle = window.ListViewShell.mount(host, {
            id: 'scratch', title: 'Scratch', description: 'A test view', density: true,
            filters: [{ key: 'all', label: 'All', count: 1, dataAttrs: { 'data-scratch-filter': 'all' } }],
            activeFilter: 'all',
        });
        window.__lvsHandle.body.innerHTML =
            '<div class="feed-list"><article class="feed-row feed-row--grid" id="r1">'
            + '<span>i</span><span>title</span><span>meta</span></article></div>';
    });
}

test('the row grid is declared in feed-row.css and nowhere else', async ({ page }) => {
    await mountWithDensity(page);

    const where = await page.evaluate(async () => {
        const read = async (file) => {
            const href = [...document.styleSheets].map((s) => s.href).filter(Boolean)
                .find((h) => h.includes(file));
            return href ? (await (await fetch(href)).text()) : '';
        };
        return {
            feedRow: /\.feed-row--grid[^}]*grid-template-columns/s.test(await read('css/feed-row.css')),
            shell: /grid-template-columns:\s*3rem 1fr/.test(await read('css/list-view-shell.css')),
            inbox: /grid-template-columns:\s*3rem 1fr/.test(await read('css/dashboard-inbox.css')),
            health: /grid-template-columns:\s*3rem 1fr/.test(await read('css/health-view.css')),
        };
    });

    expect(where.feedRow, 'the grid must live in feed-row.css').toBe(true);
    expect(where.shell).toBe(false);
    expect(where.inbox).toBe(false);
    expect(where.health).toBe(false);
});

test('a grid row lays its columns out rather than stacking', async ({ page }) => {
    await mountWithDensity(page);
    const cols = await page.evaluate(() =>
        getComputedStyle(document.getElementById('r1')).gridTemplateColumns);
    expect(cols.split(' ').length, `grid resolved to "${cols}"`).toBe(3);
});

test('the density toggle changes row height and survives a reload', async ({ page }) => {
    await mountWithDensity(page);

    const comfortable = await page.evaluate(() =>
        document.getElementById('r1').getBoundingClientRect().height);

    await page.locator('[data-lvs-density="compact"]').click();
    const compact = await page.evaluate(() =>
        document.getElementById('r1').getBoundingClientRect().height);

    expect(compact, 'compact is not tighter than comfortable').toBeLessThan(comfortable);

    const stored = await page.evaluate(() => ({
        ls: localStorage.getItem('nextdash:list-density'),
        body: document.body.dataset.listDensity,
    }));
    expect(stored).toEqual({ ls: 'compact', body: 'compact' });

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    expect(await page.evaluate(() => document.body.dataset.listDensity)).toBe('compact');
});

test('density is one app-level setting, not one per view', async ({ page }) => {
    await mountWithDensity(page);
    await page.locator('[data-lvs-density="compact"]').click();

    // A second shell mounted elsewhere reads the same value.
    const second = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        window.ListViewShell.mount(host, { id: 'other', title: 'Other', description: '', density: true });
        return host.querySelector('[data-lvs-density="compact"]').getAttribute('aria-pressed');
    });
    expect(second, 'the second view did not inherit the density setting').toBe('true');
});

test('a view filling its toolbar slot does not wipe the density toggle', async ({ page }) => {
    await mountWithDensity(page);

    const survived = await page.evaluate(() => {
        // Exactly what a view does when it builds its own toolbar controls.
        window.__lvsHandle.toolbar.innerHTML = '<input data-view-search>';
        return {
            viewControl: !!document.querySelector('[data-view-search]'),
            density: !!document.querySelector('[data-lvs-density="compact"]'),
        };
    });

    expect(survived.viewControl).toBe(true);
    expect(survived.density, 'the view wiped a shell-owned control').toBe(true);
});

test('unreadable storage falls back to the default without throwing', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    const value = await page.evaluate(() => {
        localStorage.setItem('nextdash:list-density', 'not-a-density');
        return window.ListDensity.get();
    });
    expect(value).toBe('comfortable');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-density.spec.js > /tmp/pw-t4.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t4.log
```

Expected: FAIL — `window.ListDensity` is undefined, `[data-lvs-density]` does
not exist, `.feed-row--grid` has no grid.

- [ ] **Step 3: Write the density module**

Create `static/js/shared/list-density.js`:

```js
'use strict';

/**
 * How tightly list rows sit. One setting for the whole app rather than one per
 * view: it is a reading preference, not a property of a particular list.
 */
const DENSITIES = ['compact', 'comfortable'];
const STORAGE_KEY = 'nextdash:list-density';
const DEFAULT = 'comfortable';

const ListDensity = {
    DEFAULT,
    STORAGE_KEY,
    get() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return DENSITIES.includes(stored) ? stored : DEFAULT;
        } catch {
            return DEFAULT;
        }
    },
    set(value) {
        const next = DENSITIES.includes(value) ? value : DEFAULT;
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch { /* private mode: the setting still applies this session */ }
        document.body.dataset.listDensity = next;
        window.dispatchEvent(new CustomEvent('nextdash:list-density', { detail: next }));
    },
    apply() {
        document.body.dataset.listDensity = this.get();
    },
};

window.ListDensity = ListDensity;
ListDensity.apply();
```

Register it in `templates/dashboard.html` beside the other shared scripts, using
`{{asset}}`. It must load **before** `list-view-shell.js`, because the shell
reads `window.ListDensity` when it renders the toggle. Because `apply()` writes
to `document.body` at load time, the script tag must sit inside `<body>`, not in
`<head>`.

- [ ] **Step 4: Render the toggle in the shell**

In `mount`, after `main.append(toolbar, body);`. Note it appends to `toolbar`
(the row), **not** to `toolbarSlot` — a view clears its slot with `innerHTML =`
and must not be able to wipe a shell-owned control:

```js
        if (config.density && window.ListDensity) {
            const group = document.createElement('div');
            group.className = 'lvs-density';
            group.setAttribute('role', 'group');
            const current = () => window.ListDensity.get();
            const buttons = ['compact', 'comfortable'].map((value) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lvs-density-btn';
                btn.setAttribute('data-lvs-density', value);
                btn.setAttribute('aria-pressed', String(current() === value));
                btn.textContent = value === 'compact' ? '≡' : '☰';
                btn.addEventListener('click', () => {
                    window.ListDensity.set(value);
                    buttons.forEach((b) => b.setAttribute(
                        'aria-pressed', String(b.getAttribute('data-lvs-density') === value)));
                });
                group.appendChild(btn);
                return btn;
            });
            toolbar.appendChild(group);
        }
```

- [ ] **Step 5: Add the grid and density CSS**

Append to `static/css/feed-row.css`:

```css
/*
 * The grid variant: fixed columns so a reader scans down one column instead of
 * re-parsing each row. Declared here, once, because health, inbox and
 * Config -> Bookmarks all build on .feed-row.
 */
.feed-row--grid {
    display: grid;
    grid-template-columns: 3rem 1fr auto;
    align-items: center;
    column-gap: var(--space-3);
}

body[data-list-density="compact"] .feed-row--grid {
    padding-block: var(--space-1);
}

body[data-list-density="comfortable"] .feed-row--grid {
    padding-block: var(--space-3);
}
```

Append to `static/css/list-view-shell.css`:

```css
.lvs-density {
    display: inline-flex;
    border: 1px solid var(--border-primary);
    border-radius: var(--layout-radius-sm);
    overflow: hidden;
    margin-left: auto;
}

.lvs-density-btn {
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
}

.lvs-density-btn[aria-pressed="true"] {
    background: var(--background-secondary);
    color: var(--text-primary);
}

.lvs-density-btn:focus-visible { outline: var(--layout-focus-ring); }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-density.spec.js > /tmp/pw-t4.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t4.log
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Confirm the shared alignment guard still holds**

```bash
PW_WORKERS=2 npx playwright test tests/view-visual-alignment.spec.js > /tmp/pw-t4b.log 2>&1; echo "exit=$?"; tail -40 /tmp/pw-t4b.log
```

Expected: PASS. This spec asserts `grid-template-columns: 3rem 1fr` appears in
none of the three view stylesheets — Step 5 put it in `feed-row.css`, which
satisfies it.

- [ ] **Step 8: Commit**

```bash
git add static/css/feed-row.css static/css/list-view-shell.css static/js/shared/list-density.js static/js/shared/list-view-shell.js templates/dashboard.html tests/list-view-density.spec.js
git commit -m "add the shared row grid and a density setting"
```

---

### Task 5: Locale strings for the new chrome

**Files:**
- Modify: `locales/en.json`, `locales/nl.json`, `locales/de.json`, `locales/fr.json`, `locales/zh.json`
- Modify: `static/js/shared/list-view-shell.js`
- Test: `tests/list-view-shell-i18n.spec.js`

**Interfaces:**
- Consumes: `mount` and the density toggle from Tasks 1–4.
- Produces: `config.t: (key: string, fallback: string) => string`, used by the
  shell for its own strings. When absent the shell uses the fallback, so the
  scratch mounts in earlier tasks keep working unchanged.
- New keys, all under the existing `dashboard.` namespace:
  - `dashboard.listFilterHeading` — "Filter"
  - `dashboard.listSectionHeading` — "Sections"
  - `dashboard.listDensityCompact` — "Compact rows"
  - `dashboard.listDensityComfortable` — "Comfortable rows"
  - `dashboard.listDensityGroup` — "Row density"

- [ ] **Step 1: Confirm the locale file count**

```bash
ls locales
```

Expected: exactly five `.json` files — `de.json`, `en.json`, `fr.json`,
`nl.json`, `zh.json`. If the count differs, stop and reconcile before editing;
the constraint is parity across whatever is actually there.

- [ ] **Step 2: Write the failing test**

Create `tests/list-view-shell-i18n.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const fs = require('fs');
const path = require('path');

const KEYS = [
    'listFilterHeading',
    'listSectionHeading',
    'listDensityCompact',
    'listDensityComfortable',
    'listDensityGroup',
];

test('every locale carries the shell strings', () => {
    const dir = path.join(__dirname, '..', 'locales');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length, `expected five locales, found ${files.join(', ')}`).toBe(5);

    const missing = {};
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const gaps = KEYS.filter((key) => !data.dashboard || !data.dashboard[key]);
        if (gaps.length) missing[file] = gaps;
    }
    expect(missing).toEqual({});
});

test('the rail headings and density labels are translated, not hardcoded', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());

    const labels = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        window.ListViewShell.mount(host, {
            id: 'scratch', title: 'T', description: 'D', density: true,
            t: (key, fallback) => `«${key}»${fallback ? '' : ''}`,
            filters: [{ key: 'all', label: 'All', count: 1 }],
            sections: [{ key: 'monitors', label: 'Monitors' }],
            activeFilter: 'all',
        });
        return {
            filterHeading: host.querySelector('.lvs-group--filters .lvs-group-title')?.textContent,
            sectionHeading: host.querySelector('.lvs-group--sections .lvs-group-title')?.textContent,
            compactLabel: host.querySelector('[data-lvs-density="compact"]')?.getAttribute('aria-label'),
            groupLabel: host.querySelector('.lvs-density')?.getAttribute('aria-label'),
        };
    });

    expect(labels.filterHeading).toBe('«dashboard.listFilterHeading»');
    expect(labels.sectionHeading).toBe('«dashboard.listSectionHeading»');
    expect(labels.compactLabel).toBe('«dashboard.listDensityCompact»');
    expect(labels.groupLabel).toBe('«dashboard.listDensityGroup»');
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell-i18n.spec.js > /tmp/pw-t5.log 2>&1; echo "exit=$?"; tail -40 /tmp/pw-t5.log
```

Expected: FAIL — the keys are absent from all five locales, and the shell
renders no group titles or aria-labels at all.

- [ ] **Step 4: Add the strings to all five locales**

Under the `dashboard` object in each file:

`locales/en.json`
```json
    "listFilterHeading": "Filter",
    "listSectionHeading": "Sections",
    "listDensityCompact": "Compact rows",
    "listDensityComfortable": "Comfortable rows",
    "listDensityGroup": "Row density",
```

`locales/nl.json`
```json
    "listFilterHeading": "Filter",
    "listSectionHeading": "Secties",
    "listDensityCompact": "Compacte rijen",
    "listDensityComfortable": "Ruime rijen",
    "listDensityGroup": "Rijhoogte",
```

`locales/de.json`
```json
    "listFilterHeading": "Filter",
    "listSectionHeading": "Bereiche",
    "listDensityCompact": "Kompakte Zeilen",
    "listDensityComfortable": "Weite Zeilen",
    "listDensityGroup": "Zeilenhöhe",
```

`locales/fr.json`
```json
    "listFilterHeading": "Filtre",
    "listSectionHeading": "Sections",
    "listDensityCompact": "Lignes compactes",
    "listDensityComfortable": "Lignes aérées",
    "listDensityGroup": "Hauteur des lignes",
```

`locales/zh.json`
```json
    "listFilterHeading": "筛选",
    "listSectionHeading": "分区",
    "listDensityCompact": "紧凑行距",
    "listDensityComfortable": "宽松行距",
    "listDensityGroup": "行距",
```

- [ ] **Step 5: Use them in the shell**

In `static/js/shared/list-view-shell.js`, add a translate helper at the top of
`mount`:

```js
        const t = typeof config.t === 'function'
            ? config.t
            : (key, fallback) => fallback;
```

Give each rail group a title, before its buttons are appended:

```js
        const filterTitle = document.createElement('div');
        filterTitle.className = 'lvs-group-title';
        filterTitle.textContent = t('dashboard.listFilterHeading', 'Filter');
        filterGroup.appendChild(filterTitle);
```

and the same shape for the sections group with
`t('dashboard.listSectionHeading', 'Sections')`.

In the density block, label the group and both buttons:

```js
            group.setAttribute('aria-label', t('dashboard.listDensityGroup', 'Row density'));
```

and inside the button loop:

```js
                btn.setAttribute('aria-label', value === 'compact'
                    ? t('dashboard.listDensityCompact', 'Compact rows')
                    : t('dashboard.listDensityComfortable', 'Comfortable rows'));
```

Note: `buildFilter` reads `.lvs-filter` buttons via
`filterGroup.querySelectorAll('.lvs-filter')`, so the added title node does not
disturb `filterButtons()`. Verify that the Task 2 arrow-key test still passes.

- [ ] **Step 6: Validate the JSON and run the tests**

```bash
npm run validate:json > /tmp/json.log 2>&1; echo "exit=$?"; tail -20 /tmp/json.log
PW_WORKERS=2 npx playwright test tests/list-view-shell-i18n.spec.js tests/list-view-shell.spec.js > /tmp/pw-t5.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t5.log
```

Expected: both PASS. The second command re-runs Task 2's rail tests to catch the
`filterButtons()` regression the group title could cause.

- [ ] **Step 7: Commit**

```bash
git add locales static/js/shared/list-view-shell.js tests/list-view-shell-i18n.spec.js
git commit -m "translate the shell's own labels"
```

---

### Task 6: Inbox adopts the shell

This is the largest task in the plan and the first one a user could see. It
replaces the inbox's inline header, tiles and toolbar with shell configuration,
merges the tiles into the rail's filter list, and moves the list into
`handle.body`.

**Files:**
- Modify: `static/js/dashboard/dashboard-inbox.js:3506-4014` (`render`)
- Modify: `static/js/dashboard/dashboard-inbox.js:3392-3409` (`renderLegend`)
- Modify: `static/js/dashboard/dashboard-inbox-loader.js:31-44` (`_loadDependencies`)
- Modify: `static/css/dashboard-inbox.css`
- Test: `tests/inbox-shell-adoption.spec.js`
- Test: `tests/inbox-header-compact.spec.js` (rewrite — see Task 8)

**Interfaces:**
- Consumes: everything produced by Tasks 1–5.
- Produces:
  - `DashboardInbox.prototype.shell` — the mounted handle, or `null` before the
    first render.
  - `DashboardInbox.prototype.mountShell()` — mounts once, idempotent.
  - `DashboardInbox.prototype.shellConfig()` — builds the config object.
  - `#dashboard-layout` keeps its `inbox-layout` class (probed by
    `restoreViewIfNeeded` at `:1506` and by `e2e-helpers.js:264`).
- Data-attribute contract, unchanged from today:
  `data-inbox-filter`, `data-inbox-tile`, `data-inbox-search`, `data-inbox-sort`,
  `data-inbox-domain-filter`, `data-inbox-toolbar-more`, `data-inbox-menu`,
  `data-inbox-bulk`, `data-inbox-export`, `data-inbox-import`, `data-inbox-stats`.
- The merged filter rows carry **both** `data-inbox-filter="<key>"` and
  `data-inbox-tile="<key>"` for `all`, `unread` and `snoozed`. "This week" is a
  readout, not a filter: it becomes a `summary` entry and keeps **no**
  `data-inbox-tile` attribute, because it never had a filter to agree with.

- [ ] **Step 1: Write the failing test**

Create `tests/inbox-shell-adoption.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markInboxTutorialSeen } = require('./e2e-helpers');

/**
 * The inbox on the shared shell. Everything here drives the real view through
 * the controls a person would use, not through render functions.
 */
async function openInbox(page, titles = ['Alpha', 'Beta', 'Gamma']) {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const title of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://s-${title}-${Date.now()}.example/x`, title }),
            });
        }
    }, titles);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length)).toBeGreaterThan(0);
}

test('the inbox renders inside the shared shell', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('#dashboard-layout.inbox-layout .lvs')).toHaveCount(1);
    await expect(page.locator('.lvs-rail')).toBeVisible();
    await expect(page.locator('.lvs-header .lvs-title')).toHaveText(/inbox/i);
    // The feed lives in the shell's body, not loose in the container.
    await expect(page.locator('.lvs-body .inbox-feed')).toHaveCount(1);
});

test('the filters live in the rail and still answer to their data attributes', async ({ page }) => {
    await openInbox(page);
    const railFilters = page.locator('.lvs-rail [data-inbox-filter]');
    await expect(railFilters).not.toHaveCount(0);

    // The old selectors still resolve — this is the contract the other specs rely on.
    await page.locator('[data-inbox-filter="unread"]').click();
    await expect(page.locator('.lvs-rail [data-inbox-filter="unread"]')).toHaveClass(/is-active/);
});

test('the tiles are gone as a separate row and folded into the filters', async ({ page }) => {
    await openInbox(page);

    // No second copy of the same control.
    await expect(page.locator('.inbox-tiles')).toHaveCount(0);

    // But the tile hooks still resolve, on the merged rail rows.
    for (const key of ['all', 'unread', 'snoozed']) {
        const merged = page.locator(`.lvs-rail [data-inbox-tile="${key}"]`);
        if (await merged.count() === 0) continue; // snoozed hides at zero, as before
        await expect(merged).toHaveAttribute('data-inbox-filter', key);
    }
});

test('"this week" is a readout in the summary, not a filter', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.lvs-summary')).toBeVisible();
    await expect(page.locator('[data-inbox-tile="week"]'),
        '"this week" must not pretend to be a filter').toHaveCount(0);
});

test('search, sort and the overflow menu keep their hooks', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('[data-inbox-search]')).toBeVisible();
    await expect(page.locator('[data-inbox-sort]')).toBeVisible();

    await page.locator('[data-inbox-toolbar-more]').click();
    await expect(page.locator('[data-inbox-menu]')).toBeVisible();
    for (const sel of ['[data-inbox-export="csv"]', '[data-inbox-export="json"]',
        '[data-inbox-import]', '[data-inbox-stats]']) {
        await expect(page.locator(sel), `${sel} missing from the menu`).toBeVisible();
    }
});

test('Triage sits in the header, reachable while the list is scrolled', async ({ page }) => {
    await openInbox(page, Array.from({ length: 40 }, (_, i) => `Item ${i}`));
    await expect(page.locator('.lvs-header .inbox-triage-btn')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(350);
    const inView = await page.evaluate(() => {
        const box = document.querySelector('.inbox-triage-btn').getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    expect(inView, 'Triage scrolled out of reach').toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-shell-adoption.spec.js > /tmp/pw-t6.log 2>&1; echo "exit=$?"; tail -80 /tmp/pw-t6.log
```

Expected: FAIL on the first assertion — `.lvs` has count 0 inside
`.inbox-layout`, because the inbox still builds its own chrome.

- [ ] **Step 3: Load the shell as an inbox dependency**

In `static/js/dashboard/dashboard-inbox-loader.js`, extend `_loadDependencies`
so the shell is present before the view constructs. Follow the existing
bare-global convention used for `DashboardInboxTriage`:

```js
    async _loadDependencies() {
        const load = window.LazyScript.loadScriptOnce;
        if (typeof window.ListViewShell === 'undefined') {
            await load('js/shared/list-view-shell.js', 'listViewShell',
                () => typeof window.ListViewShell !== 'undefined');
        }
        // Tested as bare globals rather than window properties, which is how
        // these two classes are declared.
        if (typeof DashboardInboxTriage === 'undefined') {
            await load('js/dashboard/dashboard-inbox-triage.js', 'dashboardInboxTriage',
                () => typeof DashboardInboxTriage === 'function');
        }
        if (typeof DashboardInbox === 'undefined') {
            await load('js/dashboard/dashboard-inbox.js', 'dashboardInboxModule',
                () => typeof DashboardInbox === 'function');
        }
    }
```

- [ ] **Step 4: Add `shellConfig()` and `mountShell()` to the inbox**

In `static/js/dashboard/dashboard-inbox.js`, add these two methods next to
`render()`:

```js
    /** The rail rows: the old pills and the old tiles, merged into one list. */
    shellConfig() {
        const snoozed = this.snoozedCount();
        const noted = this.filterCount('noted');
        const rows = [
            { key: 'all', label: this.t('dashboard.inboxFilterAll', 'All'), tile: true },
            { key: 'unread', label: this.t('dashboard.inboxFilterUnread', 'Unread'), tile: true },
            { key: 'snoozed', label: this.t('dashboard.inboxFilterSnoozed', 'Snoozed'),
              tile: true, show: snoozed > 0 || this.filter === 'snoozed' },
            { key: 'noted', label: this.t('dashboard.inboxFilterNoted', 'With note'),
              show: noted > 0 || this.filter === 'noted' },
        ].filter((row) => row.show !== false);

        return {
            id: 'inbox',
            title: this.t('dashboard.inboxPageTitle', 'Inbox'),
            description: this.t('dashboard.inboxSubtitle', 'Links saved to read or review later'),
            density: true,
            t: (key, fallback) => this.t(key, fallback),
            activeFilter: this.filter,
            // Specs select `[data-inbox-filter="all"] .inbox-filter-count`, so
            // the old class names ride along with the shell's own.
            filterClass: 'inbox-filter-btn',
            filterCountClass: 'inbox-filter-count',
            filters: rows.map((row) => ({
                key: row.key,
                label: row.label,
                count: this.filterCount(row.key),
                dataAttrs: row.tile
                    ? { 'data-inbox-filter': row.key, 'data-inbox-tile': row.key }
                    : { 'data-inbox-filter': row.key },
            })),
            summary: [
                { key: 'week', label: this.t('dashboard.inboxTileWeek', 'This week'),
                  value: this.weekAddedCount() },
            ],
            onFilter: (key, via) => this.applyFilter(key, via),
        };
    }

    /** Mounts the shell once; later renders reuse it. */
    mountShell() {
        const container = document.getElementById('dashboard-layout');
        if (!container) return null;
        if (this.shell && container.contains(this.shell.root)) {
            return this.shell;
        }
        container.innerHTML = '';
        container.className = 'inbox-layout';
        this.shell = window.ListViewShell.mount(container, this.shellConfig());
        this.buildToolbar(this.shell.toolbar);
        this.buildHeaderActions(this.shell.headerActions);
        return this.shell;
    }
```

Initialise `this.shell = null;` in the constructor beside the other fields.

- [ ] **Step 5: Extract the toolbar and header actions**

Move the toolbar markup that currently lives inline at `:3680-3711` into a
method `buildToolbar(host)`, keeping every `data-*` hook exactly as it is today,
but dropping the `.inbox-filter-strip` block (the filters now live in the rail)
and dropping the `.inbox-toolbar-actions` block (those move to the header):

```js
    buildToolbar(host) {
        const showDomainSelect = this.domainOptions().length > 1;
        host.innerHTML = `
            ${showDomainSelect ? `<select class="inbox-domain-select" data-inbox-domain-filter></select>` : ''}
            <input type="search" class="inbox-search-input" data-inbox-search
                placeholder="${this.escape(this.t('dashboard.inboxSearchPlaceholder', 'Search inbox…'))}">
            ${this.filter === 'snoozed' ? '' : `<select class="inbox-sort-select" data-inbox-sort></select>`}
        `;
        this.bindToolbar(host);
    }
```

and the actions into `buildHeaderActions(host)`, preserving
`data-inbox-toolbar-more`, `data-inbox-menu` and every menu item hook:

```js
    buildHeaderActions(host) {
        host.innerHTML = `
            <button type="button" class="lvs-action lvs-action--primary inbox-triage-btn inbox-triage-btn--primary">
                ${this.escape(this.t('dashboard.inboxTriage', 'Triage'))} <kbd>t</kbd>
            </button>
            <span class="inbox-menu-wrap">
                <button type="button" class="lvs-action inbox-toolbar-more" data-inbox-toolbar-more>⋯</button>
                <div class="inbox-menu" role="menu" hidden data-inbox-menu></div>
            </span>
            <button type="button" class="lvs-action view-help-btn inbox-help-btn" data-inbox-help>ℹ</button>
        `;
        this.bindHeaderActions(host);
    }
```

Move the existing listener wiring from `:3712-3876` into `bindToolbar(host)` and
`bindHeaderActions(host)` unchanged, minus the filter-pill block (the shell now
reports through `onFilter`) — that block's body becomes the `applyFilter` method
in the next step.

- [ ] **Step 6: Promote `applyFilter` from a closure to a method**

The local closure at `:3713-3730` becomes a method, so the shell's `onFilter`
can call it:

```js
    applyFilter(key, via) {
        this.filter = key || 'all';
        this._trackAction('filter', { filter: this.filter, via });
        this.visibleLimit = 50;
        // Ticks from the previous filter would act on rows the user can no
        // longer see, so a filter change starts the selection over.
        this.checkedIds.clear();
        this.checkAnchorId = null;
        this.focusItemId = null;
        this.persistViewState();
        this.syncUrlState();
        this.render();
        this.dash.pageNav?.updatePageTitle?.();
        this.dash.pageNav?.updateDocumentTitle?.();
    }
```

Then point the three remaining duplicates at it. The tile handler at
`:3612-3625` disappears with the tiles. The domain select (`:3771-3787`) and
sort select (`:3758-3768`) keep their own bodies for now — they change a
different axis and are consolidated in Task 7.

- [ ] **Step 7: Rewrite `render()` to repaint only the body**

Replace the teardown preamble at `:3524-3545` and the append sequence. The new
shape:

```js
    render() {
        const d = this.dash;
        const shell = this.mountShell();
        if (!shell) return;

        d._abortInlineEditForRender?.();
        d.updateTagFilterIndicator?.();
        this._teardownLoadMoreObserver();

        if (this.pruneDomainFilter()) {
            this.syncUrlState();
        }

        const filtered = this.getFilteredItems();
        shell.setActive(this.filter);
        shell.setCounts({
            all: this.filterCount('all'),
            unread: this.filterCount('unread'),
            snoozed: this.filterCount('snoozed'),
            noted: this.filterCount('noted'),
        });
        shell.setSummary([{ key: 'week',
            label: this.t('dashboard.inboxTileWeek', 'This week'),
            value: this.weekAddedCount() }]);
        shell.setBreadcrumb(this.headerBreadcrumb());

        const body = shell.body;
        body.innerHTML = '';
        // ... the existing note / stats / empty-state / feed / sentinel /
        //     snoozed-footer / legend sequence, appending to `body`
        //     instead of `container`, and returning early exactly as before.
    }
```

Every `container.appendChild(x)` in the old body becomes `body.appendChild(x)`.
The four early-exit branches keep their structure; they now clear and fill
`body` rather than the whole container.

**Delete** `preserveSearch`, `searchCaret` and the whole
`finishInboxRenderFocus` call chain: the search input is in the toolbar, which
the shell owns and this render never touches, so the caret cannot move. Keep
`this._searchFocusPending = false;` removal too — the flag exists only to serve
that workaround. Replace the final call with the parts that are still needed:

```js
        this.syncKeyboardSelectionAfterRender();
        this.schedulePreviewRefresh();
        this.scheduleWakeRefresh();
        this.applyPendingItemFocus();
        this.announceListState(filtered.length);
```

- [ ] **Step 8: Point `closeInboxView` at the shell**

In `closeInboxView()` (`:1613`), destroy the shell so a re-open mounts cleanly:

```js
        this.shell?.destroy?.();
        this.shell = null;
```

immediately after `this._teardownLoadMoreObserver();`.

- [ ] **Step 9: Run the new spec**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-shell-adoption.spec.js > /tmp/pw-t6.log 2>&1; echo "exit=$?"; tail -80 /tmp/pw-t6.log
```

Expected: PASS, 6 tests.

- [ ] **Step 10: Run the inbox regression set**

Only the specs that touch the inbox **and can still pass at this point** — not
the full suite:

```bash
PW_WORKERS=2 npx playwright test tests/inbox-explainers.spec.js tests/inbox-selection-actions.spec.js tests/inbox-lazy-load.spec.js tests/inbox-triage-keys.spec.js tests/inbox-triage-finishes.spec.js tests/browser-history.spec.js tests/analytics-view-events.spec.js > /tmp/pw-t6b.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-t6b.log | tail -5
```

Expected: PASS. These select by `data-inbox-*` and by the two class names the
`filterClass` / `filterCountClass` pass-through preserves. Any failure here is a
contract break — fix the shell or the config, do not loosen the spec.

**Deliberately excluded, and expected to be red until Task 8:**
`inbox-tiles-date.spec.js`, `inbox-snoozed-counts.spec.js`,
`inbox-view-fixes.spec.js`, `inbox-header-compact.spec.js`,
`layout-modern-inbox.spec.js`, `dashboard-inbox.spec.js`,
`view-resize-layout.spec.js`. Each selects something this task removes on
purpose — `.inbox-tiles`, `button.inbox-tile`, `.inbox-tile-value`,
`.inbox-count-badge`, `.inbox-subtitle`, `.inbox-header`. Do not try to keep
them green by re-adding the removed markup; Task 8 rewrites them against the
view that now exists.

- [ ] **Step 11: Look at it in a browser**

```bash
PORT=8099 NEXTDASH_DATA_DIR=/tmp/nextdash-probe go run .
```

Open `http://localhost:8099/#inbox`, and check by hand: the rail shows the
filters with counts, the summary shows "this week", the header keeps Triage on
screen while you scroll, the density toggle changes row height, and typing in
the search box does not move the caret. Stop the server when done.

- [ ] **Step 12: Commit**

```bash
git add static/js/dashboard/dashboard-inbox.js static/js/dashboard/dashboard-inbox-loader.js static/css/dashboard-inbox.css tests/inbox-shell-adoption.spec.js
git commit -m "put the inbox on the shared shell"
```

---

### Task 7: Consolidate the remaining re-render duplicates

**Files:**
- Modify: `static/js/dashboard/dashboard-inbox.js` (domain select, sort select, search debounce)
- Test: `tests/inbox-rerender-consistency.spec.js`

**Interfaces:**
- Consumes: `applyFilter` from Task 6.
- Produces: `DashboardInbox.prototype.applyViewChange(patch, options)` where
  `patch` is a partial of `{ filter, sort, domainFilter, searchQuery }` and
  `options` is
  `{ via: string, action?: string, resetSelection?: boolean, persist?: boolean }`.
  `resetSelection` defaults to `true`, `persist` defaults to `true`, and
  `action` defaults to `Object.keys(patch)[0] || 'change'`.
  `action` exists because the search call passes an **empty** patch — the query
  is already assigned by the input handler before the debounce fires — so
  deriving the analytics label from the patch keys alone would log `undefined`.
  `applyFilter(key, via)` becomes a thin call into it.

- [ ] **Step 1: Write the failing test**

Create `tests/inbox-rerender-consistency.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');

/**
 * Four handlers used to carry four slightly different copies of the same
 * reset-and-render sequence: the tile handler skipped the page-title updates,
 * the sort handler skipped the selection reset. Whichever behaviour is right,
 * it should be the same one everywhere.
 */
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markInboxTutorialSeen } = require('./e2e-helpers');

async function openInboxWithItems(page) {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (let i = 0; i < 6; i += 1) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://c${i}-${Date.now()}.example/x`, title: `C ${i}` }),
            });
        }
    });
    await page.locator('#page-nav-inbox-btn').click();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length)).toBeGreaterThan(0);
}

test('changing the sort clears the selection, like every other axis', async ({ page }) => {
    await openInboxWithItems(page);

    await page.evaluate(() => {
        const inbox = window.dashboardInstance.inbox;
        inbox.checkedIds.add(inbox.items[0].id);
        inbox.checkAnchorId = inbox.items[0].id;
    });

    await page.locator('[data-inbox-sort]').selectOption('oldest');

    const state = await page.evaluate(() => ({
        checked: window.dashboardInstance.inbox.checkedIds.size,
        anchor: window.dashboardInstance.inbox.checkAnchorId,
    }));
    expect(state).toEqual({ checked: 0, anchor: null });
});

test('every axis change goes through one path', async ({ page }) => {
    await openInboxWithItems(page);

    const calls = await page.evaluate(async () => {
        const inbox = window.dashboardInstance.inbox;
        const seen = [];
        const original = inbox.applyViewChange.bind(inbox);
        inbox.applyViewChange = (patch, options) => {
            seen.push({ patch: Object.keys(patch), via: options?.via });
            return original(patch, options);
        };
        document.querySelector('[data-inbox-filter="unread"]').click();
        const sort = document.querySelector('[data-inbox-sort]');
        sort.value = 'oldest';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
        return seen;
    });

    expect(calls.map((c) => c.patch[0])).toEqual(['filter', 'sort']);
    expect(calls.every((c) => typeof c.via === 'string')).toBe(true);
});

test('the search box keeps its caret while the list repaints', async ({ page }) => {
    await openInboxWithItems(page);

    const search = page.locator('[data-inbox-search]');
    await search.click();
    await search.type('C 1', { delay: 60 });
    await page.waitForTimeout(300);

    const caret = await page.evaluate(() => {
        const el = document.querySelector('[data-inbox-search]');
        return { focused: document.activeElement === el, start: el.selectionStart, value: el.value };
    });

    expect(caret.focused, 'the search box lost focus during a repaint').toBe(true);
    expect(caret.value).toBe('C 1');
    expect(caret.start, 'the caret jumped').toBe(4);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-rerender-consistency.spec.js > /tmp/pw-t7.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t7.log
```

Expected: the first two FAIL — the sort handler does not reset the selection,
and `applyViewChange` does not exist. The third may already pass after Task 6;
that is fine, it is a guard against regression.

- [ ] **Step 3: Write the single path**

```js
    /**
     * One reset-and-render for every axis. The handlers used to differ on which
     * of these steps they performed, which showed up as ticks surviving a sort
     * but not a filter.
     */
    applyViewChange(patch, options = {}) {
        const {
            via = 'unknown',
            action = Object.keys(patch)[0] || 'change',
            resetSelection = true,
            persist = true,
        } = options;
        Object.assign(this, patch);
        this._trackAction(action, { ...patch, via });
        this.visibleLimit = 50;
        if (resetSelection) {
            this.checkedIds.clear();
            this.checkAnchorId = null;
            this.focusItemId = null;
        }
        if (persist) {
            this.persistViewState();
        }
        this.syncUrlState();
        this.render();
        this.dash.pageNav?.updatePageTitle?.();
        this.dash.pageNav?.updateDocumentTitle?.();
    }

    applyFilter(key, via) {
        this.applyViewChange({ filter: key || 'all' }, { via });
    }
```

- [ ] **Step 4: Point the remaining handlers at it**

Sort select — replace the body at `:3758-3768`:

```js
        host.querySelector('[data-inbox-sort]')?.addEventListener('change', (event) => {
            this.applyViewChange({ sort: event.target.value }, { via: 'select' });
        });
```

Domain select — replace the body at `:3771-3787`:

```js
        host.querySelector('[data-inbox-domain-filter]')?.addEventListener('change', (event) => {
            this.applyViewChange({ domainFilter: event.target.value }, { via: 'select' });
        });
```

Search debounce — in `scheduleSearchRender` (`:3459-3480`), replace the inline
reset with the shared path, keeping search out of persistence:

```js
            this.applyViewChange({}, { via: 'search', action: 'search', persist: false });
```

Note the empty patch: `searchQuery` is already assigned by the input handler
before the debounce fires, so the patch carries nothing new — which is exactly
why `action` must be passed explicitly here. `persist: false` preserves the
existing rule that search is deliberately not stored (`:805-807`, `:864-865`).

- [ ] **Step 5: Run the tests to verify they pass**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-rerender-consistency.spec.js tests/inbox-shell-adoption.spec.js > /tmp/pw-t7.log 2>&1; echo "exit=$?"; tail -60 /tmp/pw-t7.log
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Re-run the inbox regression set**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-inbox.spec.js tests/inbox-explainers.spec.js tests/inbox-selection-actions.spec.js tests/inbox-snoozed-counts.spec.js tests/inbox-view-fixes.spec.js tests/browser-history.spec.js > /tmp/pw-t7b.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-t7b.log | tail -5
```

Expected: PASS. `browser-history.spec.js` is the one that most directly exercises
filter changes through the URL, so a failure there points at `syncUrlState`
ordering inside `applyViewChange`.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-inbox.js tests/inbox-rerender-consistency.spec.js
git commit -m "give the inbox one path for every view change"
```

---

### Task 8: Retire and rewrite the specs whose premise changed

**Files:**
- Rewrite: `tests/inbox-header-compact.spec.js`
- Modify: `tests/inbox-tiles-date.spec.js`
- Modify: `tests/inbox-snoozed-counts.spec.js`
- Modify: `tests/inbox-view-fixes.spec.js:103-104`
- Modify: `tests/layout-modern-inbox.spec.js:122`
- Modify: `tests/dashboard-inbox.spec.js:283`
- Modify: `tests/view-resize-layout.spec.js:32`
- Check (probably untouched): `tests/config-keyboard-legend-style.spec.js:107`

**What actually broke, and why it is not a contract break.** Task 6 preserved
every `data-*` hook and, through `filterClass` / `filterCountClass`, the two
class names specs reach for *inside* a filter row. What it could not preserve is
markup the design deletes outright: `.inbox-tiles`, `button.inbox-tile`,
`.inbox-tile-value`, `.inbox-tile-label`, `.inbox-count-badge`,
`.inbox-subtitle` and `.inbox-header`. Those specs describe a view that no longer
exists. Repoint them; do not re-add the markup to satisfy them.

Mapping to use throughout this task:

| Gone | Now |
|---|---|
| `.inbox-tiles` | `.lvs-group--filters` (the rail's filter list) |
| `button.inbox-tile[data-inbox-tile="X"]` | `.lvs-rail [data-inbox-tile="X"]` |
| `.inbox-tile-value` | `.lvs-filter-count` |
| `.inbox-tile-label` | `.lvs-filter-label` |
| `.inbox-tiles > .inbox-tile:not([data-inbox-tile]) .inbox-tile-value` | `.lvs-summary [data-lvs-summary-key="week"] .lvs-summary-value` |
| `.inbox-count-badge` | `.lvs-rail [data-inbox-filter="all"] .lvs-filter-count` |
| `.inbox-subtitle` | `.lvs-description` |
| `.inbox-header` | `.lvs-header` |

**Interfaces:**
- Consumes: the finished inbox from Tasks 6–7.
- Produces: no runtime interface. This task makes the suite describe the view
  that now exists.

- [ ] **Step 1: Establish the baseline**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-header-compact.spec.js tests/inbox-tiles-date.spec.js tests/inbox-snoozed-counts.spec.js tests/inbox-view-fixes.spec.js tests/layout-modern-inbox.spec.js tests/dashboard-inbox.spec.js tests/view-resize-layout.spec.js tests/config-keyboard-legend-style.spec.js > /tmp/pw-t8-before.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-t8-before.log | tail -5
```

Record which tests fail and why. Every rewrite below must be justified by one of
these failures — do not touch a test that still passes.

- [ ] **Step 2: Rewrite `inbox-header-compact.spec.js`**

Its six tests were written against the old three-row toolbar. Four of them
assert arrangements that no longer exist and are replaced; two carry forward.

Replace the file's tests with:

```js
test('the summary is a rail block, not a row above the list', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.inbox-tiles')).toHaveCount(0);
    const summary = page.locator('.lvs-rail .lvs-summary');
    await expect(summary).toBeVisible();
    // It sits left of the list, not above it.
    const sides = await page.evaluate(() => ({
        summary: document.querySelector('.lvs-summary').getBoundingClientRect().right,
        feed: document.querySelector('.inbox-feed').getBoundingClientRect().left,
    }));
    expect(sides.summary).toBeLessThanOrEqual(sides.feed);
});

test('every filter is visible without scrolling sideways', async ({ page }) => {
    await openInbox(page);
    const cut = await page.evaluate(() => {
        const rail = document.querySelector('.lvs-group--filters');
        const box = rail.getBoundingClientRect();
        return [...rail.querySelectorAll('[data-inbox-filter]')]
            .filter((el) => el.getBoundingClientRect().right > box.right + 1)
            .map((el) => el.textContent.trim());
    });
    expect(cut).toEqual([]);
});

test('the rare actions stay one click away behind the ⋯', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.inbox-triage-btn')).toBeVisible();
    await expect(page.locator('.inbox-help-btn')).toBeVisible();
    await expect(page.locator('[data-inbox-export="csv"]')).toBeHidden();

    await page.locator('[data-inbox-toolbar-more]').click();
    for (const sel of ['[data-inbox-export="csv"]', '[data-inbox-export="json"]',
        '[data-inbox-import]', '[data-inbox-stats]']) {
        await expect(page.locator(sel), `${sel} missing from the menu`).toBeVisible();
    }
});

test('the menu opens under its button, not at the edge of the window', async ({ page }) => {
    await openInbox(page);
    await page.locator('[data-inbox-toolbar-more]').click();
    const gap = await page.evaluate(() => {
        const button = document.querySelector('[data-inbox-toolbar-more]').getBoundingClientRect();
        const menu = document.querySelector('[data-inbox-menu]').getBoundingClientRect();
        return { dx: Math.abs(menu.left - button.left), dy: menu.top - button.bottom };
    });
    expect(gap.dx).toBeLessThan(40);
    expect(gap.dy).toBeLessThan(24);
});
```

The two dropped tests — "the count sits on the subtitle line" and "Triage and
the menu share a row, with the help button at the far end" — described the
two-row header and the full-width action row. Both arrangements are gone by
design: the meta moved into the rail and the actions moved into the header.
Delete them rather than bending them; the replacement for what they protected is
`Triage sits in the header, reachable while the list is scrolled` in
`tests/inbox-shell-adoption.spec.js`.

- [ ] **Step 3: Repoint the tile specs at the rail**

`tests/inbox-tiles-date.spec.js:40-42` selects `.inbox-tiles .inbox-tile` and
`.inbox-tiles .inbox-tile-label`. Repoint at the merged rail rows:

```js
    const tiles = page.locator('.lvs-rail [data-inbox-tile]');
    const labels = await page.locator('.lvs-rail [data-inbox-tile] .lvs-filter-label').allTextContents();
```

`tests/inbox-snoozed-counts.spec.js` needs three edits. Line 63 selects
`button.inbox-tile[data-inbox-tile="${key}"] .inbox-tile-value`; line 65 selects
the non-filter tile, which is now the summary readout; lines 116-117 click
`button.inbox-tile[data-inbox-tile="all"]` and assert `is-active`; lines 125 and
129 read `.inbox-count-badge`:

```js
    // :63
    page.locator(`.lvs-rail [data-inbox-tile="${key}"] .lvs-filter-count`);
    // :65
    page.locator('.lvs-summary [data-lvs-summary-key="week"] .lvs-summary-value');
    // :116-117 — the merged row is still a button and still takes is-active
    await page.locator('.lvs-rail [data-inbox-tile="all"]').click();
    await expect(page.locator('.lvs-rail [data-inbox-tile="all"]')).toHaveClass(/is-active/);
    // :125, :129 — the header badge's job moved into the rail count
    await expect(page.locator('.lvs-rail [data-inbox-filter="all"] .lvs-filter-count')).toHaveText('2');
```

`tests/inbox-view-fixes.spec.js:103-104` selects
`[data-inbox-tile="all"] .inbox-tile-value` and `.inbox-count-badge`. Line 96
(`[data-inbox-filter="all"] .inbox-filter-count`) needs **no** change — the
class pass-through keeps it working:

```js
    await expect(page.locator('.lvs-rail [data-inbox-tile="all"] .lvs-filter-count')).toHaveText('1');
    await expect(page.locator('.lvs-rail [data-inbox-filter="all"] .lvs-filter-count')).toHaveText('1');
```

`tests/layout-modern-inbox.spec.js:122` compares `.inbox-tile` across layouts.
The tile is gone; the equivalent surface is the rail's filter row:

```js
        const tile = await bothLayouts(page, '.lvs-filter', ['borderRadius', 'boxShadow']);
```

If the shell does not define `borderRadius` or `boxShadow` differently per
layout, this assertion has nothing left to protect — in that case delete the
test rather than assert that two identical values are identical.

`tests/dashboard-inbox.spec.js:283` asserts `.inbox-subtitle` is visible:

```js
        await expect(page.locator('.lvs-description')).toBeVisible();
```

`tests/config-keyboard-legend-style.spec.js:107` only carries a **comment**
naming `.inbox-legend`, and the legend element itself survives Task 6 unchanged.
Run it; if it passes, leave it alone.

- [ ] **Step 4: Widen the resize spec's header probe**

`tests/view-resize-layout.spec.js:32` reads:

```js
        const header = el.querySelector('.health-view-header, .inbox-header, .config-view');
```

The inbox no longer has `.inbox-header`. Add the shell header so the spec keeps
covering the inbox while health is still on the old markup:

```js
        const header = el.querySelector('.health-view-header, .lvs-header, .inbox-header, .config-view');
```

- [ ] **Step 5: Run them**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-header-compact.spec.js tests/inbox-tiles-date.spec.js tests/inbox-snoozed-counts.spec.js tests/inbox-view-fixes.spec.js tests/layout-modern-inbox.spec.js tests/dashboard-inbox.spec.js tests/view-resize-layout.spec.js tests/config-keyboard-legend-style.spec.js tests/view-visual-alignment.spec.js > /tmp/pw-t8.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-t8.log | tail -5
```

Expected: PASS. `view-visual-alignment.spec.js` is included because it compares
inbox against health and config, and the inbox has just changed shape under it.

- [ ] **Step 6: Re-run Task 6's regression set to confirm nothing regressed**

```bash
PW_WORKERS=2 npx playwright test tests/inbox-explainers.spec.js tests/inbox-selection-actions.spec.js tests/inbox-lazy-load.spec.js tests/inbox-triage-keys.spec.js tests/inbox-triage-finishes.spec.js tests/browser-history.spec.js tests/analytics-view-events.spec.js tests/inbox-shell-adoption.spec.js tests/inbox-rerender-consistency.spec.js > /tmp/pw-t8b.log 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-t8b.log | tail -5
```

Expected: PASS. Together with Step 5 this is the complete inbox surface — after
this task no inbox spec should be red.

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "point the inbox specs at the new shell"
```

---

### Task 9: Changelog

**Files:**
- Modify: `CHANGELOG.md` (the `## Unreleased` section)

**Interfaces:**
- Consumes: the finished work from Tasks 1–8.
- Produces: nothing at runtime.

- [ ] **Step 1: Read the surrounding style**

```bash
sed -n '/## Unreleased/,/^## /p' CHANGELOG.md | head -40
```

Match the existing themed sections and the **new** / **fix** labels exactly.

- [ ] **Step 2: Add the entries**

Under `## Unreleased`, in the style the file already uses:

```markdown
### Inbox

- **new** The inbox has a left column. The filters moved there as a list with
  their counts, and "this week" sits above them as a readout — it was the one
  figure that was never a filter. The row of tiles is gone: it showed the same
  counts a second time.
- **new** The header stays put while you scroll, so Triage is reachable from
  anywhere in a long list.
- **new** Rows can be compact or comfortable, and the setting follows you
  between views.
- **fix** Typing in the inbox search box no longer rebuilds the whole view
  behind the cursor.
```

Do not add a What's New modal entry, and do not write a version heading — the
release documentation waits until a version number is set.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "note the inbox redesign in the changelog"
```

---

## Self-Review

**Spec coverage.** Walking the spec section by section:

| Spec requirement | Task |
|---|---|
| Shell module + CSS in `bundle:css-views` | 1 |
| Rail: summary block, filter list, sections block | 2 |
| Rail is 200px, matching config | 1 (CSS) |
| Rail keeps scroll position across repaints | 2 (test) |
| Sticky header collapsing to one bar with breadcrumb | 3 |
| Primary actions in the header | 3, 6 |
| Row anatomy in `feed-row.css`, not a view stylesheet | 4 |
| Density as one app-level setting | 4 |
| Tiles and filters merged into one control | 6 |
| Data-attribute contract preserved | 6 (constraint + tests) |
| `preserveSearch` / `searchCaret` deleted | 6, 7 (test) |
| Four duplicate re-render handlers consolidated | 6, 7 |
| Existing query params untouched | 6 (no change to `syncUrlState`) |
| Narrow-screen rail becomes a horizontal strip at 720px | 1 (CSS) |
| Empty and retry states move into the body | 6 (Step 7) |
| Five locale files | 5 |
| Changelog line, no release docs | 9 |
| Specs whose premise changed | 8 |

Two spec items are deliberately **not** in this plan and belong to the health
plan: the `#health/monitors` destination and the health tile/filter merge over
eleven filters. The scope note says so explicitly.

One gap found and closed while reviewing: the spec says the summary block folds
into the header below 720px and the secondary actions fold into the overflow
menu. Task 1's media query moves the rail but does not do the fold. **Add to
Task 6, Step 7**, after the shell is mounted: nothing to implement in the shell
itself, because at 720px the rail — summary included — already sits above the
main column, which satisfies "folds into the header" in the sense that matters
(it is above the list, not beside it). The secondary-action fold is genuinely
missing; it is covered by the existing behaviour that all secondary actions are
already behind `⋯`, so there is nothing left to fold. No new task needed, but do
not claim the fold as implemented if a reviewer asks.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling".
Task 6 Step 7 contains one `// ...` inside a code block; it names precisely
which existing sequence is being moved and what changes about it (`container` →
`body`), and the surrounding steps give the full contract. That is the one place
the plan describes a move rather than reproducing ~250 lines verbatim.

**Type consistency.** Checked across tasks: `handle.body`, `handle.root`,
`handle.header`, `handle.headerActions`, `handle.rail`, `handle.toolbar`,
`handle.destroy`, `handle.setSummary`, `handle.setCounts`, `handle.setActive`,
`handle.setBreadcrumb` are named identically in every task that uses them.
`config.onFilter(key, via)` matches `applyFilter(key, via)` in Task 6 and
`applyViewChange(patch, options)` in Task 7. `window.ListDensity.get/set/apply`
and `DEFAULT` are consistent between Task 4's module and its tests.
`data-lvs-summary-key` is emitted by `buildSummary` in Task 2 and selected in
Task 8 Step 3 — consistent.
