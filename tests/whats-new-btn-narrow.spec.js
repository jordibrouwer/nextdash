// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The What's new star stays out of a phone-sized screen.
 *
 * It was hidden only on a touch phone. A window as narrow as a phone without a
 * touch screen -- a narrowed browser, a side panel -- still had it floating over
 * the list. Config → About keeps the same news either way.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('hidden in a phone-width window', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 800 });
    await openDashboard(page);
    await expect(page.locator('#whats-new-btn')).toBeHidden();
});

test('still there on a desktop-width window', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openDashboard(page);
    await expect(page.locator('#whats-new-btn')).toBeVisible();
});
