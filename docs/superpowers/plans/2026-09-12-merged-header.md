# Merged Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The view name appears exactly once on a page, inside the existing header row, and the full-width band that held nothing but a giant word is gone.

**Architecture:** Today a page carries the name twice. `templates/dashboard.html` renders a `.dashboard-section.section-title` band holding `<h1 class="title">` at `--font-size-title` (3rem), and on inbox and health `ListViewShell.mount()` draws it again as `.lvs-title` with a `.lvs-description` under it. The band is deleted, `.header-top-primary` gains a title block beside the clock and weather, `updatePageTitle()` writes there, and the shell stops drawing a title of its own — it publishes its title and description to that same block and keeps only its actions row.

**Tech Stack:** Go `html/template`, vanilla ES (no build step), hand-written CSS custom properties, Playwright for e2e.

**Spec:** `.superdesign/design-system.md` — "The page title eats the screen" and "One header bar, never two". Visual reference: drafts `1ec0f48b` (dashboard) and `f413ccd3` (health) on the Superdesign canvas.

## Global Constraints

- Colours come only from theme tokens or `color-mix()` on them. No hex literals, no `rgba(255,255,255,…)`, no `rgba(0,0,0,…)`, no bare `black`.
- CSP is `script-src 'self'`. No inline `<script>`, no inline event handlers.
- Escape user text with `window.NextDashHtml.escapeHtml`, or build nodes with `textContent`. A page name is user input and reaches the title block on every render.
- Six locale files stay in parity: `en`, `nl`, `de`, `fr`, `zh`, `es`.
- Playwright runs with `PW_WORKERS=2`. Write output to a file; a pipe swallows the exit code.
- Run only the specs covering the change.
- Never use port 8080.
- Commit messages short and plain. No `Co-Authored-By` trailer.
- The changelog line waits for an agreed version number; `CHANGELOG.md` has no `Unreleased` section and one must not be invented.

## Known blast radius

Measured before writing this plan, so a reviewer knows what to re-run:

- `.title` as an element selector: `tests/config-dashboard-view.spec.js`, `tests/dashboard-config-sync.spec.js`, `tests/dashboard-inbox.spec.js`, `tests/health-dashboard-view.spec.js`
- `section-title`: `tests/config-new-sections.spec.js`, `tests/config-save-feedback.spec.js`, `tests/config-view-performance.spec.js`
- `.lvs-title` / `.lvs-description`: `tests/dashboard-inbox.spec.js`, `tests/health-dashboard-view.spec.js`, `tests/health-shell-adoption.spec.js`, `tests/health-toolbar-styling.spec.js`, `tests/inbox-shell-adoption.spec.js`, `tests/list-view-shell.spec.js`
- `.lvs-header`: the six above plus `tests/health-focus-mode.spec.js`, `tests/inbox-triage.spec.js`, `tests/list-density.spec.js`, `tests/config-dashboard-view.spec.js`

Config does **not** use `ListViewShell` — `grep -c ListViewShell static/js/dashboard/dashboard-config.js` is 0 — so it is touched only through the shared title block.

---

### Task 1: The view name moves into the header row

**Files:**
- Modify: `templates/dashboard.html:173-234` (header block, and the `.section-title` container)
- Modify: `static/js/dashboard/dashboard-page-nav.js` (`updatePageTitle`)
- Modify: `static/css/dashboard.css:57-60` (`.dashboard-section.section-title`), `:602-620` (`.title`, `.title-breadcrumb`)
- Modify: `static/css/dashboard-enhancements.css:132` (`.header-top-primary`)
- Test: `tests/dashboard-merged-header.spec.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `.header-view-title` — an element inside `.header-top-primary` holding `h1.title` and `p.title-breadcrumb`. Task 2 appends `p.header-view-description` to the same block; Task 3 relies on `.header-top` being the row that carries every view-level control.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-merged-header.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One header bar, and the view name in it exactly once.
 *
 * The name used to own a full-width band of its own at 3rem, above the grid
 * and below the header -- a stripe of vertical space and, to the right of a
 * short word like "main", a run of dead horizontal space.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('merged header', () => {
    test('the title band is gone and the name sits in the header row', async ({ page }) => {
        await openDashboard(page);

        await expect(page.locator('.dashboard-section.section-title')).toHaveCount(0);

        const title = page.locator('.header-top-primary .title');
        await expect(title).toHaveCount(1);
        await expect(title).toBeVisible();
    });

    test('the name shares its row with the clock and the destinations', async ({ page }) => {
        await openDashboard(page);

        const title = await page.locator('.header-top-primary .title').boundingBox();
        const clock = await page.locator('#date-element').boundingBox();
        const config = await page.locator('.config-link-anchor').boundingBox();

        // Same row: every one of them overlaps the others vertically.
        const overlaps = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps(title, clock)).toBe(true);
        expect(overlaps(title, config)).toBe(true);
    });

    test('the grid starts higher than the old band allowed', async ({ page }) => {
        await openDashboard(page);

        const grid = await page.locator('#dashboard-layout').boundingBox();
        const header = await page.locator('.header-top').boundingBox();

        // The band was 3rem of type plus its own section padding. Whatever is
        // left between the header and the grid, it is far less than that.
        expect(grid.y - (header.y + header.height)).toBeLessThan(48);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js > /tmp/pw-mh1.txt 2>&1; echo "exit=$?"; grep -E "passed|failed|Expected|Received" /tmp/pw-mh1.txt | head -8
```

