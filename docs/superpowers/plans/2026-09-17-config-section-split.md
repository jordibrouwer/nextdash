# Config section split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `static/js/dashboard/dashboard-config.js` (27,627 lines) into ten per-section modules loaded on demand, leaving a shell of roughly 8,000 lines.

**Architecture:** Each section becomes a file that calls `Object.assign(DashboardConfig.prototype, {…})`, so `this` keeps its meaning and moving a method is a cut and paste. One new method, `ensureSection(id)`, fetches a section's file at the three navigation points that already await the bookmark renderers; `renderSection()` and the whole draw path stay synchronous. Remaining sections are fetched on idle after the first paint.

**Tech Stack:** Vanilla ES2022 classes, `window.LazyScript.loadScriptOnce`, Playwright for the smoke spec, Go for the asset-hash generator.

**Spec:** `docs/superpowers/specs/2026-09-17-config-section-split-design.md`

## Global Constraints

- Branch: `config-section-split`, cut from `dev`. One commit per section.
- No `this.<state>` access may be rewritten. If a move requires one, stop and report — that is the failure mode this plan exists to avoid.
- Every new file follows the wrapper in `static/js/dashboard/dashboard-config-stats.js`: an IIFE, `if (typeof global.DashboardConfig !== 'function') return;`, one `Object.assign`, and a `window.DashboardConfig<Name>Ready = true` marker at the end.
- `DashboardConfig.SECTIONS` stays the single source of section ids. `dashboard-config-loader.js` mirrors it and `tests/config-lazy-load.spec.js` fails when the two drift.
- After any change under `static/`, run `go run scripts/gen-asset-hashes.go`. Never hand-edit `internal/app/asset_hashes_gen.go`.
- Playwright runs with `PW_WORKERS=2`, output redirected to a file, exit code read from that file — never through a pipe.
- Heavy e2e (the full config suite) and falsification run once, in the last task. Per section only the census, the parse check and the ten-second smoke spec.
- `docs/` is in `.gitignore` in this repo: the spec and this plan are not committed unless the user asks with `-f`.
- Commit subjects: short, plain, lower case, no trailer.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `scripts/config-census.mjs` | Prints every method and static on `DashboardConfig.prototype` / the class, one per line, sorted. The before/after diff is the per-step gate |
| `tests/config-section-smoke.spec.js` | Opens config, walks every section, fails on a console error or an empty body |
| `static/js/dashboard/dashboard-config-logs.js` | Logs section: server log and activity trail |
| `static/js/dashboard/dashboard-config-help.js` | Help section: panels, tips, the art table |
| `static/js/dashboard/dashboard-config-overview.js` | Overview and the news stream |
| `static/js/dashboard/dashboard-config-behavior.js` | Behavior section |
| `static/js/dashboard/dashboard-config-structure.js` | Pages, categories, tags, collections |
| `static/js/dashboard/dashboard-config-data.js` | Data & backups: backup, restore, sources, webhooks, MCP, archive, trash |
| `static/js/dashboard/dashboard-config-widgets.js` | Widgets section |
| `static/js/dashboard/dashboard-config-appearance.js` | Appearance and themes |

**Modified:**

| File | Change |
|---|---|
| `static/js/dashboard/dashboard-config.js` | Gains `ensureSection`, `SECTION_MODULES` and the idle preload; loses one section per task |
| `static/js/dashboard/dashboard-config-loader.js` | No change to `SECTIONS`; the file-name table lives on `DashboardConfig` and is read through it |
| `tests/config-lazy-load.spec.js` | Extended: every section id has a module entry, every module entry has a section id |

**Already extracted, folded into the same machinery in Task 12:** `dashboard-config-bookmarks.js`, `dashboard-config-bookmarks-workbench.js`, `dashboard-config-stats.js`.

---

### Task 1: The safety net

**Files:**
- Create: `scripts/config-census.mjs`
- Create: `tests/config-section-smoke.spec.js`

**Interfaces:**
- Produces: `node scripts/config-census.mjs > /tmp/census-before.txt` — a sorted list of `proto:<name>` and `static:<name>` lines; `tests/config-section-smoke.spec.js` — one spec, walks every section.

- [ ] **Step 1: Write the census script**

