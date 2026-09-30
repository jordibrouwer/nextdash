// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/*
 * A re-check that never ran -- the dashboard's own ping limit answering 429, a
 * proxy's 502 -- was saved as the bookmark's outage.
 */
test('a refused re-check records nothing on the bookmark', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
    await page.waitForFunction(() => {
        const h = window.dashboardInstance.health?._module || window.dashboardInstance.health;
        return typeof h?.recheckIssue === 'function';
    }, null, { timeout: 15_000 });

    const target = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const i = d.bookmarks.findIndex((b) => !b.lastError);
        return { pageId: Number(d.currentPageId), index: i, url: d.bookmarks[i].url };
    });
    await page.route('**/api/ping?**', (route) => route.fulfill({ status: 429, body: 'Too many requests' }));
    await page.evaluate(async (issue) => {
        const h = window.dashboardInstance.health?._module || window.dashboardInstance.health;
        await h.recheckIssue(issue, { silent: true });
    }, target);
    const stored = await page.evaluate(async ({ pageId, url }) => {
        const rows = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
        return (Array.isArray(rows) ? rows : rows.bookmarks || []).find((b) => b.url === url)?.lastError || '';
    }, target);
    expect(stored).toBe('');
});
