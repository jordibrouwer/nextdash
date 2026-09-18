# Page Strip With A Fixed Footprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard header's destination icons sit in the same place whether the user has 2 pages or 40, and print the page keys so the keyboard model is learnable by reading.

**Architecture:** `#page-navigation` currently uses `flex-wrap: wrap`, so a long page list wraps to a second line and shoves the header's destination icons out of position. It becomes a track with a fixed maximum width and `min-width: 0` that fills with as many tabs as fit and hands the remainder to a `+N` chip opening the existing pages overview. The active page is pinned to the front of the track so `Shift+←/→` never walks it off-screen. No new keyboard routes: `1`–`9`, `Shift+←/→` and `,` already exist and are simply made visible.

**Tech Stack:** Go `html/template`, vanilla ES (no build step), hand-written CSS custom properties, Playwright for e2e.

**Spec:** `.superdesign/design-system.md` — sections "The page strip has a fixed footprint" and "The page keys are printed, not hidden". Visual reference: draft `1ec0f48b` on the Superdesign canvas.

## Global Constraints

- Colours come only from theme tokens or `color-mix()` on them. No hex literals, no `rgba(255,255,255,…)`, no `rgba(0,0,0,…)`, no bare `black`, in any file this plan touches.
- CSP is `script-src 'self'`. No inline `<script>`, no inline event handlers. Data rides on `data-*` attributes.
- Asset URLs come from `{{asset "…"}}` / `lazyLoadedAssets`. Never hand-write a `?v=` query.
- Escape user text with `window.NextDashHtml.escapeHtml`, or build nodes with `textContent`.
- Six locale files must stay in parity: `locales/en.json`, `nl.json`, `de.json`, `fr.json`, `zh.json`, `es.json`. Every new string needs a key in all six.
- Keyboard shortcuts are unchanged by this plan. `1`–`9` jump to a page, `Shift+←`/`Shift+→` walk all pages, `,` opens the pages overview.
- Playwright runs with `PW_WORKERS=2`. Never the default worker count.
- Run only the specs that cover the change. No full-suite sweep, not even as a final check.
- Playwright's exit code is lost through a pipe. Always write output to a file and read the file.
- Never use port 8080; it belongs to the user. Tests use the fixture's own server.
- Every change gets a line in `CHANGELOG.md`.
- Commit messages are short and plain. No `Co-Authored-By` trailer.

---

### Task 1: The track stops growing

**Files:**
- Modify: `static/css/dashboard.css:1064-1068` (`.page-navigation`)
- Test: `tests/dashboard-page-strip.spec.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `.page-navigation` as a single-line, horizontally bounded track. Later tasks append `.page-nav-overflow` as its last child and rely on `--page-track-max` existing.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-page-strip.spec.js`:

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The page tab strip must not change the header's shape.
 *
 * `.page-navigation` used to wrap, so a user with a dozen pages got a second
 * header line and the destination icons moved. The track is bounded now: the
 * icons sit at the same x/y at two pages and at twenty.
 */

function pages(count) {
    return Array.from({ length: count }, (_, i) => ({
        // /api/pages returns []Page from internal/app/models.go:355 —
        // the id is a NUMBER matching the bookmarks file number.
        id: i + 1,
        name: i === 0 ? 'main' : `page-${i + 1}`,
    }));
}