```js
// scripts/config-census.mjs
// Every member of DashboardConfig, so a move can be checked against a move.
// Parsed rather than imported: the file is a browser script with no exports,
// and loading it here would need a DOM.
import { readFileSync } from 'node:fs';

const src = readFileSync('static/js/dashboard/dashboard-config.js', 'utf8').split('\n');
const extra = process.argv.slice(2);
const out = new Set();

const scan = (lines, file) => {
    lines.forEach((line, i) => {
        const method = line.match(/^ {4}(?:static |async |\* )*([a-zA-Z_][\w]*)\s*\(/);
        if (method) out.add(`${line.startsWith('    static ') ? 'static' : 'proto'}:${method[1]}`);
        const field = line.match(/^ {4}static ([A-Z_][\w]*)\s*=/);
        if (field) out.add(`static:${field[1]}`);
        // Section modules assign onto the prototype instead of declaring.
        const moved = line.match(/^ {4}(?:async )?([a-zA-Z_][\w]*)\s*\(.*\{\s*$/);
        if (moved && file !== 'core') out.add(`proto:${moved[1]}`);
    });
};

scan(src, 'core');
for (const file of extra) scan(readFileSync(file, 'utf8').split('\n'), file);
console.log([...out].sort().join('\n'));
```

- [ ] **Step 2: Record the starting census**

Run: `node scripts/config-census.mjs > /tmp/census-before.txt && wc -l /tmp/census-before.txt`
Expected: a number around 800. Keep this file for every later task.

- [ ] **Step 3: Write the smoke spec**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Every section draws, with nothing in the console.
 *
 * The cheap gate for the section split: "the method is on the prototype" and
 * "the section draws" are different claims, and an earlier split passed every
 * mechanical check while forty-one behaviour tests failed.
 */
const SECTIONS = ['overview', 'appearance', 'bookmarks', 'structure', 'behavior',
    'data-backups', 'widgets', 'stats', 'help', 'logs', 'about'];

test('every config section draws without a console error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    for (const section of SECTIONS) {
        await page.evaluate((id) => window.dashboardInstance.config.openConfigView(id), section);
        await expect.poll(async () => page.evaluate(
            () => document.querySelector('#config-view, .config-view')?.textContent?.trim().length || 0,
        ), { timeout: 15_000 }).toBeGreaterThan(40);
        expect(errors, `${section} logged: ${errors.join(' | ')}`).toEqual([]);
    }
});
```

- [ ] **Step 4: Run the smoke spec against the unsplit file**

Run: `PW_WORKERS=2 npx playwright test tests/config-section-smoke.spec.js --retries=0 --reporter=line > /tmp/smoke.txt 2>&1; echo $?; grep -E "passed|failed" /tmp/smoke.txt`
Expected: PASS. If it fails now, the spec is wrong — fix it before any code moves.

- [ ] **Step 5: Commit**

```bash
git checkout -b config-section-split
git add scripts/config-census.mjs tests/config-section-smoke.spec.js
git commit -m "add the census and the smoke spec for the config split"
```

---

### Task 2: `ensureSection`, proved on Logs

**Files:**
- Modify: `static/js/dashboard/dashboard-config.js` (add `SECTION_MODULES`, `ensureSection`, `preloadRemainingSections`; await at `openConfigView` ~line 884, `setSection` ~line 4524, and the hash router ~line 866)
- Create: `static/js/dashboard/dashboard-config-logs.js`
- Modify: `tests/config-lazy-load.spec.js`

**Interfaces:**
- Consumes: `/tmp/census-before.txt` from Task 1.
- Produces: `DashboardConfig.SECTION_MODULES` — `{ [sectionId]: { file, datasetKey, ready } }`; `ensureSection(id) → Promise<boolean>`; `window.DashboardConfigLogsReady`.

- [ ] **Step 1: Add the module table and the loader**

In `dashboard-config.js`, under `static SECTIONS`:

```js
    /*
     * Which file holds which section, and how to tell it has landed.
     *
     * One table rather than a method per section: the two that came before
     * this (ensureBookmarkRenderers, ensureStatsRenderers) are the same twelve
     * lines twice, and a third copy would have settled the shape by accident.
     * A section with no entry is one that still lives in this file, which is
     * how this list grows one task at a time.
     */
    static SECTION_MODULES = {
        logs: {
            file: 'js/dashboard/dashboard-config-logs.js',
            datasetKey: 'dashboardConfigLogs',
            ready: () => window.DashboardConfigLogsReady === true,
        },
    };
