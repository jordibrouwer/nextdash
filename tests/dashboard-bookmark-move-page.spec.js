// @ts-check
const { test, expect } = require('@playwright/test');
const {
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    prepareDashboardInteraction,
} = require('./e2e-helpers');

/**
 * Moving a bookmark to another page via the row context menu's "Move to…"
 * popover.
 *
 * _moveBookmarkToPage used to GET both pages' whole bookmark arrays, splice
 * the item in memory, and POST both arrays back — two unsynchronized
 * read-modify-writes racing any concurrent write to either page, and if the
 * source save landed but the target save failed, the bookmark vanished from
 * both lists. It now uses the single-item add/delete endpoints instead, so a
 * mid-move failure leaves the bookmark exactly where it started.
 */

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

async function bookmarksOnPage(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/bookmarks?page=${id}`);
        return res.ok ? res.json() : [];
    }, pageId);
}

/**
 * Ensure at least a second page exists so a move has somewhere to go, and
 * return its id. The e2e data dir starts with a single page.
 */
async function ensureSecondPage(page) {
    return page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        const pages = res.ok ? await res.json() : [];
        const existingOther = pages.find((p) => Number(p.id) !== Number(window.dashboardInstance.currentPageId));
        if (existingOther) return { id: Number(existingOther.id), name: existingOther.name };

        const newId = Math.max(0, ...pages.map((p) => Number(p.id) || 0)) + 1;
        const newName = `Move target ${newId}`;
        const nextPages = [...pages, { id: newId, name: newName }];
        const saveRes = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextPages),
        });
        if (!saveRes.ok) throw new Error(`create second page failed: ${saveRes.status}`);
        return { id: newId, name: newName };
    });
}

test.describe('move bookmark to another page', () => {
    test('moving via the context menu adds it to the target and removes it from the source', async ({ page }) => {
        const uniqueUrl = `https://example.com/move-page-${Date.now()}.test`;
        const uniqueName = `Move page test ${Date.now()}`;

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const sourcePageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const { id: targetPageId, name: targetName } = await ensureSecondPage(page);

        await seedBookmark(page, sourcePageId, uniqueName, uniqueUrl);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const row = page.locator('.bookmark-link', { hasText: uniqueName }).first();
        await row.scrollIntoViewIfNeeded();
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="move"]');

        await page.waitForSelector('#move-popover', { timeout: 10_000 });
        await page.click(`#move-popover .move-popover-item[data-type="page"][data-id="${targetPageId}"]`);

        await expect.poll(async () => {
            const target = await bookmarksOnPage(page, targetPageId);
            return target.some((b) => b.url === uniqueUrl);
        }, { timeout: 10_000 }).toBe(true);

        await expect.poll(async () => {
            const source = await bookmarksOnPage(page, sourcePageId);
            return source.some((b) => b.url === uniqueUrl);
        }, { timeout: 10_000 }).toBe(false);

        // Give any stray debounced reorder-save (scheduleBookmarkOrderSave,
        // ~1s) a chance to fire before re-checking — this is exactly the class
        // of bug this test caught: a leftover pendingReorderSnapshot flushing
        // the pre-move bookmark list back and silently undoing the delete.
        await page.waitForTimeout(1500);
        const sourceAfterSettle = await bookmarksOnPage(page, sourcePageId);
        expect(sourceAfterSettle.some((b) => b.url === uniqueUrl)).toBe(false);

        await expect(page.locator('.app-notification', { hasText: targetName })).toBeVisible({ timeout: 10_000 });
    });

    test('a failed add leaves the bookmark on the source page', async ({ page }) => {
        const uniqueUrl = `https://example.com/move-page-fail-${Date.now()}.test`;
        const uniqueName = `Move page fail test ${Date.now()}`;

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const sourcePageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const { id: targetPageId } = await ensureSecondPage(page);

        await seedBookmark(page, sourcePageId, uniqueName, uniqueUrl);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // Force the add call to fail so the move must not touch the source.
        await page.route('**/api/bookmarks/add', (route) => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'forced failure' }),
        }));

        const row = page.locator('.bookmark-link', { hasText: uniqueName }).first();
        await row.scrollIntoViewIfNeeded();
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="move"]');
        await page.waitForSelector('#move-popover', { timeout: 10_000 });
        await page.click(`#move-popover .move-popover-item[data-type="page"][data-id="${targetPageId}"]`);

        await expect(page.locator('.app-notification.error')).toBeVisible({ timeout: 10_000 });

        const source = await bookmarksOnPage(page, sourcePageId);
        expect(source.some((b) => b.url === uniqueUrl)).toBe(true);
        const target = await bookmarksOnPage(page, targetPageId);
        expect(target.some((b) => b.url === uniqueUrl)).toBe(false);
    });
});
