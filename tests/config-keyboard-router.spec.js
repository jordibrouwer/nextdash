// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config is a first-class view in the keyboard router: grid shortcuts must not
 * fire while #dashboard-layout carries config-layout.
 */
async function openConfig(page, section = 'overview') {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
}

test.describe('config keyboard router', () => {
    test('grid list shortcuts do not leave config view', async ({ page }) => {
        await openConfig(page);
        await page.keyboard.press('j');
        await page.keyboard.press('k');
        await page.keyboard.press('g');
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
        await expect(page.locator('.config-nav')).toBeVisible();
    });

    test('letter keys do not open shortcut search while config is active', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('j');
        await page.keyboard.press('k');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('digit section shortcuts jump without closing config', async ({ page }) => {
        await openConfig(page, 'overview');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('5');
        await expect(page.locator('[data-config-section="behavior"][aria-selected="true"]')).toBeVisible();
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);
    });
});