```

And, beside `ensureStatsRenderers`:

```js
    /**
     * Fetch the file a section's methods live in, once.
     *
     * Awaited where the view changes, never inside the draw: renderSection()
     * returns a string from inside a template literal, so it cannot wait for
     * anything. A failure leaves the reader where they were with a line saying
     * so -- an empty body would read as a section with nothing in it.
     */
    ensureSection(id) {
        const entry = DashboardConfig.SECTION_MODULES[id];
        if (!entry || entry.ready()) return Promise.resolve(true);
        this._sectionPromises = this._sectionPromises || {};
        if (this._sectionPromises[id]) return this._sectionPromises[id];
        this._sectionPromises[id] = window.LazyScript
            .loadScriptOnce(entry.file, entry.datasetKey, entry.ready)
            .then(() => true)
            .catch(() => {
                delete this._sectionPromises[id];
                this.notify(this.t('config.sectionLoadFailed',
                    'That part of config could not be loaded. Check your connection and try again.'), 'error');
                return false;
            });
        return this._sectionPromises[id];
    }

    /**
     * The sections nobody asked for yet, fetched while the tab is idle.
     *
     * One at a time: eleven parallel scripts would queue in front of config's
     * own data fetches, which is the thing this split was meant to speed up.
     */
    preloadRemainingSections() {
        const ids = Object.keys(DashboardConfig.SECTION_MODULES)
            .filter((id) => !DashboardConfig.SECTION_MODULES[id].ready());
        if (!ids.length) return;
        const next = () => {
            const id = ids.shift();
            if (!id) return;
            this.ensureSection(id).then(() => schedule());
        };
        const schedule = () => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(next, { timeout: 4000 });
            } else {
                setTimeout(next, 1200);
            }
        };
        schedule();
    }
```

- [ ] **Step 2: Await it at the three navigation points**

In `openConfigView`, beside the existing `void this.ensureBookmarkRenderers();`:

```js
        void this.ensureSection(targetSection);
```

In `loadAndRender`, beside the bookmarks wait:

```js
        await this.ensureSection(this.section);
```

In `setSection` (the method holding `this.section = section;` around line 4524), before the final `this.render();`:

```js
        if (DashboardConfig.SECTION_MODULES[section] && !DashboardConfig.SECTION_MODULES[section].ready()) {
            void this.ensureSection(section).then(() => {
                if (this.section !== section) return;
                this.render();
                this.restoreConfigHash();
            });
            return;
        }
```

At the end of `loadAndRender`, after `this.render();`:

```js
        this.preloadRemainingSections();
```

- [ ] **Step 3: Move the Logs methods**

Cut these from `dashboard-config.js` and paste them, unchanged, into `static/js/dashboard/dashboard-config-logs.js`: `logsTabLabel`, `renderLogsSection`, `renderLogsTab`, `renderActivityTrail`, `bindActivityResetButton`, `syncActivityResetButton`, `activityChannelsAreDefault`, `serverLogLiveNote`, `serverLogFloorNote`, `renderServerLogTiles`, `logRetentionLabel`, `renderServerLogLines`, `bindLogSettingsPopover`, `bindActivityTrailControls`, `computeActivity`, `bindActivityChartTooltip`, plus the statics `LOGS_TABS` and `ACTIVITY_CHANNEL_DEFAULTS`.

Anything named above that another section calls stays where it is instead — check with `grep -n "\.<name>(" static/js/dashboard/dashboard-config.js` before moving it. `renderLogsSection` is the anchor and must move.

File skeleton:

```js
/**
 * Config → Logs: the server log and the activity trail.
 *
 * Split one section at a time, deliberately: an earlier attempt to lift the
 * whole of config out at once failed on forty-one tests, and the failures did
 * not name the method that had moved.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    global.DashboardConfig.LOGS_TABS = ['server', 'trail'];
    global.DashboardConfig.ACTIVITY_CHANNEL_DEFAULTS = { /* moved verbatim */ };

    Object.assign(global.DashboardConfig.prototype, {

        /* moved methods, verbatim, comma-separated */

    });

    global.DashboardConfigLogsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
