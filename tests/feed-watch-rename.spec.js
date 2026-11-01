// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Fresh is called Watch feeds wherever a reader sees it. Only the name moved:
 * the old collection, count and widget are gone.
 */
async function openFeedsTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        c.bmTab = 'fresh';
        c.openConfigView('bookmarks');
    });
    await page.waitForSelector('[data-config-action="checkWatched"]', { timeout: 15_000 });
}

test('the Bookmarks tab and its group are called Watch feeds', async ({ page }) => {
    await openFeedsTab(page);
    await expect(page.locator('[data-bm-tab="fresh"]')).toHaveText('Watch feeds');
    // The breadcrumb and the window title say it too.
    await expect.poll(() => page.title()).toMatch(/bookmarks › watch feeds/i);
    const group = page.locator('[data-config-action="checkWatched"]').locator('xpath=ancestor::*[contains(@class,"config-panel")][1]');
    await expect(group.locator('.config-panel-title').first()).toHaveText('Watch feeds');
    // No visible label in the group still says Fresh.
    expect(await group.innerText()).not.toMatch(/\bFresh\b/);
});
