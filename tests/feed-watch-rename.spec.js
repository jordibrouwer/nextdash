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
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.locator('[data-config-section="feed-watch"]').click();
    // The news settings sit on the Settings tab.
    await page.locator('[data-fw-tab="settings"]').click();
    await page.waitForSelector('[data-behavior-field="feedWatchWindowMinutes"]', { timeout: 15_000 });
}

test('the Config section and its group are called Watch feeds', async ({ page }) => {
    await openFeedsTab(page);
    await expect(page.locator('[data-config-section="feed-watch"]')).toHaveText('Watch feeds');
    // The breadcrumb and the window title say it too.
    await expect.poll(() => page.title()).toMatch(/config › watch feeds/i);
    const group = page.locator('[data-behavior-field="feedWatchWindowMinutes"]').locator('xpath=ancestor::*[contains(@class,"config-panel")][1]');
    await expect(group.locator('.config-panel-title').first()).toHaveText('Watch feeds');
    // No visible label in the group still says Fresh.
    expect(await group.innerText()).not.toMatch(/\bFresh\b/);
});
