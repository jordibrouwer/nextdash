// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Three related bits of config polish:
 *
 *   1. `.config-field` is a grid, so every control in a panel starts at the
 *      same x position. It was a flex row with a `min-width` label, which let
 *      each row place its control wherever its own label happened to end.
 *   2. The settings schema declares the section a panel belongs to, not only
 *      its tab — Behavior and Appearance share four tab names.
 *   3. Below 720px the section rail is a horizontal scroll strip rather than
 *      three or four wrapped rows above the panel.
 */

async function openSection(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForSelector('.config-view', { timeout: 15_000 });
}

/** Switch to a sub-tab and wait for its body to repaint. */
async function openSubTab(page, attr, tab) {
    await page.locator(`[${attr}="${tab}"]`).click();
    await expect(page.locator(`[${attr}="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
}

test.describe('config fields line up in a grid', () => {
    /**
     * The regression this guards: three selects under one another starting at
     * three different offsets because each label sized its own row.
     */
    test('controls in one panel share a left edge', async ({ page }) => {
        await openSection(page, 'behavior');
        await openSubTab(page, 'data-behavior-tab', 'datetime');

        // Date format, time format and weather source are three selects with
        // labels of very different lengths in the same panel.
        const lefts = await page.evaluate(() => {
            const fields = [...document.querySelectorAll('#config-behavior-body .config-field')]
                .filter((f) => f.querySelector('.config-select'));
            return fields.map((f) => Math.round(
                f.querySelector('.config-select').getBoundingClientRect().left
            ));
        });

        expect(lefts.length).toBeGreaterThan(2);
        // One shared column, so every select starts within a pixel of the rest.
        const spread = Math.max(...lefts) - Math.min(...lefts);
        expect(spread, `selects start at ${lefts.join(', ')}`).toBeLessThanOrEqual(1);
    });

    /**
     * A control keeps its natural width instead of being stretched across the
     * panel, and — the point of the `max-content` column — its ℹ/↺ pair stays
     * beside it rather than being pushed to the far edge by a `1fr` column.
     */
    test('a control keeps its size and its affordances stay beside it', async ({ page }) => {
        await openSection(page, 'behavior');
        await openSubTab(page, 'data-behavior-tab', 'datetime');

        const row = await page.evaluate(() => {
            const el = document.querySelector('#config-behavior-body .config-select');
            const field = el.closest('.config-field');
            const aff = field.querySelector('.config-field-affordances');
            const s = el.getBoundingClientRect();
            const f = field.getBoundingClientRect();
            return {
                select: s.width,
                panel: f.width,
                // Distance from the control's right edge to the affordances.
                gapToAffordances: aff ? aff.getBoundingClientRect().left - s.right : null,
            };
        });

        // Not stretched the full width of the row.
        expect(row.select).toBeLessThan(row.panel * 0.6);
        expect(row.gapToAffordances, 'no affordances on this row').not.toBeNull();
        // Beside the control, not stranded at the panel's right edge — the
        // regression a 1fr control column caused (roughly 400px away).
        expect(row.gapToAffordances).toBeLessThan(40);
    });

    /**
     * A hint belongs under the control it explains, not squeezed into a third
     * column beside it.
     */
    test('a field hint takes its own row under the control', async ({ page }) => {
        await openSection(page, 'appearance');
        await openSubTab(page, 'data-appearance-tab', 'layout');

        const stacked = await page.evaluate(() => {
            const hint = document.querySelector('#config-appearance-body .config-field > .config-field-hint');
            if (!hint) return null;
            const field = hint.parentElement;
            const control = field.querySelector('.config-choices, .config-select, .config-text');
            if (!control) return null;
            const h = hint.getBoundingClientRect();
            const c = control.getBoundingClientRect();
            const f = field.getBoundingClientRect();
            const style = getComputedStyle(hint);
            return {
                below: h.top >= c.bottom - 2,
                // Starts at the field's own left edge rather than being pushed
                // into the control column beside the label. Its width is not
                // checked: .config-field-hint caps itself at 70ch for
                // readability, so it is legitimately narrower than the row.
                startsAtFieldEdge: Math.abs(h.left - f.left) < 3,
                spans: `${style.gridColumnStart}/${style.gridColumnEnd}`,
            };
        });

        expect(stacked, 'no field carrying a hint was rendered').not.toBeNull();
        expect(stacked.below).toBe(true);
        expect(stacked.startsAtFieldEdge).toBe(true);
        expect(stacked.spans).toBe('1/-1');
    });

    /** The slider needs a fourth column for its percentage readout. */
    test('the opacity slider keeps its readout on the same row', async ({ page }) => {
        await openSection(page, 'appearance');

        const row = await page.evaluate(() => {
            const value = document.querySelector('.config-field > .config-range-value');
            if (!value) return null;
            const field = value.parentElement;
            const range = field.querySelector('.config-range');
            if (!range) return null;
            const v = value.getBoundingClientRect();
            const r = range.getBoundingClientRect();
            return {
                // Vertically overlapping means side by side, not stacked.
                sameRow: v.top < r.bottom && r.top < v.bottom,
                // The readout is a fourth child, so this row gets a fourth
                // column; the ordinary three-column rule would wrap it.
                columns: getComputedStyle(field).gridTemplateColumns.split(' ').length,
            };
        });

        expect(row, 'no range field was rendered').not.toBeNull();
        expect(row.sameRow).toBe(true);
        expect(row.columns).toBe(4);
    });
});

test.describe('the settings schema declares its section', () => {
    /**
     * Behavior and Appearance both have general, layout, display and toolbar
     * tabs. Filtering the schema on the tab name alone happened to work only
     * because Appearance's General is hand-written; this pins the split so it
     * keeps working when that changes.
     */
    test('every panel names the section it belongs to', async ({ page }) => {
        await openSection(page, 'behavior');

        const panels = await page.evaluate(() => window.dashboardInstance.config
            .behaviorSchema()
            .map((p) => ({ section: p.section, tab: p.tab, title: p.title })));

        expect(panels.length).toBeGreaterThan(10);
        const missing = panels.filter((p) => !p.section);
        expect(missing, `panels with no section: ${missing.map((p) => p.title).join(', ')}`).toEqual([]);

        // The tabs that belong to Appearance rather than Behavior. Compared as
        // a set: the chrome toggles are three panels — the header on Toolbar &
        // tabs, both halves of the bar on Button bar — and how many panels a tab
        // is split into is not this test's business.
        const appearance = [...new Set(
            panels.filter((p) => p.section === 'appearance').map((p) => p.tab)
        )].sort();
        expect(appearance).toEqual(['buttonbar', 'display', 'layout', 'toolbar']);
    });

    test('panelsFor keeps a shared tab name in its own section', async ({ page }) => {
        await openSection(page, 'behavior');

        const result = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            return {
                behaviorGeneral: cfg.panelsFor('behavior', 'general').map((p) => p.title),
                appearanceGeneral: cfg.panelsFor('appearance', 'general').map((p) => p.title),
                appearanceToolbar: cfg.panelsFor('appearance', 'toolbar').map((p) => p.title),
                behaviorToolbar: cfg.panelsFor('behavior', 'toolbar').map((p) => p.title),
            };
        });

        // 'general' exists under both sections; only Behavior has panels for it.
        expect(result.behaviorGeneral.length).toBeGreaterThan(0);
        expect(result.appearanceGeneral).toEqual([]);
        // 'toolbar' likewise, the other way round.
        expect(result.appearanceToolbar.length).toBeGreaterThan(0);
        expect(result.behaviorToolbar).toEqual([]);
    });

    /** The rendered tabs must still get their panels after the rerouting. */
    test('the Behavior and Appearance tabs still render their panels', async ({ page }) => {
        await openSection(page, 'behavior');
        await openSubTab(page, 'data-behavior-tab', 'status');
        await expect(page.locator('[data-behavior-field="statusRecheckIntervalMinutes"]')).toBeVisible();

        await openSection(page, 'appearance');
        await openSubTab(page, 'data-appearance-tab', 'toolbar');
        await expect(page.locator('[data-behavior-field="showConfigButton"]')).toBeVisible();

        await openSubTab(page, 'data-appearance-tab', 'layout');
        await expect(page.locator('[data-behavior-field="columnsPerRow"]')).toBeVisible();
    });
});

test.describe('the section rail scrolls on a narrow screen', () => {
    test.use({ viewport: { width: 420, height: 780 } });

    test('the rail is one scrolling line, not a wrapped block', async ({ page }) => {
        await openSection(page, 'overview');

        const nav = await page.evaluate(() => {
            const el = document.querySelector('.config-nav');
            const style = getComputedStyle(el);
            const items = [...el.querySelectorAll('.config-nav-item')];
            const rows = new Set(items.map((i) => Math.round(i.getBoundingClientRect().top)));
            return {
                wrap: style.flexWrap,
                overflowX: style.overflowX,
                rows: rows.size,
                scrollable: el.scrollWidth > el.clientWidth,
            };
        });

        expect(nav.wrap).toBe('nowrap');
        expect(nav.overflowX).toBe('auto');
        // All eight buttons on one line.
        expect(nav.rows).toBe(1);
        expect(nav.scrollable).toBe(true);
    });

    test('the page itself never scrolls sideways', async ({ page }) => {
        await openSection(page, 'help');
        const overflow = await page.evaluate(() => ({
            body: document.body.scrollWidth - document.body.clientWidth,
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(overflow.body).toBeLessThanOrEqual(1);
        expect(overflow.doc).toBeLessThanOrEqual(1);
    });

    /**
     * Help is the eighth of eight, so it starts outside the strip's visible
     * run — reaching it by hash or by a restored last visit has to bring it
     * into view.
     */
    test('a section opened off-screen is scrolled into view', async ({ page }) => {
        await openSection(page, 'help');
        // The smooth scroll is asynchronous.
        await page.waitForFunction(() => {
            const nav = document.querySelector('.config-nav');
            const active = nav?.querySelector('.config-nav-item.is-active');
            if (!nav || !active) return false;
            const n = nav.getBoundingClientRect();
            const a = active.getBoundingClientRect();
            return a.left >= n.left - 1 && a.right <= n.right + 1;
        }, null, { timeout: 5_000 });
    });
});