```

Add the `<script>` tag? **No.** The file is fetched by `ensureSection`; it must not be in `templates/dashboard.html`.

- [ ] **Step 4: Census diff**

Run:
```bash
node scripts/config-census.mjs static/js/dashboard/dashboard-config-logs.js > /tmp/census-after.txt
diff /tmp/census-before.txt /tmp/census-after.txt
```
Expected: no output. Any line means a member was lost, gained or renamed.

- [ ] **Step 5: Parse and order check**

Run:
```bash
node --check static/js/dashboard/dashboard-config.js
node --check static/js/dashboard/dashboard-config-logs.js
grep -c "DashboardConfig" static/js/dashboard/dashboard-config-logs.js
go run scripts/gen-asset-hashes.go
```
Expected: both parse; the guard line `if (typeof global.DashboardConfig !== 'function') return;` is the first use of `DashboardConfig` in the new file.

- [ ] **Step 6: Extend the lazy-load spec**

```js
test('every section has a module entry, and every entry a section', async ({ page }) => {
    await page.goto('/#config/overview');
    await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 15_000 });
    const seen = await page.evaluate(() => ({
        sections: window.DashboardConfig.SECTIONS,
        modules: Object.keys(window.DashboardConfig.SECTION_MODULES),
    }));
    for (const id of seen.modules) {
        expect(seen.sections, `${id} has a file but is not a section`).toContain(id);
    }
});
```

- [ ] **Step 7: Run the gate**

Run: `PW_WORKERS=2 npx playwright test tests/config-section-smoke.spec.js tests/config-lazy-load.spec.js --retries=0 --reporter=line > /tmp/smoke.txt 2>&1; echo $?; grep -E "passed|failed" /tmp/smoke.txt`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add static/js/dashboard/dashboard-config.js static/js/dashboard/dashboard-config-logs.js tests/config-lazy-load.spec.js internal/app/asset_hashes_gen.go
git commit -m "load the logs section on demand"
```

---

### Tasks 3–10: one section each

Each of these repeats Task 2's steps 3 to 8 exactly, with the section's own
names. The machinery already exists; only the table gains an entry.

For every task:

1. **Find the members.** `node scripts/config-census.mjs` gives the full list; the section's own are the ones whose names carry its subject. Check each candidate for callers elsewhere with `grep -n "this\.<name>(" static/js/dashboard/*.js`. A method called from two sections stays in the core.
2. **Move them verbatim** into the new file, with the wrapper from Task 2 step 3 and the section's own statics.
3. **Add the table entry** in `DashboardConfig.SECTION_MODULES`.
4. **Census diff** — must be empty.
5. **Parse, hashes, smoke spec** — all green.
6. **Commit**, one section per commit.

| Task | Section id | File | Anchor method | Statics that move | Approx. lines |
|---|---|---|---|---|---|
| 3 | `help` | `dashboard-config-help.js` | `renderHelp` (line 25862) | `HELP_PANEL_ART` (line 26188), `HELP_PANEL_SEE_ALSO` (26076), `HELP_PANEL_FEATURES` (26711), `HELP_PANEL_MOVED` (26064), `HELP_TABS` (25806). `HELP_JUMP_PANELS` (2722) stays: the settings search reads it | 1,549 |
| 4 | `overview` | `dashboard-config-overview.js` | `renderOverview` | none — the overview declares no statics of its own | 835 |
| 5 | `behavior` | `dashboard-config-behavior.js` | `renderBehavior` (13914) | none | 1,083 |
| 6 | `structure` | `dashboard-config-structure.js` | `renderPagesTags` (15085) | none | 2,118 |
| 7 | `data-backups` | `dashboard-config-data.js` | `renderDataBackups` | none | 2,449 |
| 8 | `widgets` | `dashboard-config-widgets.js` | `renderWidgetsSection` (14895) | `WIDGET_SETTINGS`, `WIDGET_TYPES` | 3,040 |
| 9 | `appearance` | `dashboard-config-appearance.js` | `renderAppearance` (line 8835) | `INK_GAP_STEPS` (11360) | 3,377 |
| 10 | `about` | folded into `dashboard-config-overview.js` | `renderAbout` (27142) | none | ~300 |

**Two warnings, both learned from the reverted attempt:**

