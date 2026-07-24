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

    test('the overview section renders status tiles', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await expect(page.locator('.config-tiles .config-tile').first()).toBeVisible();
        // The bookmarks tile always exists; broken/duplicate/pages/inbox join it.
        const labels = await page.locator('.config-tile-label').allTextContents();
        expect(labels.join(' ').toLowerCase()).toContain('bookmarks');
    });

    test('clicking a section nav item switches section and hash', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await page.locator('[data-config-section="appearance"]').click();

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
        await expect(page.locator('[data-config-section="appearance"]')).toHaveClass(/is-active/);
    });

    test('a broken-links action tile hands off to the health view', async ({ page }) => {
        // Mock the health report so a broken count exists; loadOverviewData refetches
        // this endpoint, so forcing the in-memory report alone would be clobbered.
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: { totalBookmarks: 3, brokenCount: 2, duplicateCount: 0, uncheckedCount: 0, healthyCount: 1 },
                    issues: [],
                }),
            });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        const brokenTile = page.locator('.config-tile[data-tile-view="health"][data-tile-filter="broken"]');
        await expect(brokenTile).toBeVisible();
        await brokenTile.click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('health');
        expect(await page.evaluate(() => window.dashboardInstance.health.filter)).toBe('broken');
    });
});