Expected: all three FAIL — the band still exists, `.header-top-primary .title` has count 0.

- [ ] **Step 3: Move the title block in the template**

In `templates/dashboard.html`, inside `.header-top-primary`, directly after the `#date-element` div, insert:

```html
                    <div class="header-view-title">
                        <h1 class="title"></h1>
                        <p class="title-breadcrumb" hidden></p>
                    </div>
```

Then delete the whole `<!-- Container 2: Title -->` block — the `div.dashboard-section.section-title` and everything inside it.

- [ ] **Step 4: Restyle the title for a header row**

In `static/css/dashboard.css`, replace the `.title` rule at line 602:

```css
.title {
    /*
     * A name, not a hero.
     *
     * This was --font-size-title (3rem) in a band of its own, which cost a
     * stripe of vertical space before the first bookmark and left the widest
     * row on the page carrying one word. In the header row it is a section
     * heading that shares its line with the clock, the tabs and the icons.
     */
    margin: 0;
    font-size: var(--text-xl);
    font-family: var(--font-family-main);
    font-weight: var(--font-weight-black);
    line-height: 1.1;
    opacity: 0.8;
    user-select: none;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.header-view-title {
    display: flex;
    flex-direction: column;
    gap: var(--space-hairline, 0.15rem);
    min-width: 0;
}
```

Delete the `.dashboard-section.section-title` rule at line 57 and its two `body.bookmark-inline-edit-active` companions at lines 3459 and 3506 — grep for `section-title` in that file and remove every rule that targets it.

- [ ] **Step 5: Let the primary block hold two things side by side**

In `static/css/dashboard-enhancements.css`, change `.header-top-primary`'s `flex-direction`:

```css
.header-top-primary {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: var(--space-3, 0.75rem);
    /* Sizes to the clock and the name it holds; the page strip takes the
       rest. Kept from the page-strip work -- growing here makes the date
       wrap and the whole header grow with it. */
    flex: 0 1 auto;
    min-width: 0;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js > /tmp/pw-mh1.txt 2>&1; echo "exit=$?"; grep -E "passed|failed|Expected|Received" /tmp/pw-mh1.txt | head -8
```

Expected: `exit=0`, 3 passed. `updatePageTitle` needs no change — it selects `.title`, which still exists, in its new home.

- [ ] **Step 7: Run it three times, because layout tests catch each other out**

```bash
for i in 1 2 3; do PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js > /tmp/pw-mh1-$i.txt 2>&1; echo "run $i exit=$? $(grep -oE '[0-9]+ (passed|failed|flaky)' /tmp/pw-mh1-$i.txt | tr '\n' ' ')"; done
```

Expected: three clean runs, no flaky.

- [ ] **Step 8: Re-run the specs that name the band**

```bash
PW_WORKERS=2 npx playwright test tests/config-new-sections.spec.js tests/config-save-feedback.spec.js tests/config-view-performance.spec.js tests/config-dashboard-view.spec.js tests/dashboard-config-sync.spec.js tests/dashboard-page-strip.spec.js > /tmp/pw-mh1b.txt 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-mh1b.txt | tail -3
```

Any failure here is a spec asserting on the old band. Update the spec to the new location — the band is gone by design, and a spec that requires it is asserting the defect.

- [ ] **Step 9: Commit**

```bash
git add templates/dashboard.html static/css/dashboard.css static/css/dashboard-enhancements.css tests/dashboard-merged-header.spec.js
git commit -m "move the view name into the header row"
```

---

### Task 2: The shell stops drawing a second title

**Files:**
- Modify: `static/js/shared/list-view-shell.js:111-140` (header build) and its returned handle at `:360`
- Modify: `static/css/list-view-shell.css:29-50` (`.lvs-header`, `.lvs-title`, `.lvs-description`)
- Modify: `static/css/dashboard.css` (append `.header-view-description`)
- Test: `tests/dashboard-merged-header.spec.js` (extend)

