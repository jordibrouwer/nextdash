// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The old Fresh (a quiet count of what every discoverable feed had published) is
 * gone: its routes, its collection, its count on the row and its widget. What
 * remains is Watch feeds, which follows only the feeds a reader chose.
 */
test('the old Fresh routes are gone', async ({ request }) => {
    for (const path of ['/api/feeds', '/api/feeds/retry', '/api/feeds/poll']) {
        const res = path === '/api/feeds'
            ? await request.get(path)
            : await request.post(path, { data: {} });
        expect(res.status(), path).toBe(404);
    }
});

test('no Fresh collection, count or widget type is offered', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    expect(await page.evaluate(() => typeof window.DashboardFeeds)).toBe('undefined');
    expect(await page.evaluate(() => window.dashboardInstance.feeds)).toBeUndefined();
    await expect(page.locator('#dashboard-layout .category[data-category-id="__smart_fresh__"]')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.DashboardWidgets?.feeds)).toBe('undefined');
    const settings = await (await page.request.get('/api/settings')).json();
    expect(settings).not.toHaveProperty('feedsEnabled');
    expect(settings).not.toHaveProperty('smartFreshPageIds');
});
