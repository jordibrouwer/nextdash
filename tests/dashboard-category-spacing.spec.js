// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Vertical space between category rows.
 *
 * Distinct from densityMode, which sizes the bookmark rows inside a category.
 * This is the gap between the rows of categories themselves, which is what makes
 * a wide page feel empty — the old fixed 3rem left a visible band of nothing
 * between every row on a five-column layout.
 */

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // row-gap only applies to the non-packed grid; packed columns are flex.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.packedColumns = false;
        await d.renderDashboard({ animate: false });
    });
}

const rowGap = (page) => page.evaluate(() =>
    getComputedStyle(document.querySelector('.dashboard-grid')).rowGap);

test.describe('category spacing', () => {
    test('defaults to balanced, which is tighter than the old fixed gap', async ({ page }) => {
        await loadDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-category-spacing'))).toBe('balanced');
        // 32px, down from the 48px that was hard-coded before the setting existed.
        expect(await rowGap(page)).toBe('32px');
    });

    test('each choice drives the gap', async ({ page }) => {
        await loadDashboard(page);
        for (const [mode, expected] of [['snug', '20px'], ['airy', '48px'], ['balanced', '32px']]) {
            await page.evaluate(async (m) => {
                const d = window.dashboardInstance;
                d.settings.categorySpacing = m;
                document.body.setAttribute('data-category-spacing', m);
                await d.renderDashboard({ animate: false });
            }, mode);
            expect(await rowGap(page)).toBe(expected);
        }
    });

    test('changing it in config applies without a reload', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await cfg.openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        const card = page.locator('[data-behavior-field="categorySpacing"][data-behavior-value="snug"]');
        await expect(card).toBeVisible();
        await card.click();

        // The value is mirrored onto <body>, which is why the control is
        // chromeRender rather than render: without the chrome pass the CSS keeps
        // the old gap until the page is reloaded.
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-category-spacing'))).toBe('snug');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => rowGap(page)).toBe('20px');
    });

    test('an unknown stored value falls back to balanced', async ({ page }) => {
        await loadDashboard(page);
        // The server validates on read, so a hand-edited settings.json cannot
        // leave the grid with no gap at all.
        const applied = await page.evaluate(async () => {
            const res = await fetch('/api/settings');
            const s = await res.json();
            return s.categorySpacing;
        });
        expect(['snug', 'balanced', 'airy']).toContain(applied);
    });
});

test.describe('page margins', () => {
    const containerPad = (page) => page.evaluate(() =>
        getComputedStyle(document.querySelector('.container')).paddingLeft);

    test('defaults to the margin the dashboard always had', async ({ page }) => {
        await loadDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-side-margin'))).toBe('balanced');
        // clamp(2rem, 6vw, 8rem) at 1600px wide → 6vw → 96px. Unchanged from
        // before the setting existed, so an existing install sees no difference.
        expect(await containerPad(page)).toBe('96px');
    });

    test('snug hands the width back to the grid', async ({ page }) => {
        await loadDashboard(page);
        // Packed columns (the default) size themselves from the space available,
        // so the reclaimed band actually becomes grid. With packing off the
        // columns are a fixed width and the reclaimed space stays empty — the
        // margin still shrinks, but nothing grows into it.
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.packedColumns = true;
            await d.renderDashboard({ animate: false });
        });
        const before = await page.evaluate(() =>
            Math.round(document.querySelector('.dashboard-grid').getBoundingClientRect().width));

        await page.evaluate(() => {
            window.dashboardInstance.settings.sideMargin = 'snug';
            document.body.setAttribute('data-side-margin', 'snug');
        });

        expect(await containerPad(page)).toBe('40px');
        const after = await page.evaluate(() =>
            Math.round(document.querySelector('.dashboard-grid').getBoundingClientRect().width));
        expect(after).toBeGreaterThan(before);
    });

    test('airy widens the band', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.sideMargin = 'airy';
            document.body.setAttribute('data-side-margin', 'airy');
        });
        expect(await containerPad(page)).toBe('144px');
    });

    test('both controls are three buttons, not a dropdown', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await cfg.openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        for (const field of ['categorySpacing', 'sideMargin']) {
            await expect(page.locator(`[data-behavior-field="${field}"][data-behavior-type="cards"]`)).toHaveCount(3);
            // A <select> would hide two of three spatial choices behind a click.
            await expect(page.locator(`select[data-behavior-field="${field}"]`)).toHaveCount(0);
            // The stored value is pre-selected, so the group shows where you are.
            await expect(page.locator(`[data-behavior-field="${field}"].is-active`)).toHaveCount(1);
        }
    });

    test('clicking a margin card applies it without a reload', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await cfg.openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        await page.locator('[data-behavior-field="sideMargin"][data-behavior-value="snug"]').click();
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-side-margin'))).toBe('snug');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => containerPad(page)).toBe('40px');
    });
});

test.describe('Appearance → Layout panel order', () => {
    test('Bookmarks layout leads, with Layout version last', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            await window.dashboardInstance.config.openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        // Ordered by how often a panel is touched: the grid and the button bar
        // are what people come here to change, while the version switch is a
        // one-off that wants to be findable rather than stepped over. This used
        // to open on Layout version.
        //
        // Categories across columns follows the grid it belongs to: how tall a category
        // gets and how wide it may be are two halves of one question, and both
        // are read after the column count they depend on.
        // First text node only: the heading also carries a "Reset panel" button
        // once something in that panel differs from its default, and whether it
        // is there depends on state left by other tests.
        await expect.poll(() => page.evaluate(() =>
            [...document.querySelectorAll('.config-panel-title')]
                .map((h) => (h.firstChild?.textContent || '').trim())
        //
        // Button bar left this tab when it was given one of its own (v1.3.0):
        // where the bar sits and which buttons it carries are the same errand,
        // and they now sit together under Button bar.
        )).toEqual(['Bookmarks layout', 'Categories across columns', 'Layout version']);
    });

    test('the moved controls are still bound', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            await window.dashboardInstance.config.openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        // Panels are bound by attribute across the whole container, so moving
        // the markup must not cost the bindings — but that is worth pinning.
        const card = page.locator('[data-behavior-field="sideMargin"][data-behavior-value="snug"]');
        await expect(card).toBeVisible();
        await card.click();
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-side-margin'))).toBe('snug');
    });
});
