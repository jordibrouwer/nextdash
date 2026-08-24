// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Three changes that are only worth making if the view still behaves: the
 * spotlight catalogue moved out of the module into data, a row's menus are
 * built when they are opened rather than for every row up front, and switching
 * sections reuses the shell around the panel.
 */

async function openConfig(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForSelector('.config-view-body', { timeout: 20_000 });
    await page.waitForTimeout(500);
}

test.describe('the spotlight catalogue is data', () => {
    test('it is fetched, and the carousel shows what it holds', async ({ page }) => {
        await openConfig(page, 'overview');
        const fetched = await page.evaluate(() => performance.getEntriesByType('resource')
            .some((r) => r.name.includes('overview-features.json')));
        expect(fetched).toBe(true);

        const state = await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            const list = c.overviewNewFeatures();
            return {
                count: list.length,
                first: list[0]?.titleKey,
                // Every entry carries the five keys the panel renders and a
                // target for its button; a half-copied catalogue would not.
                complete: list.every((e) => e.titleKey && e.whatKey && e.howKey && e.enableKey && e.ctaKey && e.go),
            };
        });
        expect(state.count).toBeGreaterThan(30);
        expect(state.complete).toBe(true);
        // The carousel that used to draw one of these at a time is gone
        // (v1.3.3); the overview draws the recent ones as rows in the news
        // stream and the rest live under About → News & features. What this
        // file is about is the catalogue being fetched data rather than 42
        // entries compiled into the config module, which is asserted above.
        await expect(page.locator('.config-news-panel')).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('a row builds its menus when they are opened', () => {
    test('no menu items until one is asked for', async ({ page }) => {
        await openConfig(page, 'bookmarks');
        await page.waitForSelector('.config-bm-row', { timeout: 15_000 });

        const rows = await page.locator('.config-bm-row').count();
        expect(rows).toBeGreaterThan(1);
        // Fifty rows used to carry two full menus each, hidden.
        expect(await page.locator('.health-view-menu .health-view-menu-item').count()).toBe(0);

        const key = await page.locator('.config-bm-row').first().getAttribute('data-bm-key');
        await page.evaluate((k) => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            c.toggleBookmarkMenu(k, 'more');
        }, key);
        await page.waitForTimeout(300);
        const open = page.locator('.health-view-menu:not([hidden]) .health-view-menu-item');
        expect(await open.count()).toBeGreaterThan(4);
        // Built once: opening it again does not stack a second copy of the items.
        const first = await open.count();
        await page.evaluate((k) => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            c.toggleBookmarkMenu(k, 'more');
            c.toggleBookmarkMenu(k, 'more');
        }, key);
        await page.waitForTimeout(300);
        expect(await page.locator('.health-view-menu:not([hidden]) .health-view-menu-item').count()).toBe(first);
    });
});

test.describe('switching sections keeps the shell', () => {
    test('the rail is bound once and still switches sections', async ({ page }) => {
        await openConfig(page, 'overview');
        const railBefore = await page.locator('.config-nav-column').elementHandle();

        await page.locator('[data-config-section="behavior"]').click();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            return c.section;
        })).toBe('behavior');

        // The same element, not a rebuilt one: that is what the reuse buys, and
        // what makes a double-bound rail possible if the guard were missing.
        const railAfter = await page.locator('.config-nav-column').elementHandle();
        expect(await page.evaluate(([a, b]) => a === b, [railBefore, railAfter])).toBe(true);

        // One click, one switch — a rail bound twice would fire two handlers and
        // the second could land on a stale section.
        await page.locator('[data-config-section="about"]').click();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            return c.section;
        })).toBe('about');
        await expect(page.locator('.config-view-section-title')).toHaveText(/about/i);
    });
});
