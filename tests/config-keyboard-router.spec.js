// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Config is a first-class view in the keyboard router: grid shortcuts must not
 * fire while #dashboard-layout carries config-layout.
 */
async function openConfig(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
}

test.describe('config keyboard router', () => {
    test('j and k move the section rail without closing config', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('j');
        await expect(page.locator('[data-config-section="bookmarks"][aria-selected="true"]')).toBeVisible();
        await page.keyboard.press('k');
        await expect(page.locator('[data-config-section="overview"][aria-selected="true"]')).toBeVisible();
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
    });

    test('letter keys do not open shortcut search while config is active', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('j');
        await page.keyboard.press('k');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('digit keys leave config for bookmark pages', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });
});
