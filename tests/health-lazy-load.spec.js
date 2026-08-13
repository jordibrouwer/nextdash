// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * dashboard-health.js and its helpers are fetched on first open rather than on
 * every dashboard load (dashboard-health-loader.js).
 */
async function waitReady(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?.activeView !== undefined, null, { timeout: 5_000 });
}

test.describe('health lazy load', () => {
    test('the health module is not fetched on a plain dashboard load', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            const url = req.url();
            // last-opened-format.js is deliberately eager since 8115b0e7: row
            // tooltips and the preview card need formatLastOpened on every
            // session, not only after Health has been opened.
            if (url.includes('dashboard-health.js')
                || url.includes('health-reason-utils.js')) {
                requested.push(url);
            }
        });

        await page.goto('/');
        await waitReady(page);

        expect(requested).toEqual([]);
        expect(await page.evaluate(() => typeof window.DashboardHealth)).toBe('undefined');
        expect(await page.evaluate(() => Boolean(window.dashboardInstance.health))).toBe(true);
    });

    test('opening health fetches the module once and renders the view', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            const url = req.url();
            if (url.includes('dashboard-health.js')) requested.push(url);
        });

        await page.goto('/');
        await waitReady(page);
        await page.evaluate(() => window.dashboardInstance.health.openHealthView());

        await expect(page.locator('.health-layout')).toBeVisible();
        expect(await page.evaluate(() => typeof window.DashboardHealth)).toBe('function');
        expect(requested).toHaveLength(1);
        expect(requested[0]).toMatch(/dashboard-health\.js\?v=[0-9a-f]+$/);

        await page.evaluate(() => window.dashboardInstance.health.closeHealthView());
        await page.evaluate(() => window.dashboardInstance.health.openHealthView());
        await expect(page.locator('.health-layout')).toBeVisible();
        expect(requested).toHaveLength(1);
    });
});
