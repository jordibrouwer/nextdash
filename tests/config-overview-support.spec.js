// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/** The Overview opens its right column with a loud Ko-fi card, above "From nextDash". */
test('Overview has a Support card with the Ko-fi button above From nextDash', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    const card = page.locator('.config-overview-support');
    await expect(card).toBeVisible();
    await expect(card.locator('a.wn-kofi-btn')).toHaveAttribute('href', 'https://ko-fi.com/jordibrw');
    const zones = page.locator('.config-overview-aside .config-overview-zone');
    await expect(zones.first()).toHaveText('Support nextDash');
    // The panels redraw as their data arrives, which moves the card; measure once they are still.
    await page.waitForTimeout(600);
    const cardBox = await card.boundingBox();
    const headBox = await zones.first().boundingBox();
    const mainBox = await page.locator('.config-overview-main .config-overview-zone').boundingBox();
    expect(Math.abs(headBox.y - mainBox.y)).toBeLessThan(2);
    expect(headBox.y + headBox.height).toBeLessThanOrEqual(cardBox.y);
    const fromBox = await zones.nth(1).boundingBox();
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(fromBox.y);
});
