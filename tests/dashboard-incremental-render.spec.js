// @ts-check
const { test, expect } = require('@playwright/test');

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
});
