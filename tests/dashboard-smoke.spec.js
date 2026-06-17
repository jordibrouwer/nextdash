// @ts-check
const { test, expect } = require('@playwright/test');

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
        await page.evaluate(() => {
            window.dashboardInstance.requestPageNavigation(window.dashboardInstance.pages[1].id);
        });
        await page.waitForTimeout(500);
        const current = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const expected = await page.evaluate(() => Number(window.dashboardInstance.pages[1].id));
        expect(current).toBe(expected);
    });
});
