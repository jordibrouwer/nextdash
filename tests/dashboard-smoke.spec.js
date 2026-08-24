// @ts-check
const { test, expect } = require('./fixtures');

test.describe('dashboard smoke', () => {
    test('loads bookmark grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible({ timeout: 15_000 });
    });

    test('exposes DashboardData module', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        const ok = await page.evaluate(() => typeof window.DashboardData === 'function'
            && typeof window.dashboardInstance?.loadData === 'function');
        expect(ok).toBe(true);
    });

    test('switches page via hash', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        const pageCount = await page.evaluate(() => window.dashboardInstance?.pages?.length || 0);
        test.skip(pageCount < 2, 'needs at least two pages');
        const expected = await page.evaluate(() => Number(window.dashboardInstance.pages[1].id));
        await page.evaluate(async (targetId) => {
            await window.dashboardInstance.requestPageNavigation(targetId);
        }, expected);
        await expect.poll(async () => page.evaluate(() => (
            Number(window.dashboardInstance.currentPageId)
        ))).toBe(expected);
    });

    test('reuses page cache on second visit', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        const pageCount = await page.evaluate(() => window.dashboardInstance?.pages?.length || 0);
        test.skip(pageCount < 2, 'needs at least two pages');

        const metrics = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const targetId = Number(d.pages[1].id);
            await d.requestPageNavigation(targetId);
            const firstSwitchMs = performance.now();
            await d.requestPageNavigation(Number(d.pages[0].id));
            await d.requestPageNavigation(targetId);
            const roundTripMs = performance.now() - firstSwitchMs;
            const cached = d._pageDataCache?.has(targetId) === true;
            return { cached, roundTripMs };
        });

        expect(metrics.cached).toBe(true);
        expect(metrics.roundTripMs).toBeLessThan(500);
    });
});
