// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Deleting a bookmark in the health view must clear it from the dashboard grid
 * without a page reload. The health view deletes through its own endpoint and
 * used to leave the dashboard's in-memory copies alone, so the bookmark lingered
 * on the grid until the page was reloaded.
 *
 * Runs against the real server (not a mocked report): the delete mutates the
 * store, and the point is that the live dashboard state follows.
 */
test('deleting in the health view removes the bookmark from the dashboard live', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);

    const url = `https://health-delete-${Date.now()}.example.com`;
    const pageId = await page.evaluate(async (targetUrl) => {
        const d = window.dashboardInstance;
        const pid = Number(d.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: pid, bookmark: { name: 'Delete me', url: targetUrl, category: '' } }),
        });
        return pid;
    }, url);

    // Reload so the seeded bookmark is in the dashboard's arrays, then confirm it
    // is on the grid.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);
    const gridLink = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first();
    await expect(gridLink).toHaveCount(1);

    // Open the health view and delete the row through the view's own path.
    const deleted = await page.evaluate(async (targetUrl) => {
        const d = window.dashboardInstance;
        await d.health.openHealthView();
        // The report is cached server-side for minutes, so a freshly-added
        // bookmark is not in the first read — force a fresh one.
        await d.health.loadAndRender({ refresh: true });
        for (let i = 0; i < 40 && !d.health.report; i += 1) {
            await new Promise((r) => setTimeout(r, 100));
        }
        const issue = (d.health.report?.issues || []).find(
            (it) => String(it.url).trim() === targetUrl
        );
        if (!issue) return { found: false };
        // Skip the confirm dialog by calling the endpoint path deleteIssue uses,
        // then run the same in-memory sync deleteIssue runs. Simpler: stub confirm.
        d.health.confirm = async () => true;
        await d.health.deleteIssue(issue);
        return {
            found: true,
            inBookmarks: (d.bookmarks || []).some((b) => String(b.url).trim() === targetUrl),
            inAllBookmarks: (d.allBookmarks || []).some((b) => String(b.url).trim() === targetUrl),
        };
    }, url);

    expect(deleted.found).toBe(true);
    // The core of the fix: gone from both in-memory arrays with no reload.
    expect(deleted.inBookmarks).toBe(false);
    expect(deleted.inAllBookmarks).toBe(false);

    // And gone from the rendered grid once we return to the dashboard — again
    // without a reload.
    await page.evaluate(() => window.dashboardInstance.health.closeHealthView?.());
    await page.waitForTimeout(400);
    await expect(page.locator(`.bookmark-link[data-bookmark-url="${url}"]`)).toHaveCount(0);
});
