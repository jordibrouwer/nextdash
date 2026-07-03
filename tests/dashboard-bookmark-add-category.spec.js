// @ts-check
const { test, expect } = require('@playwright/test');

async function deleteBookmarkByUrl(page, pageId, url) {
    await page.evaluate(async ({ targetPageId, targetUrl }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/bookmarks?page=${targetPageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const bookmark = (list || []).find(
            (bm) => String(bm?.url || '').trim().toLowerCase() === String(targetUrl).trim().toLowerCase()
        );
        if (!bookmark) return;
        await api('/api/bookmarks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: targetPageId, bookmark }),
        });
    }, { targetPageId: pageId, targetUrl: url });
}

test.describe('dashboard bookmark add category placement', () => {
    test('new bookmark appears in assigned category column after modal save', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const uniqueUrl = `https://example.com/category-placement-${Date.now()}.test`;
        const uniqueName = `Category placement ${Date.now()}`;

        await page.locator('#quick-add-toolbar-btn').click();
        await page.waitForSelector('#new-bookmark-modal.show', { timeout: 10_000 });

        await page.fill('#new-bookmark-url', uniqueUrl);
        await page.fill('#new-bookmark-name', uniqueName);
        await page.locator('#new-bookmark-url').blur();

        await page.waitForFunction(() => {
            const select = document.getElementById('new-bookmark-category');
            return select && select.options.length > 1;
        }, { timeout: 10_000 });

        await page.selectOption('#new-bookmark-category', 'media');
        await page.locator('#new-bookmark-create').click();
        await expect(page.locator('#new-bookmark-modal')).not.toHaveClass(/show/, { timeout: 10_000 });

        const mediaSelector = `.category[data-category-id="media"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`;
        await expect(page.locator(mediaSelector)).toBeVisible({ timeout: 10_000 });

        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });

    test('refreshAfterBookmarkAdded bypasses stale page cache', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const uniqueUrl = `https://example.com/cache-bypass-${Date.now()}.test`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);

        const result = await page.evaluate(async ({ targetPageId, targetUrl }) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const hadCache = d._pageDataCache?.has(Number(targetPageId)) === true;
            const beforeCount = Array.isArray(d.bookmarks) ? d.bookmarks.length : 0;

            const addRes = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: targetPageId,
                    bookmark: {
                        name: 'Cache bypass test',
                        url: targetUrl,
                        category: 'media',
                        tags: [],
                        createdAt: Date.now(),
                    },
                }),
            });
            if (!addRes.ok) {
                return { ok: false, step: 'add', status: addRes.status };
            }

            await d.data.refreshAfterBookmarkAdded(targetPageId);

            const inBookmarks = (d.bookmarks || []).some(
                (bm) => String(bm?.url || '').trim().toLowerCase() === targetUrl.toLowerCase()
            );
            const inMediaColumn = Boolean(
                document.querySelector(
                    `.category[data-category-id="media"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${targetUrl}"]`
                )
            );

            return {
                ok: true,
                hadCache,
                beforeCount,
                afterCount: Array.isArray(d.bookmarks) ? d.bookmarks.length : 0,
                inBookmarks,
                inMediaColumn,
            };
        }, { targetPageId: pageId, targetUrl: uniqueUrl });

        expect(result.ok).toBe(true);
        expect(result.inBookmarks).toBe(true);
        expect(result.inMediaColumn).toBe(true);
        expect(result.afterCount).toBeGreaterThan(result.beforeCount);

        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });

    test('stale page cache is bypassed when allBookmarks is newer', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const uniqueUrl = `https://example.com/cache-heal-${Date.now()}.test`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);

        const result = await page.evaluate(async ({ targetPageId, targetUrl }) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const addRes = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: targetPageId,
                    bookmark: {
                        name: 'Cache heal test',
                        url: targetUrl,
                        category: 'media',
                        tags: [],
                        createdAt: Date.now(),
                    },
                }),
            });
            if (!addRes.ok) {
                return { ok: false, step: 'add', status: addRes.status };
            }

            await d.loadAllBookmarks();
            const entry = d._pageDataCache?.get(Number(targetPageId));
            if (entry) {
                entry.bookmarks = entry.bookmarks.filter(
                    (bm) => String(bm?.url || '').trim().toLowerCase() !== targetUrl.toLowerCase()
                );
            }
            d.bookmarks = (d.bookmarks || []).filter(
                (bm) => String(bm?.url || '').trim().toLowerCase() !== targetUrl.toLowerCase()
            );
            await d.loadPageBookmarks(targetPageId);

            const mediaHas = !!document.querySelector(
                `.category[data-category-id="media"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${targetUrl}"]`
            );
            return {
                ok: true,
                mediaHas,
                inBookmarks: (d.bookmarks || []).some(
                    (bm) => String(bm?.url || '').trim().toLowerCase() === targetUrl.toLowerCase()
                ),
            };
        }, { targetPageId: pageId, targetUrl: uniqueUrl });

        expect(result.ok).toBe(true);
        expect(result.mediaHas).toBe(true);
        expect(result.inBookmarks).toBe(true);

        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });

    test('isPageBookmarksStale detects tag-only divergence', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const pageId = Number(d.currentPageId) || 1;
            const source = Array.isArray(d.bookmarks) && d.bookmarks.length
                ? d.bookmarks[0]
                : null;
            if (!source) {
                return { ok: false, reason: 'no-bookmarks' };
            }

            const staleBookmarks = d.bookmarks.map((bm, index) => (
                index === 0
                    ? { ...bm, tags: [...(bm.tags || []), 'stale-tag-test'] }
                    : bm
            ));
            const freshAll = (d.allBookmarks || []).map((bm) => (
                String(bm?.url || '').trim().toLowerCase() === String(source.url || '').trim().toLowerCase()
                    && Number(bm.pageId) === pageId
                    ? { ...bm, tags: ['fresh-tag-test'] }
                    : bm
            ));

            d.allBookmarks = freshAll;
            const stale = d.data.isPageBookmarksStale(pageId, staleBookmarks);
            const sameTags = staleBookmarks.map((bm, index) => (
                index === 0 ? { ...bm, tags: ['fresh-tag-test'] } : bm
            ));
            const notStale = d.data.isPageBookmarksStale(pageId, sameTags);

            return { ok: true, stale, notStale };
        });

        expect(result.ok).toBe(true);
        expect(result.stale).toBe(true);
        expect(result.notStale).toBe(false);
    });

    test('isPageBookmarksStale detects name and shortcut divergence', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const pageId = Number(d.currentPageId) || 1;
            const source = Array.isArray(d.bookmarks) && d.bookmarks.length
                ? d.bookmarks[0]
                : null;
            if (!source) {
                return { ok: false, reason: 'no-bookmarks' };
            }

            const urlKey = String(source.url || '').trim().toLowerCase();
            const staleName = d.bookmarks.map((bm, index) => (
                index === 0 ? { ...bm, name: 'Stale name probe' } : bm
            ));
            const staleShortcut = d.bookmarks.map((bm, index) => (
                index === 0 ? { ...bm, shortcut: 'ZZ' } : bm
            ));
            const freshAll = (d.allBookmarks || []).map((bm) => (
                String(bm?.url || '').trim().toLowerCase() === urlKey
                    && Number(bm.pageId) === pageId
                    ? { ...bm, name: source.name, shortcut: source.shortcut }
                    : bm
            ));

            d.allBookmarks = freshAll;
            return {
                ok: true,
                nameStale: d.data.isPageBookmarksStale(pageId, staleName),
                shortcutStale: d.data.isPageBookmarksStale(pageId, staleShortcut),
                fresh: d.data.isPageBookmarksStale(pageId, d.bookmarks),
            };
        });

        expect(result.ok).toBe(true);
        expect(result.nameStale).toBe(true);
        expect(result.shortcutStale).toBe(true);
        expect(result.fresh).toBe(false);
    });
});
