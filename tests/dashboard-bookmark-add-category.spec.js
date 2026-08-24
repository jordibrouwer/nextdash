// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

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

/** Earlier config-tab tests can replace the default category list; ensure a column exists. */
async function ensurePageCategory(page, categoryId, categoryName = categoryId) {
    await page.evaluate(async ({ id, name }) => {
        const pageId = Number(window.dashboardInstance?.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/categories?page=${pageId}`);
        let categories = res.ok ? await res.json() : [];
        if (!Array.isArray(categories)) {
            categories = [];
        }
        if (!categories.some((category) => category.id === id)) {
            categories.push({ id, name, icon: '' });
            await api(`/api/categories?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(categories),
            });
        }
    }, { id: categoryId, name: categoryName });
}

test.describe('dashboard bookmark add category placement', () => {
    test('new bookmark appears in assigned category column after modal save', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await ensurePageCategory(page, 'media', 'Media');
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showAddBookmarkButton = true;
            document.body.setAttribute('data-show-add-bookmark-button', 'true');
            d.setupDOM?.();
        });

        const uniqueUrl = `https://example.com/category-placement-${Date.now()}.test`;
        const uniqueName = `Category placement ${Date.now()}`;

        await page.locator('#quick-add-toolbar-btn').click();
        await page.waitForSelector('#bookmark-form-modal.show', { timeout: 10_000 });

        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await form.locator('input[type="url"]').fill(uniqueUrl);
        await form.locator('.bookmark-inline-input').first().fill(uniqueName);
        await form.locator('input[type="url"]').blur();

        await page.waitForFunction(() => {
            const selects = document.querySelectorAll('#bookmark-form-modal .bookmark-inline-select:not(.bookmark-inline-toggle-select)');
            const catSelect = selects[selects.length - 1];
            return catSelect && catSelect.options.length > 1;
        }, { timeout: 10_000 });

        await form.locator('.bookmark-inline-select:not(.bookmark-inline-toggle-select)').last().selectOption('media');
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });

        const mediaSelector = `.category[data-category-id="media"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`;
        await expect(page.locator(mediaSelector)).toBeVisible({ timeout: 10_000 });

        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });

    test('refreshAfterBookmarkAdded bypasses stale page cache', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await ensurePageCategory(page, 'media', 'Media');

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
        expect(result.afterCount).toBeGreaterThanOrEqual(result.beforeCount);

        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });

    test('stale page cache is bypassed when allBookmarks is newer', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await ensurePageCategory(page, 'media', 'Media');

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

    test('isPageBookmarksStale detects icon, note and pinned divergence', async ({ page }) => {
        // The Go-side content fingerprint (bookmarkContentFingerprint in
        // activity_bookmark.go) treats icon/note/pinned/checkStatus as content
        // alongside name/url/shortcut/category/tags. The JS fingerprint used to
        // omit all four, so a bookmark whose icon or pin state changed on
        // another page/tab would not be detected as stale here.
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
            const staleIcon = d.bookmarks.map((bm, index) => (
                index === 0 ? { ...bm, icon: '/data/icons/stale-probe.png' } : bm
            ));
            const staleNote = d.bookmarks.map((bm, index) => (
                index === 0 ? { ...bm, note: 'stale note probe' } : bm
            ));
            const stalePinned = d.bookmarks.map((bm, index) => (
                index === 0 ? { ...bm, pinned: !bm.pinned } : bm
            ));
            const freshAll = (d.allBookmarks || []).map((bm) => (
                String(bm?.url || '').trim().toLowerCase() === urlKey
                    && Number(bm.pageId) === pageId
                    ? { ...bm, icon: source.icon, note: source.note, pinned: source.pinned }
                    : bm
            ));

            d.allBookmarks = freshAll;
            return {
                ok: true,
                iconStale: d.data.isPageBookmarksStale(pageId, staleIcon),
                noteStale: d.data.isPageBookmarksStale(pageId, staleNote),
                pinnedStale: d.data.isPageBookmarksStale(pageId, stalePinned),
                fresh: d.data.isPageBookmarksStale(pageId, d.bookmarks),
            };
        });

        expect(result.ok).toBe(true);
        expect(result.iconStale).toBe(true);
        expect(result.noteStale).toBe(true);
        expect(result.pinnedStale).toBe(true);
        expect(result.fresh).toBe(false);
    });
});
