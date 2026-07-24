// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config as a dashboard view — Phase 1 scaffold.
 *
 * These pin the shell wiring (the view opens, owns the hash, sets the
 * config-layout class, and closes back to bookmarks) rather than the section
 * content, which arrives in later phases.
 */

/** Load the dashboard and wait until the instance is ready to be driven. */
async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('config dashboard view (scaffold)', () => {
    test('opening #config activates the config view', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        const container = page.locator('#dashboard-layout');
        await expect(container).toHaveClass(/config-layout/);
        await expect(page.locator('.config-view')).toBeVisible();
        expect(await page.evaluate(() => window.location.hash)).toBe('#config');
    });

    test('the header config link opens the view without a page reload', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => { window.__noReload = true; });
        await page.locator('.config-link a').click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('config');
        // Same document instance — never navigated away.
        expect(await page.evaluate(() => window.__noReload)).toBe(true);
    });

    test('Escape returns from config to the bookmarks view', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');

        await page.locator('body').press('Escape');

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('bookmarks');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });

    test('a config/appearance hash selects the appearance section', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
    });
});
