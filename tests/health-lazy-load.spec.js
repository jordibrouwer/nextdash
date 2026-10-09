// @ts-check
const { test, expect } = require('./fixtures');

/**
 * dashboard-health.js and its helpers are fetched on first use rather than on
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

    test('the Bookmarks view fetches the module once', async ({ page }) => {
        /** @type {string[]} */
        const requested = [];
        page.on('request', (req) => {
            const url = req.url();
            if (url.includes('dashboard-health.js')) requested.push(url);
        });

        await page.goto('/');
        await waitReady(page);
        await page.evaluate(() => { window.location.hash = '#bookmarks'; });
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => typeof window.DashboardHealth)).toBe('function');
        expect(requested).toHaveLength(1);
        expect(requested[0]).toMatch(/dashboard-health\.js\?v=[0-9a-f]+$/);

        // Away and back: loaded already, not fetched again.
        await page.evaluate(() => { window.location.hash = '#1'; });
        await page.evaluate(() => { window.location.hash = '#bookmarks'; });
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
        expect(requested).toHaveLength(1);
    });

    // The loaders preload their chain so it downloads side by side. A script
    // the page already carries in its bundle must not be in that chain: the
    // preload is a wasted download, and Safari warns about it in the console.
    test('every preloaded script is one that then runs', async ({ page }) => {
        await page.goto('/');
        await waitReady(page);
        await page.evaluate(() => { window.location.hash = '#bookmarks'; });
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => typeof window.DashboardHealth)).toBe('function');

        const unused = await page.evaluate(() => {
            const ran = new Set([...document.scripts].map((s) => s.src));
            return [...document.querySelectorAll('link[rel="preload"][as="script"]')]
                .map((link) => link.href)
                .filter((href) => !ran.has(href));
        });
        expect(unused).toEqual([]);
    });
});
