// @ts-check
const { test, expect } = require('./fixtures');

/**
 * Deep links into the config view. The startup page load used to rewrite the
 * hash to #<n> before anything consumed it, so a fresh load of #config landed
 * on the bookmark grid instead — the same blind spot #health/#inbox were
 * already guarded against.
 *
 * Deliberately no onboarding dismissal: the first visit to a fresh install is
 * exactly where this broke.
 */
async function waitReady(page) {
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?.activeView !== undefined, null, { timeout: 5_000 });
}

test.describe('config deep links', () => {
    test('a fresh load of #config opens the config view', async ({ page }) => {
        await page.goto('/#config');
        await waitReady(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config');
        await expect(page.locator('.config-layout')).toBeVisible();
    });

    test('a fresh load of #config/<section> lands on that section', async ({ page }) => {
        await page.goto('/#config/appearance');
        await waitReady(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance/general');
    });

    test('the legacy /config URL redirects into the view', async ({ page }) => {
        await page.goto('/config');
        await waitReady(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        expect(page.url()).toContain('#config');
    });

    test('clicking the header config link opens the view', async ({ page }) => {
        // Wide enough that the header shows its destinations rather than folding
        // them behind the overflow control; at the default 1280x720 they are in
        // the DOM but not clickable.
        await page.setViewportSize({ width: 1500, height: 950 });
        await page.goto('/');
        await waitReady(page);
        await page.click('a[href="/#config"]');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        await expect(page.locator('.config-layout')).toBeVisible();
    });

    test('a fresh load of #health and #inbox still work', async ({ page }) => {
        await page.goto('/#health');
        await waitReady(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('health');

        await page.goto('/#inbox');
        await waitReady(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    });
});
