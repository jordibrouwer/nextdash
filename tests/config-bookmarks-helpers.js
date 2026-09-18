// @ts-check
const { expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, markConfigSettingPromosSeen } = require('./e2e-helpers');

/**
 * Opens Config → Bookmarks → List through the real UI: the `<` shortcut
 * (Shift+Comma) that jumps to config, then a click on the bookmarks section
 * tab. Shared by every workbench spec so each one keeps testing behaviour,
 * not a fabricated shortcut into it.
 */
async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await markConfigSettingPromosSeen(page);
    await page.keyboard.press('Shift+Comma');
    await page.waitForSelector('[data-config-section="bookmarks"]', { timeout: 15_000 });
    await page.click('[data-config-section="bookmarks"]');
    await page.waitForSelector('#config-bm-workbench #config-bm-list .config-bm-row', { timeout: 15_000 });
}

/** Config → Bookmarks over a fixed set of rows, served by route. */
async function openBookmarksWithRows(page, bookmarks) {
    await page.route('**/api/bookmarks?all=true', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(bookmarks),
        });
    });
    await page.route('**/api/bookmarks?page=*', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const pageId = new URL(route.request().url()).searchParams.get('page');
        const rows = bookmarks.filter((b) => String(b.pageId) === String(pageId));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(rows),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((rows) => {
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        window.dashboardInstance.allBookmarks = rows;
        return window.dashboardInstance.config.openConfigView('bookmarks');
    }, bookmarks);
    await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible({ timeout: 10_000 });
}

module.exports = { openBookmarks, openBookmarksWithRows };
