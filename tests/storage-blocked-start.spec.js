// @ts-check
const { test, expect } = require('./fixtures');

/*
 * With site data blocked the localStorage getter itself throws. The theme
 * loader read it bare at the top of the page and stopped before ThemeLoader
 * existed, and the first data load read it bare as well and failed with
 * "Failed to load dashboard".
 */
test('the dashboard starts with site data blocked', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        });
    });
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => Boolean(window.ThemeLoader)), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?._bookmarksReady === true), { timeout: 20_000 }).toBe(true);
    await expect(page.getByText('Failed to load dashboard')).toHaveCount(0);
});
