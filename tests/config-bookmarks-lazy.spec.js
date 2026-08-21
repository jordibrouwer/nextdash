// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The bookmark list's renderers arrive with the section, not with the module.
 *
 * Twelve methods drew one list — rows, bulk bar, tag cloud, chips, crumbs — and
 * every visit to any other config section carried them. Split out the way
 * Statistics already is: fetched when config opens, so the list is drawn once
 * and complete, and never fetched at all by someone who only ever changes a
 * theme.
 */

async function openConfig(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForSelector('#config-section-panel, #config-view-body', { timeout: 15_000 });
}

test.describe('the bookmark list loads with its section', () => {
    test('the dashboard alone never fetches it', async ({ page }) => {
        const asked = [];
        page.on('request', (r) => {
            if (r.url().includes('dashboard-config-bookmarks')) asked.push(r.url());
        });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.waitForTimeout(800);
        expect(asked.length).toBe(0);
    });

    test('opening Bookmarks draws the list once, complete', async ({ page }) => {
        await openConfig(page, 'bookmarks');

        // No placeholder left behind, and the rows are really there.
        await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.DashboardConfigBookmarksReady === true)).toBe(true);
        const loading = await page.locator('#config-bm-list').innerText();
        expect(loading).not.toMatch(/loading your bookmarks/i);
    });

    test('the section still works when the file cannot be fetched', async ({ page }) => {
        await page.route('**/dashboard-config-bookmarks*', (route) => route.abort());
        await openConfig(page, 'bookmarks');

        // A failure leaves the placeholder, which says the list is on its way —
        // better than an empty panel that reads as a library with nothing in it.
        await expect(page.locator('#config-bm-list')).toContainText(/loading your bookmarks|bladwijzers laden/i, { timeout: 15_000 });
        // And the rest of config is untouched: the toolbar above it still draws.
        await expect(page.locator('#config-bm-search')).toBeVisible();
    });
});
