// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * dashboard-config.js is the largest script in the app and the config view is a
 * separate destination, so it is fetched on first open rather than on every
 * dashboard load (dashboard-config-loader.js).
 *
 * These guard the two ways that goes wrong: the heavy module sneaking back into
 * the initial page load, and the loader stub drifting from the module it stands
 * in for — its mirrored section list is what parses a #config/<section> deep
 * link before the module exists.
 */
async function waitReady(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?.activeView !== undefined, null, { timeout: 5_000 });
}

test.describe('config lazy load', () => {
    test('the config module is not fetched on a plain dashboard load', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            if (req.url().includes('dashboard-config.js')) requested.push(req.url());
        });

        await page.goto('/');
        await waitReady(page);

        expect(requested).toEqual([]);
        // The stub stands in for it and the class itself is absent until opened.
        expect(await page.evaluate(() => typeof window.DashboardConfig)).toBe('undefined');
        expect(await page.evaluate(() => Boolean(window.dashboardInstance.config))).toBe(true);
    });

    test('opening config fetches the module once and renders the view', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            if (req.url().includes('dashboard-config.js')) requested.push(req.url());
        });

        await page.goto('/');
        await waitReady(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await expect(page.locator('.config-layout')).toBeVisible();
        expect(await page.evaluate(() => typeof window.DashboardConfig)).toBe('function');
        expect(requested).toHaveLength(1);
        // Content-hashed, so it can be cached immutably (asset_hash.go).
        expect(requested[0]).toMatch(/dashboard-config\.js\?v=[0-9a-f]+$/);

        // Re-opening must not fetch it a second time.
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await expect(page.locator('.config-layout')).toBeVisible();
        expect(requested).toHaveLength(1);
    });

    test('the loader mirrors the module section list', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        // Force the module in so both lists can be compared in one place.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        await expect(page.locator('.config-layout')).toBeVisible();

        const { stub, module } = await page.evaluate(() => ({
            stub: window.DashboardConfigLoader.SECTIONS,
            module: window.DashboardConfig.SECTIONS,
        }));
        expect(stub).toEqual(module);
    });

    test('a deep link into a sub-tab survives the lazy load', async ({ page }) => {
        // The section is parsed by the stub and the sub-tab is buffered, then
        // both are replayed onto the module once it arrives.
        await page.goto('/#config/behavior/privacy');
        await waitReady(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('behavior');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.behaviorTab)).toBe('privacy');
    });

    test('a method call before the module loads still reaches it', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);

        // setBehavior lives only on the module; the loader forwards it and loads
        // on demand, so callers never have to know it was not there yet.
        await page.evaluate(() => window.dashboardInstance.config.setBehavior('dashboardTitle', 'lazy-load-probe', ''));
        await expect.poll(() => page.evaluate(() => typeof window.DashboardConfig)).toBe('function');
    });
});
