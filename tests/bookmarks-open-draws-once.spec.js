// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Opening Bookmarks drew the list four times: once, then again when the
 * category names it already had "arrived" (twice, from two callers), and once
 * more a frame later to fill a screen that a page of ten left short. Every
 * draw rebuilt the rows and measured their tag chips, which forces a layout.
 *
 * With the names in hand and a short page size, an open is one draw.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('opening Bookmarks draws the list once', async ({ page }) => {
    await openDashboard(page);
    // A first open fetches the category names; the one that counts is the
    // next, when they are cached -- every open after the first in a session.
    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => {
        const c = window.dashboardInstance.config.instance;
        return (window.dashboardInstance.pages || []).every((p) => c._bmCategoriesCache.has(String(p.id)));
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');

    const draws = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const c = d.config.instance;
        // A page of ten leaves the screen short, which is the case that drew
        // a second page a frame after the first.
        d.settings.configBookmarksPageSize = 10;
        c.resetBookmarkVisibleLimit();
        let count = 0;
        const P = window.DashboardConfig.prototype;
        const original = P.repaintBookmarksList;
        P.repaintBookmarksList = function (...args) { count += 1; return original.apply(this, args); };
        try {
            await c.openLibraryView();
            await new Promise((r) => { setTimeout(r, 1200); });
        } finally {
            P.repaintBookmarksList = original;
        }
        return {
            count,
            rows: document.querySelectorAll('#config-bm-list .config-bm-row').length,
            total: c.visibleBookmarks().length,
        };
    });

    // The first draw is render() itself; a repaint on top of it is the waste.
    expect(draws.count).toBe(0);
    // And the one draw still fills the screen.
    const sentinelBelowOrDone = await page.evaluate(() => {
        const s = document.querySelector('[data-bm-load-more]');
        return !s || s.hidden || s.getBoundingClientRect().top > window.innerHeight;
    });
    expect(draws.rows === draws.total || sentinelBelowOrDone).toBe(true);
});
