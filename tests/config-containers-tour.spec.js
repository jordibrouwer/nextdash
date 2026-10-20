// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, markWhatsNewSeen } = require('./e2e-helpers');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * Config → Containers carries a Tour button on its band, as Widgets, the Inbox
 * and the Bookmarks and Containers views do. It plays the Containers view's
 * tour, seen or not: the same as Config → Help → Tours, one click closer.
 */
test('Config → Containers has a Tour button that plays the Containers tour', async ({ page }) => {
    await mockDocker(page);
    await markWhatsNewSeen(page);
    await page.goto('/#config/containers');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('containers'));

    const button = page.locator('[data-containers-tour]');
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expect(button).toHaveText('Tour');

    await button.click();
    await expect(page.locator('#app-modal.show .containers-tutorial-modal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.containers-tutorial-progress')).toHaveText('Step 1 of 6');
});

test('the Tour button is only on the Containers section of config', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/#config/overview');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect(page.locator('.config-view-head')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-containers-tour]')).toHaveCount(0);
});
