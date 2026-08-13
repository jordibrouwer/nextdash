// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Deleting a "remote" bookmark — one shown on the current page's dashboard
 * via a cross-page surface (here, the "Recently opened" smart collection set
 * to span all pages) even though it actually lives on a different page.
 *
 * deleteRemoteBookmarkInline used to GET the whole source page's bookmark
 * array, splice the one bookmark out in memory, and POST the whole array
 * back — a read-modify-write that raced any concurrent write to that page
 * landing between the GET and the POST, and silently clobbered it. It now
 * uses the existing single-item DELETE /api/bookmarks endpoint, atomic under
 * the store's own lock.
 */

async function ensureSecondPage(page) {
    return page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        const pages = res.ok ? await res.json() : [];
        const existingOther = pages.find((p) => Number(p.id) !== Number(window.dashboardInstance.currentPageId));
        if (existingOther) return Number(existingOther.id);

        const newId = Math.max(0, ...pages.map((p) => Number(p.id) || 0)) + 1;
        const nextPages = [...pages, { id: newId, name: `Remote delete target ${newId}` }];
        const saveRes = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextPages),
        });
        if (!saveRes.ok) throw new Error(`create second page failed: ${saveRes.status}`);
        return newId;
    });
}

async function seedBookmark(page, pageId, name, url, extra = {}) {
    await page.evaluate(async ({ targetPageId, targetName, targetUrl, targetExtra }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: targetPageId,
                bookmark: { name: targetName, url: targetUrl, category: '', tags: [], createdAt: Date.now(), ...targetExtra },
            }),
        });
        if (!res.ok) throw new Error(`seed bookmark failed: ${res.status}`);
    }, { targetPageId: pageId, targetName: name, targetUrl: url, targetExtra: extra });
}

async function bookmarksOnPage(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/bookmarks?page=${id}`);
        return res.ok ? res.json() : [];
    }, pageId);
}

async function enableCrossPageRecent(page) {
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showSmartRecentCollection: true, smartRecentPageIds: [] }),
        });
    });
}

test.describe('delete a remote (cross-page) bookmark', () => {
    test('deleting from the Recent smart collection removes only that bookmark from its own page', async ({ page }) => {
        const stamp = Date.now();
        const targetName = `Remote delete target ${stamp}`;
        const targetUrl = `https://example.com/remote-delete-target-${stamp}.test`;
        const keptName = `Remote delete keep ${stamp}`;
        const keptUrl = `https://example.com/remote-delete-keep-${stamp}.test`;

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const currentPageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const otherPageId = await ensureSecondPage(page);
        test.skip(otherPageId === currentPageId, 'needs a second page distinct from the current one');

        // Both bookmarks live on the OTHER page, with a recent lastOpened so
        // they surface in the current page's "Recently opened" smart
        // collection once cross-page loading is on.
        await seedBookmark(page, otherPageId, targetName, targetUrl, { lastOpened: Date.now() });
        await seedBookmark(page, otherPageId, keptName, keptUrl, { lastOpened: Date.now() - 1000 });
        await enableCrossPageRecent(page);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await expect(page.locator('.bookmark-link', { hasText: targetName }).first()).toBeVisible({ timeout: 15_000 });

        const deleteRequests = [];
        page.on('request', (req) => {
            if (req.method() === 'DELETE' && req.url().endsWith('/api/bookmarks')) {
                deleteRequests.push(req.url());
            }
        });

        const row = page.locator('.bookmark-link', { hasText: targetName }).first();
        await row.scrollIntoViewIfNeeded();
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="delete"]');
        await page.waitForSelector('#delete-popover', { timeout: 10_000 });
        await page.click('#delete-popover [data-action="confirm"]');

        await expect.poll(async () => {
            const remaining = await bookmarksOnPage(page, otherPageId);
            return remaining.some((b) => b.url === targetUrl);
        }, { timeout: 10_000 }).toBe(false);

        expect(deleteRequests.length).toBeGreaterThan(0);

        // The whole-list write this replaces would have re-POSTed the entire
        // page including the other bookmark; confirming it is untouched (and
        // not just "not deleted") is the point of the single-item endpoint.
        const remaining = await bookmarksOnPage(page, otherPageId);
        const kept = remaining.find((b) => b.url === keptUrl);
        expect(kept).toBeTruthy();
        expect(kept.name).toBe(keptName);

        await expect(page.locator('.app-notification', { hasText: targetName })).toBeVisible({ timeout: 10_000 });
    });

    test('a 404 from the delete surfaces an error instead of silently succeeding', async ({ page }) => {
        const stamp = Date.now();
        const targetName = `Remote delete missing ${stamp}`;
        const targetUrl = `https://example.com/remote-delete-missing-${stamp}.test`;

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const currentPageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const otherPageId = await ensureSecondPage(page);
        test.skip(otherPageId === currentPageId, 'needs a second page distinct from the current one');

        await seedBookmark(page, otherPageId, targetName, targetUrl, { lastOpened: Date.now() });
        await enableCrossPageRecent(page);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await expect(page.locator('.bookmark-link', { hasText: targetName }).first()).toBeVisible({ timeout: 15_000 });

        // Simulate the bookmark already having been removed by someone else
        // between the row rendering and the click landing.
        await page.route('**/api/bookmarks', async (route) => {
            if (route.request().method() === 'DELETE') {
                await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Bookmark not found' });
                return;
            }
            await route.fallback();
        });

        const row = page.locator('.bookmark-link', { hasText: targetName }).first();
        await row.scrollIntoViewIfNeeded();
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="delete"]');
        await page.waitForSelector('#delete-popover', { timeout: 10_000 });
        await page.click('#delete-popover [data-action="confirm"]');

        await expect(page.locator('.app-notification.error')).toBeVisible({ timeout: 10_000 });
    });
});
