// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('data revision API', () => {
    test('revision changes after bookmark write and dashboard picks it up', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const uniqueUrl = `https://example.com/revision-${Date.now()}.test`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);

        const result = await page.evaluate(async ({ targetPageId, targetUrl }) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const before = await fetch('/api/data-revision', { cache: 'no-store' }).then((r) => r.json());

            const addRes = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: targetPageId,
                    bookmark: {
                        name: 'Revision test',
                        url: targetUrl,
                        category: 'media',
                        tags: [],
                        createdAt: Date.now(),
                    },
                }),
            });
            if (!addRes.ok) {
                return { ok: false, step: 'add' };
            }

            const after = await fetch('/api/data-revision', { cache: 'no-store' }).then((r) => r.json());
            d._serverDataRevision = String(before.revision || '');
            const changed = await d.data.syncDataRevision({ invalidateOnChange: true });
            const cacheCleared = !d._pageDataCache?.has(Number(targetPageId));

            return {
                ok: true,
                revisionChanged: before.revision !== after.revision,
                syncDetectedChange: changed,
                cacheCleared,
            };
        }, { targetPageId: pageId, targetUrl: uniqueUrl });

        expect(result.ok).toBe(true);
        expect(result.revisionChanged).toBe(true);
        expect(result.syncDetectedChange).toBe(true);
        expect(result.cacheCleared).toBe(true);

        await page.evaluate(async ({ targetPageId, targetUrl }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/bookmarks?page=${targetPageId}`);
            const list = await res.json();
            const bookmark = (list || []).find(
                (bm) => String(bm?.url || '').trim().toLowerCase() === targetUrl.toLowerCase()
            );
            if (!bookmark) return;
            await api('/api/bookmarks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: targetPageId, bookmark }),
            });
        }, { targetPageId: pageId, targetUrl: uniqueUrl });
    });
});
