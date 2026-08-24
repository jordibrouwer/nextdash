// @ts-check
const { test, expect } = require('./fixtures');

test.describe('dashboard incremental DOM', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('full render seeds data-render-fp so noop patch skips row rebuild', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-url]')];
            if (!rows.length) {
                return { ok: false, reason: 'no-rows' };
            }
            const missingFp = rows.filter((row) => !row.getAttribute('data-render-fp'));
            if (missingFp.length) {
                return { ok: false, reason: 'missing-fp', missing: missingFp.length };
            }

            const row = rows[0];
            const htmlBefore = row.innerHTML;
            const patched = window.dashboardInstance.renderIncremental.tryRender({});
            return {
                ok: true,
                patched,
                unchanged: htmlBefore === row.innerHTML,
            };
        });

        expect(result.ok).toBe(true);
        expect(result.patched).toBe(true);
        expect(result.unchanged).toBe(true);
    });

    test('patches bookmark rows in place when structure is unchanged', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(() => {
            const row = document.querySelector(
                '#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link'
            );
            if (!row) {
                return { patched: false, reason: 'no-row' };
            }
            const urlKey = String(row.getAttribute('data-bookmark-url') || '').trim().toLowerCase();
            const d = window.dashboardInstance;
            const bookmark = (d.bookmarks || []).find(
                (bm) => String(bm?.url || '').trim().toLowerCase() === urlKey
            );
            if (!bookmark) {
                return { patched: false, reason: 'no-bookmark' };
            }
            const suffix = String(Date.now()).slice(-5);
            bookmark.name = `${bookmark.name || 'Bookmark'} ${suffix}`;
            const patched = d.renderIncremental.tryRender({});
            const text = row.isConnected
                ? (row.querySelector('.bookmark-text')?.textContent || '')
                : '';
            return {
                patched,
                nameUpdated: text.includes(suffix),
            };
        });

        expect(result.patched).toBe(true);
        expect(result.nameUpdated).toBe(true);
    });

    test('renderDashboard uses incremental path when structure is unchanged', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const usedIncremental = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const orig = d.renderIncremental.tryRender.bind(d.renderIncremental);
            let called = false;
            d.renderIncremental.tryRender = (opts) => {
                called = true;
                return orig(opts);
            };
            d.renderDashboard({ animate: false });
            return called;
        });

        expect(usedIncremental).toBe(true);
    });

    test('settings refresh reuses grid nodes', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const reused = await page.evaluate(() => {
            const row = document.querySelector(
                '#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link'
            );
            if (!row) {
                return false;
            }
            row.dataset.settingsProbe = '1';
            return window.dashboardInstance.renderIncremental.refreshSettingsDerivedDom()
                && Boolean(document.querySelector('[data-settings-probe="1"]'));
        });

        expect(reused).toBe(true);
    });

    test('keeps duplicate-url rows visible during incremental patch', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const normalize = (url) => String(url || '').trim().toLowerCase();
            const sourceIndex = (d.bookmarks || []).findIndex((bookmark) => normalize(bookmark?.url));
            if (sourceIndex < 0) {
                return { ok: false, reason: 'no-source-bookmark' };
            }
            const source = d.bookmarks[sourceIndex];
            const categoryId = String(source.category || '');
            const duplicate = {
                ...source,
                name: `${source.name || 'bookmark'} duplicate`,
                shortcut: '',
                pinned: false,
            };
            d.bookmarks.splice(sourceIndex + 1, 0, duplicate);
            d.renderDashboard({ incremental: false });

            const categoryList = document.querySelector(
                `#dashboard-layout .category[data-category-id="${CSS.escape(categoryId)}"] .bookmarks-list[data-category-id]`
            );
            if (!categoryList) {
                return { ok: false, reason: 'missing-category-list' };
            }

            const urlKey = normalize(source.url);
            const rowsBefore = [...categoryList.querySelectorAll('.bookmark-link[data-bookmark-url]')]
                .filter((row) => normalize(row.getAttribute('data-bookmark-url')) === urlKey);
            if (rowsBefore.length < 2) {
                return { ok: false, reason: 'missing-duplicate-before-patch', count: rowsBefore.length };
            }

            duplicate.name = `${duplicate.name} updated`;
            const patched = d.renderIncremental.tryRender({});

            const rowsAfter = [...categoryList.querySelectorAll('.bookmark-link[data-bookmark-url]')]
                .filter((row) => normalize(row.getAttribute('data-bookmark-url')) === urlKey);
            const uniqueNodes = new Set(rowsAfter).size;
            const hasUpdatedName = rowsAfter.some((row) => (
                row.querySelector('.bookmark-text')?.textContent?.includes('updated')
            ));

            return {
                ok: true,
                patched,
                rowsAfter: rowsAfter.length,
                uniqueNodes,
                hasUpdatedName,
            };
        });

        expect(result.ok).toBe(true);
        expect(result.patched).toBe(true);
        expect(result.rowsAfter).toBe(2);
        expect(result.uniqueNodes).toBe(2);
        expect(result.hasUpdatedName).toBe(true);
    });

    test('patch keeps data-bookmark-index on smart-collection rows', async ({ page }) => {
        await page.goto(`/?_=${Date.now()}`);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const smartRows = () => [...document.querySelectorAll(
                '#dashboard-layout .category[data-smart-collection="true"] .bookmark-link[data-bookmark-url]'
            )];
            if (smartRows().length === 0) {
                return { ok: false, reason: 'no-smart-rows' };
            }

            // Smart collections are built from d.allBookmarks, whose objects are
            // different instances than the ones in d.bookmarks. Identity matching
            // in the patch stripped data-bookmark-index from every such row, and
            // the Shift+M / Shift+D / Shift+T handlers then bailed out silently
            // because the row could not be resolved back to a bookmark.
            const distinctInstances = smartRows().every((row) => {
                const url = row.getAttribute('data-bookmark-url');
                const inPage = (d.bookmarks || []).find((b) => b.url === url);
                const inAll = (d.allBookmarks || []).find((b) => b.url === url);
                return !inPage || !inAll || inPage !== inAll;
            });

            const patched = d.renderIncremental.tryRender({});
            const after = smartRows();
            return {
                ok: true,
                patched,
                distinctInstances,
                total: after.length,
                missingIndex: after.filter((row) => !row.hasAttribute('data-bookmark-index')).length,
            };
        });

        test.skip(result.ok === false, `smart collections unavailable: ${result.reason}`);
        expect(result.patched).toBe(true);
        expect(result.total).toBeGreaterThan(0);
        // Precondition: the two arrays really do hold separate instances, so this
        // test would still catch a return to identity matching.
        expect(result.distinctInstances).toBe(true);
        // The whole point: every smart-collection row still resolves to a bookmark.
        expect(result.missingIndex).toBe(0);
    });
});