async function openWithPages(page, count) {
    await page.route('**/api/pages', async (route) => {
        await route.fulfill({ json: pages(count) });
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
}

test.describe('page strip footprint', () => {
    test('the destination icons do not move when the page count grows', async ({ page }) => {
        await openWithPages(page, 2);
        const few = await page.locator('.config-link-anchor').boundingBox();

        await openWithPages(page, 20);
        const many = await page.locator('.config-link-anchor').boundingBox();

        expect(many).not.toBeNull();
        expect(few).not.toBeNull();
        expect(Math.round(many.x)).toBe(Math.round(few.x));
        expect(Math.round(many.y)).toBe(Math.round(few.y));
    });

    test('the track stays one line high', async ({ page }) => {
        await openWithPages(page, 20);
        const track = page.locator('#page-navigation');
        const height = await track.evaluate((el) => el.getBoundingClientRect().height);
        const rowHeight = await track.evaluate((el) => {
            const btn = el.querySelector('.page-nav-btn');
            return btn ? btn.getBoundingClientRect().height : 0;
        });
        expect(rowHeight).toBeGreaterThan(0);
        expect(height).toBeLessThan(rowHeight * 1.6);
    });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task1.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task1.txt
```

Expected: both tests FAIL. The first because the icons shift, the second because the wrapped track is roughly twice a row high.

- [ ] **Step 3: Bound the track**

In `static/css/dashboard.css`, replace the `.page-navigation` rule at line 1064:

```css
.page-navigation {
    /* Upper bound on the strip, so the header's destination icons keep their
       position at any page count. The old rule wrapped instead, which turned a
       twelfth page into a second header line and moved every icon. */
    --page-track-max: 22rem;
    display: flex;
    flex-wrap: nowrap;
    min-width: 0;
    max-width: var(--page-track-max);
    gap: var(--space-1, 0.25rem);
    overflow: hidden;
}

.page-navigation > .page-nav-btn {
    flex: 0 0 auto;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task1.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task1.txt
```

Expected: `exit=0`, 2 passed.

- [ ] **Step 5: Check nothing else that reads this rule regressed**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-theme-browser-shortcut.spec.js tests/config-pages-tags.spec.js > /tmp/pw-task1b.txt 2>&1; echo "exit=$?"; tail -20 /tmp/pw-task1b.txt
```

Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add static/css/dashboard.css tests/dashboard-page-strip.spec.js
git commit -m "bound the page tab strip so the header icons stop moving"
```

---

### Task 2: The overflow chip

**Files:**
- Modify: `static/js/dashboard/dashboard-page-nav.js:365` (`renderPageNavigation`)
- Modify: `static/css/dashboard.css` (append after the `.page-navigation` block from Task 1)
- Modify: `locales/en.json`, `locales/nl.json`, `locales/de.json`, `locales/fr.json`, `locales/zh.json`, `locales/es.json`
- Test: `tests/dashboard-page-strip.spec.js` (extend)

**Interfaces:**
- Consumes: `.page-navigation` bounded track from Task 1.
- Produces: `renderPageNavigation()` appends at most one `button.page-nav-overflow[data-page-overflow]` as the track's last child, carrying `data-overflow-count`. Task 3 reads that button to decide how many tabs fit.

- [ ] **Step 1: Write the failing test**

Append to `tests/dashboard-page-strip.spec.js`, inside the existing `test.describe`:

```js
    test('pages that do not fit collapse into one chip that opens the overview', async ({ page }) => {
        await openWithPages(page, 20);

        const chip = page.locator('.page-nav-overflow');
        await expect(chip).toHaveCount(1);

        const hidden = Number(await chip.getAttribute('data-overflow-count'));
        const shown = await page.locator('.page-nav-btn').count();
        expect(hidden).toBeGreaterThan(0);
        expect(shown + hidden).toBe(20);
        await expect(chip).toContainText(`+${hidden}`);

        await chip.click();
        await expect(page.locator('.page-overview-modal')).toBeVisible();
    });

    test('no chip appears when every page fits', async ({ page }) => {
        await openWithPages(page, 2);
        await expect(page.locator('.page-nav-overflow')).toHaveCount(0);
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task2.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task2.txt
```

Expected: the two new tests FAIL with `Expected: 1, Received: 0` on `.page-nav-overflow`.

- [ ] **Step 3: Add the locale strings**

Add to the `dashboard` object of every locale file. `locales/en.json`:

```json
"pagesOverflow": "+{count}",
"pagesOverflowAria": "Show {count} more pages",
```

`locales/nl.json`:

```json
"pagesOverflow": "+{count}",
"pagesOverflowAria": "Toon {count} pagina's meer",
```

`locales/de.json`:

```json
"pagesOverflow": "+{count}",
"pagesOverflowAria": "{count} weitere Seiten anzeigen",
```

`locales/fr.json`:

```json
"pagesOverflow": "+{count}",
"pagesOverflowAria": "Afficher {count} pages de plus",
```

`locales/zh.json`:

```json
"pagesOverflow": "+{count}",
"pagesOverflowAria": "再显示 {count} 个页面",
```

`locales/es.json`:

```json
"pagesOverflow": "+{count}",
"pagesOverflowAria": "Mostrar {count} páginas más",
```

- [ ] **Step 4: Measure the track and build the chip**

In `static/js/dashboard/dashboard-page-nav.js`, add this method to the same class as `renderPageNavigation`, directly above it:

```js
    /**
     * How many tabs fit in the bounded track, and the chip for the rest.
     *
     * Measured rather than configured: the track's width comes from the
     * viewport, so a fixed "first four tabs" rule would clip on a narrow
     * window and waste space on a wide one. The chip is laid out first and
     * its width reserved, so adding it can never push the tab it was meant
     * to make room for back out.
     */
    _applyPageOverflow(container, pages) {
        const existing = container.querySelector('.page-nav-overflow');
        if (existing) existing.remove();

        const buttons = [...container.querySelectorAll('.page-nav-btn')];
        if (!buttons.length) return;

        const style = window.getComputedStyle(container);
        const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
        const limit = container.clientWidth;
        if (!limit) return;

        const chip = this._buildPageOverflowChip(0);
        container.appendChild(chip);
        const chipWidth = chip.getBoundingClientRect().width + gap;
        chip.remove();

        let used = 0;
        let fits = 0;
        for (const btn of buttons) {
            const next = used + btn.getBoundingClientRect().width + (fits ? gap : 0);
            if (next > limit) break;
            used = next;
            fits += 1;
        }

        if (fits >= buttons.length) return;

        // Room for the chip itself, taken from the tail.
        while (fits > 0 && used + chipWidth > limit) {
            fits -= 1;
            used -= buttons[fits].getBoundingClientRect().width + gap;
        }

        const hiddenCount = buttons.length - fits;
        buttons.slice(fits).forEach((btn) => btn.remove());
        container.appendChild(this._buildPageOverflowChip(hiddenCount));
    }

    _buildPageOverflowChip(count) {
        const d = this.dash;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'page-nav-overflow';
        chip.dataset.pageOverflow = 'true';
        chip.dataset.overflowCount = String(count);
        chip.setAttribute(
            'aria-label',
            d.formatDashboardLabel('pagesOverflowAria', { count }, `Show ${count} more pages`),
        );
        chip.setAttribute('aria-keyshortcuts', ',');

        const label = document.createElement('span');
        label.className = 'page-nav-overflow-label';
        label.textContent = d.formatDashboardLabel('pagesOverflow', { count }, `+${count}`);

        const key = document.createElement('kbd');
        key.className = 'page-nav-overflow-key';
        key.textContent = ',';

        chip.append(label, key);
        chip.addEventListener('click', () => {
            document.getElementById('page-overview-header-btn')?.click();
        });
        return chip;
    }
```

- [ ] **Step 5: Call it at the end of the render**

In `renderPageNavigation()`, immediately before its closing brace, add:

```js
        this._applyPageOverflow(container, d.pages);
```

- [ ] **Step 6: Style the chip**

Append to `static/css/dashboard.css`, after the `.page-navigation` rules from Task 1:

```css
.page-nav-overflow {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    padding: var(--space-1-5, 0.4rem) var(--space-2, 0.6rem);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-4, 6px);
    background: color-mix(in srgb, var(--text-secondary) 7%, transparent);
    color: var(--text-secondary);
    font-family: var(--font-family-main);
    font-size: var(--font-size-controls);
    cursor: pointer;
}

.page-nav-overflow:is(:hover, :focus-visible) {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    color: var(--text-primary);
}

.page-nav-overflow-key {
    font-family: inherit;
    font-size: var(--text-2xs, 0.65rem);
    color: var(--text-tertiary);
}
```

- [ ] **Step 7: Run the tests and watch them pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task2.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task2.txt
```

Expected: `exit=0`, 4 passed.

- [ ] **Step 8: Verify locale parity**

```bash
npm run validate:locale-parity && npm run validate:locale-placeholders
```

Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add static/js/dashboard/dashboard-page-nav.js static/css/dashboard.css locales tests/dashboard-page-strip.spec.js
git commit -m "collapse pages that do not fit into a +N chip"
```

---

### Task 3: The active page is always in the track

**Files:**
- Modify: `static/js/dashboard/dashboard-page-nav.js` (`_applyPageOverflow`)
- Test: `tests/dashboard-page-strip.spec.js` (extend)

**Interfaces:**
- Consumes: `_applyPageOverflow(container, pages)` from Task 2.
- Produces: no new API. The invariant later work depends on: `.page-nav-btn.active` is always present in the DOM whatever the page count.

- [ ] **Step 1: Write the failing test**

Append inside the same `test.describe`:

```js
    test('the active page stays in the track even when it sorts past the overflow', async ({ page }) => {
        await openWithPages(page, 20);

        // Set the current page and re-render rather than navigating: the
        // stubbed pages beyond the first two have no bookmarks file behind
        // them, and this test is about which tab survives the overflow, not
        // about loading a page's data.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.currentPageId = d.pages[14].id;
            d.pageNav.renderPageNavigation();
        });

        const active = page.locator('.page-nav-btn.active');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText('page-15');

        const box = await active.boundingBox();
        const track = await page.locator('#page-navigation').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(track.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(track.x + track.width + 1);
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task3.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task3.txt
```

Expected: FAIL — the fifteenth tab was removed with the rest of the tail, so `.page-nav-btn.active` has count 0.

- [ ] **Step 3: Pin the active tab to the front**

In `_applyPageOverflow`, replace the line reading `const buttons = [...container.querySelectorAll('.page-nav-btn')];` with:

```js
        // The active tab moves to the front before anything is measured.
        // Walking pages with Shift+Left/Right must never hide the page you
        // just arrived on, and the tail is what the chip absorbs.
        const buttons = [...container.querySelectorAll('.page-nav-btn')];
        const activeIndex = buttons.findIndex((btn) => btn.classList.contains('active'));
        if (activeIndex > 0) {
            const [activeBtn] = buttons.splice(activeIndex, 1);
            buttons.unshift(activeBtn);
            container.prepend(activeBtn);
        }
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task3.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task3.txt
```

Expected: `exit=0`, 5 passed.

- [ ] **Step 5: Falsify the fix**

Revert only the `if (activeIndex > 0)` block, re-run the single new test, confirm it fails, then restore the block.

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js -g "sorts past the overflow" > /tmp/pw-task3b.txt 2>&1; echo "exit=$?"; tail -12 /tmp/pw-task3b.txt
```

Expected with the block removed: non-zero exit. Restore the block and confirm `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add static/js/dashboard/dashboard-page-nav.js tests/dashboard-page-strip.spec.js
git commit -m "keep the active page tab inside the track"
```

---

### Task 4: The page keys are printed

**Files:**
- Modify: `static/js/dashboard/dashboard-page-nav.js` (`_renderPageTabContent`, and `renderPageNavigation` for the walk hints)
- Modify: `static/css/dashboard.css`
- Modify: all six files in `locales/`
- Test: `tests/dashboard-page-strip.spec.js` (extend)

**Interfaces:**
- Consumes: the track and chip from Tasks 1–3.
- Produces: `span.page-nav-digit` inside the first nine tabs, and two `kbd.page-walk-hint` elements as siblings of `#page-navigation`.

- [ ] **Step 1: Write the failing test**

Append inside the same `test.describe`:

```js
    test('the first nine tabs print their digit and the walk keys are visible', async ({ page }) => {
        await openWithPages(page, 20);

        const digits = page.locator('.page-nav-btn .page-nav-digit');
        const shown = await page.locator('.page-nav-btn').count();
        expect(await digits.count()).toBe(Math.min(shown, 9));
        await expect(digits.first()).toHaveText('1');

        const hints = page.locator('.page-walk-hint');
        await expect(hints).toHaveCount(2);
        await expect(hints.nth(0)).toHaveText('⇧←');
        await expect(hints.nth(1)).toHaveText('⇧→');
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task4.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task4.txt
```

Expected: FAIL with `Expected: 9, Received: 0`.

- [ ] **Step 3: Print the digit on the tab**

In `_renderPageTabContent`, after the element holding the page name is appended, add:

```js
        // 1-9 already switch pages, and only aria-keyshortcuts ever said so.
        // Printing the digit is how a sighted user learns the same thing, and
        // it is the convention the action bar already follows for its keys.
        if (index < 9) {
            const digit = document.createElement('span');
            digit.className = 'page-nav-digit';
            digit.textContent = String(index + 1);
            digit.setAttribute('aria-hidden', 'true');
            pageBtn.appendChild(digit);
        }
```

- [ ] **Step 4: Add the walk hints**

In `renderPageNavigation()`, directly after `container.innerHTML = '';`, add:

```js
        const parent = container.parentElement;
        parent?.querySelectorAll('.page-walk-hint').forEach((el) => el.remove());
        if (parent && d.pages.length > 1) {
            const before = document.createElement('kbd');
            before.className = 'page-walk-hint';
            before.textContent = '⇧←';
            before.setAttribute('aria-hidden', 'true');
            const after = document.createElement('kbd');
            after.className = 'page-walk-hint';
            after.textContent = '⇧→';
            after.setAttribute('aria-hidden', 'true');
            parent.insertBefore(before, container);
            parent.insertBefore(after, container.nextSibling);
        }
```

- [ ] **Step 5: Style both**

Append to `static/css/dashboard.css`:

```css
.page-nav-digit {
    margin-left: var(--space-1, 0.25rem);
    color: var(--text-tertiary);
    font-size: var(--text-2xs, 0.65rem);
    vertical-align: super;
}

.page-walk-hint {
    flex: 0 0 auto;
    align-self: center;
    color: var(--text-tertiary);
    font-family: var(--font-family-main);
    font-size: var(--text-2xs, 0.65rem);
    opacity: 0.7;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task4.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task4.txt
```

Expected: `exit=0`, 6 passed.

- [ ] **Step 7: Confirm the keys themselves still work**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js tests/config-pages-tags.spec.js > /tmp/pw-task4b.txt 2>&1; echo "exit=$?"; tail -20 /tmp/pw-task4b.txt
```

Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add static/js/dashboard/dashboard-page-nav.js static/css/dashboard.css tests/dashboard-page-strip.spec.js
git commit -m "print the page keys on the tabs and the strip"
```

---

### Task 5: Re-measure on resize, and record the change

**Files:**
- Modify: `static/js/dashboard/dashboard-page-nav.js` (`renderPageNavigation` / class setup)
- Modify: `CHANGELOG.md`
- Test: `tests/dashboard-page-strip.spec.js` (extend)

**Interfaces:**
- Consumes: `_applyPageOverflow` from Tasks 2–3.
- Produces: nothing new. Terminal task for this slice.

- [ ] **Step 1: Write the failing test**

Append inside the same `test.describe`:

```js
    test('narrowing the window moves tabs into the chip', async ({ page }) => {
        await openWithPages(page, 20);
        const wide = Number(await page.locator('.page-nav-overflow').getAttribute('data-overflow-count'));

        await page.setViewportSize({ width: 900, height: 900 });
        await page.waitForFunction(
            (prev) => {
                const chip = document.querySelector('.page-nav-overflow');
                return chip && Number(chip.dataset.overflowCount) > prev;
            },
            wide,
            { timeout: 5_000 },
        );

        const narrow = Number(await page.locator('.page-nav-overflow').getAttribute('data-overflow-count'));
        expect(narrow).toBeGreaterThan(wide);
    });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task5.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task5.txt
```

Expected: FAIL on the `waitForFunction` timeout — the count never changes because nothing re-measures.

- [ ] **Step 3: Re-measure when the track resizes**

In `renderPageNavigation()`, immediately after the `this._applyPageOverflow(container, d.pages);` call added in Task 2, add:

```js
        // The fit is a measurement, so it has to be retaken when the thing
        // measured changes size. A ResizeObserver on the track rather than a
        // window resize listener: the sidebar and the font-size setting change
        // the track's width without the window changing at all.
        if (!this._pageTrackObserver) {
            this._pageTrackObserver = new ResizeObserver(() => {
                const host = document.getElementById('page-navigation');
                if (host) this.renderPageNavigation();
            });
        }
        this._pageTrackObserver.disconnect();
        this._pageTrackObserver.observe(container);
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
PW_WORKERS=2 npx playwright test tests/dashboard-page-strip.spec.js > /tmp/pw-task5.txt 2>&1; echo "exit=$?"; tail -30 /tmp/pw-task5.txt
```

Expected: `exit=0`, 7 passed.

If the run hangs or the observer re-enters, the disconnect before observe is missing — `renderPageNavigation` mutates the track it observes, so the observer must be detached for the duration of the render.

- [ ] **Step 5: Add the changelog line**

Under the `Unreleased` heading of `CHANGELOG.md`:

```markdown
- The page tab strip no longer wraps. It fills a bounded track, collapses the pages that do not fit into a `+N` chip that opens the pages overview, and keeps the active page in view — so the header's destination icons stay put whether you have two pages or forty. The keys that were already there are now printed: each of the first nine tabs shows its digit, and the strip shows the Shift+Left / Shift+Right hints that walk every page.
```

- [ ] **Step 6: Run the docs and locale validators**

```bash
npm run validate:locale-parity && npm run validate:locale-placeholders && npm run validate:doc-links
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-page-nav.js CHANGELOG.md tests/dashboard-page-strip.spec.js
git commit -m "re-measure the page strip when it resizes"
```

---

## Out of scope for this plan

These are the other subsystems of the redesign. Each needs its own plan, and each produces working software on its own:

1. **Merged header bar** — fold the view title and description into the app header, delete the `.section-title` band and the `ListViewShell` panel header. Touches `templates/dashboard.html`, `static/js/shared/list-view-shell.js:108-140`, `dashboard.css`, `list-view-shell.css`, and all three view modules.
2. **Action bar trim** — drop `> search`, `: commands`, `? finders` from `dashboard-toolbar.js:503-514`, promote search into the header. Depends on plan 1 above.
3. **Glass depth refinement** — `data-depth="glass"` already ships in `static/css/theme-character.css:77`. The work is splitting its single `--theme-surface-alpha` into three tiers by reading need, adding the two-sided edge, and replacing the hand-maintained selector list the file itself flags as debt.
4. **Widened theme contract** — add `accentPrimary`, `accentInfo` and explicit surface steps to the 12-colour contract, with derivation fallbacks, then migrate 222 built-ins in `internal/app/models.go` plus user custom themes. The riskiest piece; needs its own migration and rollback design.
5. **One layout** — remove `data-layout-version`, merge `classic` and `modern`. Deletes `layout-modern.css`, `layout-modern-tokens.css` and `overlays-modern.css`, and touches every view stylesheet.
6. **Config onto the shared shell** — move config to `ListViewShell`, per-section blocks or rows. Touches `config-view.css` (7207 lines) and `dashboard-config.js` (27004 lines). A previous single-shot split of that file failed 41 tests; this must go section by section, one plan per section group.
7. **Context menu hoisting** — render the bookmark context menu at the top level instead of inside a row, so a blurred ancestor cannot trap it. Carries the unresolved Safari hit-test risk on blurred inline-edit surfaces and should be verified on Safari before it lands.
