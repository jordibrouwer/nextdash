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

/**
 * Record the rows Config writes, answered without touching the store.
 *
 * Config sends only the rows it changes: a PATCH per page naming each row by
 * URL with the fields that changed. Each request is recorded as a list of
 * rows -- `{ url, ...fields }` -- so a test reads "what was written for this
 * URL" the way it read the whole-page POSTs before. A changed URL shows as the
 * row's `url`, the old one as `fromUrl`.
 */
async function captureRowWrites(page, { status = 200 } = {}) {
    const writes = [];
    await page.route(/\/api\/bookmarks(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const body = JSON.parse(route.request().postData() || '{}');
        const rows = (body.updates || []).map((u) => ({ fromUrl: u.url, url: u.url, ...(u.fields || {}), page: body.page }));
        writes.push(rows);
        return route.fulfill({
            status, contentType: 'application/json',
            body: JSON.stringify(status === 200 ? { status: 'success', updated: rows.length, missing: [] } : { error: 'nope' }),
        });
    });
    return writes;
}

/** Every field written for one URL so far, later writes over earlier ones. */
function mergedRow(writes, url) {
    return writes.flat().filter((row) => row.fromUrl === url || row.url === url)
        .reduce((acc, row) => ({ ...acc, ...row }), null);
}

module.exports = { openBookmarks, openBookmarksWithRows, captureRowWrites, mergedRow };
