// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * The page filter on a phone.
 *
 * On a desktop the filter is summoned with Shift+F. A phone has no Shift+F and
 * no bar either: Search is a tab of its own there.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

test.describe('page filter on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    // The phone has its own Search tab and a compact search sheet; a pinned
    // page filter sat over that sheet's field, so the phone gets no bar.
    test('there is no page filter bar on a phone', async ({ page }) => {
        await openDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-mobile-layout'))).toBe('true');
        await expect(page.locator('#grid-filter-bar')).toHaveCount(0);
    });
});

test('a desktop window does not get the bar until Shift+F', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('#grid-filter-bar')).toHaveCount(0);
});
