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

test.describe('config to dashboard category sync', () => {
    test('bookmark moved to media in config appears in media column on dashboard', async ({ page }) => {
        const uniqueUrl = `https://example.com/config-media-sync-${Date.now()}.test`;
        const uniqueName = `Config media sync ${Date.now()}`;
        const pageId = 1;

        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await page.evaluate(async ({ targetPageId, targetUrl, targetName }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: targetPageId,
                    bookmark: {
                        name: targetName,
                        url: targetUrl,
                        category: '',
                        tags: [],
                        createdAt: Date.now(),
                    },
                }),
            });
            if (!res.ok) {
                throw new Error(`add failed: ${res.status}`);
            }
        }, { targetPageId: pageId, targetUrl: uniqueUrl, targetName: uniqueName });

        await page.goto(`/config#bookmarks?_=${Date.now()}`);
        await page.waitForFunction(() => typeof window.configManager?.saveChanges === 'function');
        await page.evaluate(async () => {
            const cm = window.configManager;
            cm.ui.switchToTab('bookmarks');
            await cm.loadPageBookmarks(1);
        });
        await page.waitForFunction(
            async ({ targetUrl }) => {
                const cm = window.configManager;
                await cm.bookmarkStore.loadAll();
                return (cm.allBookmarksData || []).some(
                    (bm) => String(bm?.url || '').trim().toLowerCase() === String(targetUrl).trim().toLowerCase()
                );
            },
            { targetUrl: uniqueUrl },
            { timeout: 15_000 }
        );

        await page.evaluate(async ({ targetUrl }) => {
            const cm = window.configManager;
            await cm.loadPageBookmarks(1);
            const categories = await fetch('/api/categories?page=1').then((r) => (r.ok ? r.json() : []));
            const targetCategory = (Array.isArray(categories) && categories[0]?.id) ? String(categories[0].id) : 'media';
            const idx = (cm.bookmarksData || []).findIndex(
                (bm) => String(bm?.url || '').trim().toLowerCase() === String(targetUrl).trim().toLowerCase()
            );
            if (idx < 0) {
                throw new Error('bookmark not found in config list');
            }
            cm.bookmarks.openDetailPanel(idx, cm.bookmarksData, cm.bookmarksPageCategories);
            const bm = cm.bookmarksData[idx];
            bm.category = targetCategory;
            const catEl = document.getElementById('detail-category');
            if (catEl) {
                catEl.value = targetCategory;
                catEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            cm.markDirty();
            await cm.saveChanges();
            return targetCategory;
        }, { targetUrl: uniqueUrl }).then(async (targetCategory) => {
            await page.goto(`/?_=${Date.now()}`);
            await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

            const mediaSelector = `.category[data-category-id="${targetCategory}"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`;
            await expect(page.locator(mediaSelector)).toBeVisible({ timeout: 10_000 });

            const uncategorizedSelector = `.category[data-category-id=""]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`;
            await expect(page.locator(uncategorizedSelector)).toHaveCount(0);
        });

        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });
});
