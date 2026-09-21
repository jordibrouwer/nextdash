// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, prepareDashboardInteraction } = require('./e2e-helpers');

async function seedBookmark(page, pageId, name, url) {
    await page.evaluate(async ({ targetPageId, targetName, targetUrl }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: targetPageId,
                bookmark: { name: targetName, url: targetUrl, category: '', tags: [], createdAt: Date.now() },
            }),
        });
        if (!res.ok) throw new Error(`seed bookmark failed: ${res.status}`);
    }, { targetPageId: pageId, targetName: name, targetUrl: url });
}

test('Move to... lists Unsorted and moving a bookmark there works', async ({ page }) => {
    const uniqueUrl = `https://example.com/move-unsorted-${Date.now()}.test`;
    const uniqueName = `Move unsorted test ${Date.now()}`;

    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);

    const sourcePageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
    await seedBookmark(page, sourcePageId, uniqueName, uniqueUrl);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);

    const row = page.locator('.bookmark-link', { hasText: uniqueName }).first();
    await row.scrollIntoViewIfNeeded();
    await row.click({ button: 'right' });
    await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
    await page.click('#bookmark-context-menu [data-action="move"]');

    const unsortedItem = page.locator('#move-popover .move-popover-item', { hasText: 'Unsorted' });
    await expect(unsortedItem).toBeVisible({ timeout: 10_000 });
    await unsortedItem.click();

    await expect.poll(async () => {
        const res = await page.request.get('/api/unsorted');
        const body = await res.json();
        return body.bookmarks.some((b) => b.url === uniqueUrl);
    }, { timeout: 10_000 }).toBe(true);
});