**Interfaces:**
- Consumes: `.header-view-title` from Task 1.
- Produces: `ListViewShell.mount()` no longer creates `.lvs-title` or `.lvs-description`; it writes `config.title` and `config.description` into the app header instead. The handle keeps every existing key — `header`, `headerActions`, `rail`, `toolbar`, `toolbarRow`, `body`, `setSummary`, `setCounts`, `setSectionCounts`, `setActiveFilter`, `destroy` — and `destroy()` additionally clears the header description it set.

- [ ] **Step 1: Write the failing test**

Append inside the `test.describe` in `tests/dashboard-merged-header.spec.js`:

```js
    test('health shows its name once, in the header, with its description under it', async ({ page }) => {
        await openDashboard(page);
        await page.goto('/#health');
        await page.waitForSelector('.lvs', { timeout: 20_000 });

        await expect(page.locator('.lvs-title')).toHaveCount(0);
        await expect(page.locator('.lvs-description')).toHaveCount(0);

        const title = page.locator('.header-top-primary .title');
        await expect(title).toHaveText('health');

        const description = page.locator('.header-view-description');
        await expect(description).toHaveText('Bookmarks that need attention');

        // Exactly once on the page, header included.
        const occurrences = await page.locator('text=Bookmarks that need attention').count();
        expect(occurrences).toBe(1);
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js -g "health shows its name once" > /tmp/pw-mh2.txt 2>&1; echo "exit=$?"; grep -E "Expected|Received" /tmp/pw-mh2.txt | head -4
```

Expected: FAIL — `.lvs-title` has count 1.

- [ ] **Step 3: Publish the title instead of drawing it**

In `static/js/shared/list-view-shell.js`, add this helper above `class ListViewShell`:

```js
/**
 * The view's name and description belong to the app header.
 *
 * The shell used to draw both again at the top of its own panel, so every
 * list view printed its name twice: small in the header, large in the panel.
 * The header block is the one place that survives a view switch, so this
 * writes there and the panel keeps only its actions.
 */
function publishHeaderText(title, description) {
    const host = document.querySelector('.header-view-title');
    if (!host) return () => {};

    const titleEl = host.querySelector('.title');
    if (titleEl && title) titleEl.textContent = String(title);

    let descEl = host.querySelector('.header-view-description');
    if (!descEl) {
        descEl = document.createElement('p');
        descEl.className = 'header-view-description';
        host.appendChild(descEl);
    }
    descEl.textContent = String(description || '');
    descEl.hidden = !description;

    return () => {
        descEl.textContent = '';
        descEl.hidden = true;
    };
}
```

- [ ] **Step 4: Stop building the title nodes**

In `ListViewShell.mount`, replace the block that builds `headerText`, `title`, `description` and `crumb` — from `const headerText = document.createElement('div');` through `headerText.appendChild(crumb);` — with:

```js
        // The name and the description go to the app header; see
        // publishHeaderText. What stays here is the actions row.
        const clearHeaderText = publishHeaderText(config.title, config.description);
```

Then change the line that appends both children:

```js
        header.append(headerActions);
```

- [ ] **Step 5: Clear the description on destroy**

In the handle returned at the end of `mount`, find `destroy()` and add as its first statement:

```js
                clearHeaderText();
```

- [ ] **Step 6: Style the description and drop the dead rules**

In `static/css/dashboard.css`, append:

```css
.header-view-description {
    margin: 0;
    font-family: var(--font-family-main);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.header-view-description[hidden] {
    display: none;
}
```

In `static/css/list-view-shell.css`, delete the `.lvs-title` and `.lvs-description` rules, and change `.lvs-header` to hold only its actions:

```css
.lvs-header {
    grid-area: header;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-primary);
}
```

- [ ] **Step 7: Run the new test and watch it pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js > /tmp/pw-mh2.txt 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-mh2.txt | tail -3
```

Expected: `exit=0`, 4 passed.

- [ ] **Step 8: Re-run every spec that names the shell header**

```bash
PW_WORKERS=2 npx playwright test tests/list-view-shell.spec.js tests/health-shell-adoption.spec.js tests/inbox-shell-adoption.spec.js tests/health-toolbar-styling.spec.js tests/health-dashboard-view.spec.js tests/dashboard-inbox.spec.js > /tmp/pw-mh2b.txt 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-mh2b.txt | tail -3
```

A spec asserting `.lvs-title` has the name is asserting the duplication this task removes. Update it to read `.header-top-primary .title`. A spec asserting the *shell mounts at all* must keep working unchanged — if one breaks for any other reason, stop and report rather than loosening it.

- [ ] **Step 9: Commit**

```bash
git add static/js/shared/list-view-shell.js static/css/list-view-shell.css static/css/dashboard.css tests
git commit -m "let the shell publish its title to the header instead of drawing it"
```

---

### Task 3: The view's own actions join the header row

**Files:**
- Modify: `static/js/shared/list-view-shell.js` (header build, handle)
- Modify: `templates/dashboard.html` (header actions container)
- Modify: `static/css/dashboard.css`, `static/css/list-view-shell.css`
- Test: `tests/dashboard-merged-header.spec.js` (extend)

**Interfaces:**
- Consumes: `.header-view-title` and `publishHeaderText` from Tasks 1–2.
- Produces: `#header-view-actions` in the template; `handle.headerActions` now points at that element, so `buildHeaderActions(this.shell.headerActions)` in health and inbox keeps working untouched.

