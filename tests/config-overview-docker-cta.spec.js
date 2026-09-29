// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * An Overview feature whose button reads "Open Containers →" carries
 * `go: { view: 'docker' }`. openViewFromTile() knew health and inbox only, so
 * the button closed nothing and opened nothing; it now opens the view.
 */
test('an Overview feature can open the Containers view', async ({ page }) => {
    await mockDocker(page);
    await page.goto('/#config/overview');
    await expect.poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.config))).toBe(true);
    await page.evaluate(() => window.dashboardInstance.config.openViewFromTile('docker'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('docker');
    await expect(page.locator('[data-docker-row]').first()).toBeVisible();
});