- `behaviorSchema`, `renderControlPanels`, `panelsFor`, `setBehavior`, `FIELD_META`, `t`, `notify`, `writeFetch`, `confirmAction`, `guardUniqueName`, `renderTile` and `saveSettingsWithFeedback` **never move**, whichever section they look like they belong to.
- If a move would need a `this.<state>` rewritten, it is not a move. Leave the method in the core and note it in the commit message.

---

### Task 11: Fold the three earlier extractions into the table

**Files:**
- Modify: `static/js/dashboard/dashboard-config.js`

**Interfaces:**
- Consumes: `ensureSection` from Task 2.
- Produces: `SECTION_MODULES` entries for `bookmarks` and `stats`; `ensureBookmarkRenderers` and `ensureStatsRenderers` reduced to thin wrappers.

- [ ] **Step 1: Add the two entries**

```js
        bookmarks: {
            file: 'js/dashboard/dashboard-config-bookmarks.js',
            datasetKey: 'dashboardConfigBookmarks',
            ready: () => window.DashboardConfigBookmarksReady === true,
            // The workbench and the model come with it; order matters, so this
            // one keeps its own chain rather than being a plain fetch.
            chain: true,
        },
        stats: {
            file: 'js/dashboard/dashboard-config-stats.js',
            datasetKey: 'dashboardConfigStats',
            ready: () => window.DashboardConfigStatsReady === true,
        },
```

- [ ] **Step 2: Keep the two old names as wrappers**

```js
    ensureStatsRenderers() {
        return this.ensureSection('stats').then((ok) => {
            if (ok && this.isActiveView() && this.section === 'stats') this.repaintStatsBody();
            return ok;
        });
    }
```

`ensureBookmarkRenderers` keeps its three-script chain: `ensureSection` handles the single-file case, and the bookmarks entry is marked `chain: true` so `ensureSection` defers to it.

- [ ] **Step 3: Gate**

Run: `PW_WORKERS=2 npx playwright test tests/config-section-smoke.spec.js tests/config-lazy-load.spec.js tests/config-bookmarks-editor.spec.js tests/config-stats.spec.js tests/config-stats-lazy.spec.js --retries=0 --reporter=line > /tmp/smoke.txt 2>&1; echo $?; grep -E "passed|failed" /tmp/smoke.txt`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add static/js/dashboard/dashboard-config.js internal/app/asset_hashes_gen.go
git commit -m "load every config section through one table"
```

---

### Task 12: The closing round

**Files:**
- No source changes expected. Any fix found here is its own commit.

- [ ] **Step 1: The whole config suite**

Run:
```bash
PW_WORKERS=2 npx playwright test $(ls tests/config-*.spec.js) tests/dashboard-command-palette.spec.js tests/search-scope-rail.spec.js --retries=0 --reporter=line > /tmp/full.txt 2>&1
echo $?; grep -E "passed|failed|^\s+[0-9]+\) " /tmp/full.txt | head -30
```
Expected: the same failures the branch started with, and no others. Compare against `dev` before blaming the split.

- [ ] **Step 2: Falsify the smoke spec, once per section**

For each of the ten files, in turn: rename its anchor method (for example `renderHelp` to `renderHelpX`), run the smoke spec, see it fail naming that section, then put the name back.

Run: `PW_WORKERS=2 npx playwright test tests/config-section-smoke.spec.js --retries=0 --reporter=line > /tmp/falsify.txt 2>&1; echo $?`
Expected: exit 1 with the section named; exit 0 once the name is restored.

- [ ] **Step 3: Measure the win**

```bash
wc -l static/js/dashboard/dashboard-config*.js
ls -la static/js/dashboard/dashboard-config*.js | awk '{s+=$5} END {print s" bytes total"}'
```
Then, with a server on port 8099 and a data copy, open config and read the transferred bytes for `dashboard-config*.js` off the network panel. Record the before (1,415,820 bytes in one file) and the after in the commit message.

- [ ] **Step 4: Commit the measurement**

```bash
git commit --allow-empty -m "record what config now fetches when it opens"
```

---

## Notes for whoever runs this

- The census diff is the cheapest thing here and the one that catches the most. Run it before the smoke spec every time.
- A section that will not come apart cleanly is a finding, not a failure: leave it in the core, commit what did move, and say so.
- `dashboard-config.js` will still be the largest file in the repo when this is done. That is fine — 8,000 lines of shell and schema is a different problem from 27,627 lines of everything.