- [ ] **Step 1: Write the failing test**

Append inside the same `test.describe`:

```js
    test('the view actions sit in the header row, not in a bar of their own', async ({ page }) => {
        await openDashboard(page);
        await page.goto('/#health');
        await page.waitForSelector('.lvs', { timeout: 20_000 });

        const actions = page.locator('#header-view-actions');
        await expect(actions).toBeVisible();
        await expect(actions.locator('button, a')).not.toHaveCount(0);

        const actionsBox = await actions.boundingBox();
        const clock = await page.locator('#date-element').boundingBox();
        const overlaps = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps(actionsBox, clock)).toBe(true);

        // The shell's own header row is now empty chrome and should not draw
        // a rule across the panel for nothing.
        await expect(page.locator('.lvs-header')).toHaveCount(0);
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js -g "view actions sit in the header row" > /tmp/pw-mh3.txt 2>&1; echo "exit=$?"; grep -E "Expected|Received|Error" /tmp/pw-mh3.txt | head -4
```

Expected: FAIL — `#header-view-actions` does not exist.

- [ ] **Step 3: Add the host to the template**

In `templates/dashboard.html`, inside `.header-actions`, before `<div id="page-navigation">`, insert:

```html
                    <div id="header-view-actions" class="header-view-actions"></div>
```

- [ ] **Step 4: Point the shell at it**

In `static/js/shared/list-view-shell.js`, replace the creation of `headerActions` and the `header.append(headerActions)` line with:

```js
        // The view's buttons live in the app header, next to the page strip
        // and the destinations, so a view has one row of controls rather than
        // two stacked ones. The shell still owns the element's contents: both
        // views fill it by hand with innerHTML, which is why this is handed
        // over as a host rather than built from config.
        const headerActions = document.getElementById('header-view-actions')
            || document.createElement('div');
        headerActions.replaceChildren();
        headerActions.classList.add('lvs-header-actions');
```

Delete the `header` element entirely: remove `const header = document.createElement('div');`, its `className` line, and drop `header` from the `root.append(...)` call. Remove `header` from the returned handle.

In `destroy()`, add before the existing body:

```js
                headerActions.replaceChildren();
                headerActions.classList.remove('lvs-header-actions');
```

- [ ] **Step 5: Give the host a place in the row**

In `static/css/dashboard.css`, append:

```css
.header-view-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    flex: 0 0 auto;
}

.header-view-actions:empty {
    display: none;
}
```

In `static/css/list-view-shell.css`, delete the `.lvs-header` rule and remove `header` from the grid template of `.lvs` — the grid areas become `rail`, `toolbar`, `body`.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js > /tmp/pw-mh3.txt 2>&1; echo "exit=$?"; grep -E "passed|failed" /tmp/pw-mh3.txt | tail -3
```

Expected: `exit=0`, 5 passed.

- [ ] **Step 7: Run the whole affected set, three times**

```bash
for i in 1 2 3; do PW_WORKERS=2 npx playwright test tests/dashboard-merged-header.spec.js tests/dashboard-page-strip.spec.js tests/list-view-shell.spec.js tests/health-shell-adoption.spec.js tests/inbox-shell-adoption.spec.js tests/health-focus-mode.spec.js tests/inbox-triage.spec.js tests/list-density.spec.js tests/health-dashboard-view.spec.js tests/dashboard-inbox.spec.js tests/config-dashboard-view.spec.js > /tmp/pw-mh3b-$i.txt 2>&1; echo "run $i exit=$? $(grep -oE '[0-9]+ (passed|failed|flaky)' /tmp/pw-mh3b-$i.txt | tr '\n' ' ')"; done
```

Expected: three clean runs. A flaky here is a layout race, not noise — diagnose it before committing.

- [ ] **Step 8: Commit**

```bash
git add templates/dashboard.html static/js/shared/list-view-shell.js static/css/dashboard.css static/css/list-view-shell.css tests
git commit -m "move the view actions into the header row"
```
