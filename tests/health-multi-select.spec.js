// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, prepareDashboardInteraction, WRITE_TOKEN } = require('./e2e-helpers');

const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Multi-select and bulk actions in the Health view.
 *
 * Health lists exactly what a cleanup starts from — broken, duplicate, stale —
 * and used to make you fix them one row at a time. Bulk delete in particular
 * could not just loop the single-row endpoint: that deletes by position, and
 * every delete shifts the rows after it.
 */

/**
 * The favicon batch prefetch overlay covers the whole viewport at z-index 12000
 * while a fresh install seeds its icons, so every click lands on it instead of
 * the row underneath. Unrelated to this feature, but it has to be out of the way
 * before anything here can be clicked.
 */
async function dismissFaviconOverlay(page) {
    await page.evaluate(() => {
        const overlay = document.getElementById('favicon-prefetch-overlay');
        if (overlay) overlay.hidden = true;
    });
}

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);
    await dismissFaviconOverlay(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.health.openHealthView();
        await d.health.loadAndRender({ refresh: true });
    });
    await dismissFaviconOverlay(page);
    // "All", not the default "Broken": the seeded test data has no reachable
    // site to fail, so the broken list is legitimately empty here. Clicked
    // rather than assigned — setting .filter by hand skips render().
    await page.locator('[data-health-filter="all"]').click();
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 20_000 });
}

/** Seeds bookmarks and returns their urls, newest report loaded. */
async function seedAndOpen(page, count, tag) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);

    const stamp = Date.now();
    const urls = Array.from({ length: count }, (_, i) => `https://${tag}-${i}-${stamp}.invalid`);
    await page.evaluate(async (list) => {
        const d = window.dashboardInstance;
        const pid = Number(d.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const url of list) {
            await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: pid,
                    bookmark: { name: url, url, category: '', checkStatus: true },
                }),
            });
        }
    }, urls);

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.health.openHealthView();
        await d.health.loadAndRender({ refresh: true });
    });
    await dismissFaviconOverlay(page);
    // See openHealth: the seeded urls are unreachable but not yet checked, so
    // "All" is the filter that actually lists them.
    await page.locator('[data-health-filter="all"]').click();
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 20_000 });
    return urls;
}

/** Ticks the rows whose issue url is in `urls`, through the module. */
async function selectByUrls(page, urls) {
    return page.evaluate((list) => {
        const h = window.dashboardInstance.health;
        const issues = h.getFilteredIssues().filter((i) => list.includes(String(i.url).trim()));
        issues.forEach((i) => h.multiSelect.toggle(h.issueKey(i)));
        return issues.length;
    }, urls);
}

async function pageBookmarkUrls(page, pageId) {
    return page.evaluate(async (pid) => {
        const res = await fetch(`/api/bookmarks?page=${pid}`);
        return res.ok ? (await res.json()).map((b) => String(b.url).trim()) : [];
    }, pageId);
}

test.describe('health view multi-select', () => {
    // The view persists its filter to localStorage, and these tests deliberately
    // switch it. Left behind, the next spec opens Health on "Broken" instead of
    // whatever it set up — so the filter is put back after every test here.
    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            try {
                const key = window.DashboardHealth?.STATE_KEY;
                if (key) localStorage.removeItem(key);
            } catch { /* private mode */ }
        }).catch(() => { /* page already closed */ });
    });

    test('every row carries a select box', async ({ page }) => {
        await openHealth(page);
        const row = page.locator('.health-view-item').first();
        await expect(row.locator('.health-view-select-box')).toHaveCount(1);
    });

    test('no toolbar until something is selected', async ({ page }) => {
        await openHealth(page);
        await expect(page.locator('#health-bulk-bar .health-bulk-bar')).toHaveCount(0);
    });

    test('ticking a row shows the toolbar with a count', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        const toolbar = page.locator('#health-bulk-bar .health-bulk-bar');
        await expect(toolbar).toBeVisible();
        await expect(toolbar.locator('.config-bulk-count')).toContainText('1');
    });

    test('the toolbar offers re-check, check mode, open, copy, delete and clear', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        const toolbar = page.locator('#health-bulk-bar .health-bulk-bar');
        for (const action of ['recheck', 'checkmode', 'open', 'copy', 'delete', 'clear']) {
            await expect(toolbar.locator(`[data-bulk="${action}"]`)).toHaveCount(1);
        }
    });

    test('Clear drops the selection and the toolbar', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        await page.locator('#health-bulk-bar .health-bulk-bar [data-bulk="clear"]').click();
        await expect(page.locator('#health-bulk-bar .health-bulk-bar')).toHaveCount(0);
    });

    test('x ticks the cursor row and moves on, X takes the whole filter', async ({ page }) => {
        await openHealth(page);
        await page.evaluate(() => {
            const h = window.dashboardInstance.health;
            const first = h.getFilteredIssues()[0];
            h.selectedKey = h.issueKey(first);
        });
        await page.keyboard.press('x');
        await expect.poll(async () => page.evaluate(
            () => window.dashboardInstance.health.multiSelect.selected.size
        )).toBe(1);
        // The cursor advanced, so a second x ticks a different row.
        await page.keyboard.press('x');
        await expect.poll(async () => page.evaluate(
            () => window.dashboardInstance.health.multiSelect.selected.size
        )).toBe(2);

        await page.keyboard.press('Shift+X');
        const [selected, visible] = await page.evaluate(() => {
            const h = window.dashboardInstance.health;
            return [h.multiSelect.selected.size, h.getFilteredIssues().length];
        });
        expect(selected).toBe(visible);
    });

    test('Escape clears the selection instead of closing Health', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        await page.keyboard.press('Escape');
        await expect(page.locator('#health-bulk-bar .health-bulk-bar')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout.health-layout')).toHaveCount(1);
    });

    test('the selection survives a re-render', async ({ page }) => {
        await openHealth(page);
        const key = await page.evaluate(() => {
            const h = window.dashboardInstance.health;
            const k = h.issueKey(h.getFilteredIssues()[0]);
            h.multiSelect.toggle(k);
            return k;
        });
        await page.evaluate(() => window.dashboardInstance.health.renderFeed?.()
            ?? window.dashboardInstance.health.applyKeyboardSelection());
        const stillTicked = await page.evaluate((k) => {
            const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(k)}"]`);
            return Boolean(row?.classList.contains('is-multi-selected'));
        }, key);
        expect(stillTicked).toBe(true);
    });

    test('bulk delete removes exactly the ticked rows', async ({ page }) => {
        const urls = await seedAndOpen(page, 3, 'hms-del');
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId) || 1);

        // Tick two of the three.
        const picked = urls.slice(0, 2);
        const n = await selectByUrls(page, picked);
        expect(n).toBe(2);

        await page.evaluate(() => { window.dashboardInstance.health.confirm = async () => true; });
        await page.evaluate(() => window.dashboardInstance.health.multiSelect.bulkDelete());

        await expect.poll(async () => {
            const stored = await pageBookmarkUrls(page, pageId);
            return picked.filter((u) => stored.includes(u)).length;
        }, { timeout: 15_000 }).toBe(0);

        // The third was never ticked and must survive.
        const stored = await pageBookmarkUrls(page, pageId);
        expect(stored).toContain(urls[2]);

        // Clean up.
        await page.evaluate(async ({ pid, keep }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/bookmarks?page=${pid}`);
            const list = await res.json();
            await api(`/api/bookmarks?page=${pid}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list.filter((b) => String(b.url).trim() !== keep)),
            });
        }, { pid: pageId, keep: urls[2] });
    });

    test('bulk-deleted bookmarks land in the trash', async ({ page }) => {
        await page.request.delete('/api/trash', { data: { all: true }, headers: writeHeaders });
        const urls = await seedAndOpen(page, 2, 'hms-trash');

        await selectByUrls(page, urls);
        await page.evaluate(() => { window.dashboardInstance.health.confirm = async () => true; });
        await page.evaluate(() => window.dashboardInstance.health.multiSelect.bulkDelete());

        await expect.poll(async () => {
            const res = await page.request.get('/api/trash');
            const items = (await res.json()).items || [];
            return urls.filter((u) => items.some((i) => String(i.bookmark?.url).trim() === u)).length;
        }, { timeout: 15_000 }).toBe(2);
    });

    test('bulk delete clears the toolbar and the ticks', async ({ page }) => {
        const urls = await seedAndOpen(page, 2, 'hms-clear');
        await selectByUrls(page, urls);
        await expect(page.locator('#health-bulk-bar .health-bulk-bar')).toBeVisible();

        await page.evaluate(() => { window.dashboardInstance.health.confirm = async () => true; });
        await page.evaluate(() => window.dashboardInstance.health.multiSelect.bulkDelete());

        await expect(page.locator('#health-bulk-bar .health-bulk-bar')).toHaveCount(0, { timeout: 15_000 });
    });

    test('a cancelled confirm deletes nothing', async ({ page }) => {
        const urls = await seedAndOpen(page, 2, 'hms-cancel');
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId) || 1);
        await selectByUrls(page, urls);

        await page.evaluate(() => { window.dashboardInstance.health.confirm = async () => false; });
        await page.evaluate(() => window.dashboardInstance.health.multiSelect.bulkDelete());

        const stored = await pageBookmarkUrls(page, pageId);
        expect(urls.every((u) => stored.includes(u))).toBe(true);
        // Still selected, so the user can confirm on a second attempt.
        await expect(page.locator('#health-bulk-bar .health-bulk-bar')).toBeVisible();
    });

    test('bulk copy puts every selected url on the clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const urls = await seedAndOpen(page, 2, 'hms-copy');
        await selectByUrls(page, urls);
        await page.locator('#health-bulk-bar .health-bulk-bar [data-bulk="copy"]').click();

        const text = await page.evaluate(() => navigator.clipboard.readText());
        urls.forEach((u) => expect(text).toContain(u));
    });

    test('check mode is a select beside its Apply button, as in config', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        const select = page.locator('#health-bulk-mode');
        await expect(select).toBeVisible();
        await expect(select.locator('option')).toHaveCount(3);
        // Same control grammar as Config → Bookmarks: the select carries the
        // value and the button beside it applies it.
        await expect(page.locator('#health-bulk-bar [data-bulk="checkmode"]')).toBeVisible();
    });

    test('ticks survive a filter change instead of being discarded', async ({ page }) => {
        await openHealth(page);
        await page.evaluate(() => {
            const h = window.dashboardInstance.health;
            h.multiSelect.selectAllVisible();
        });
        const before = await page.evaluate(
            () => window.dashboardInstance.health.multiSelect.selected.size
        );
        expect(before).toBeGreaterThan(0);

        // Switch to a filter that shows none of them.
        // Through the filter pill, the way a user switches — setting .filter by
        // hand skips render() and leaves the list showing the old filter.
        await page.locator('[data-health-filter="broken"]').click();
        const after = await page.evaluate(
            () => window.dashboardInstance.health.multiSelect.selected.size
        );
        expect(after).toBe(before);
    });

    test('the bar warns when part of the selection is hidden by the filter', async ({ page }) => {
        await openHealth(page);
        await page.evaluate(() => window.dashboardInstance.health.multiSelect.selectAllVisible());
        // Through the filter pill, the way a user switches — setting .filter by
        // hand skips render() and leaves the list showing the old filter.
        await page.locator('[data-health-filter="broken"]').click();

        const notice = page.locator('#health-bulk-bar .config-bulk-offscreen');
        await expect(notice).toBeVisible();
        await expect(notice.locator('.config-bulk-offscreen-text')).toContainText('not shown');
    });

    test('Select only these drops the ticks the filter hides', async ({ page }) => {
        await openHealth(page);
        await page.evaluate(() => window.dashboardInstance.health.multiSelect.selectAllVisible());
        // Through the filter pill, the way a user switches — setting .filter by
        // hand skips render() and leaves the list showing the old filter.
        await page.locator('[data-health-filter="broken"]').click();

        await page.locator('#health-bulk-bar [data-bulk="keep-visible"]').click();
        const [size, visible] = await page.evaluate(() => {
            const h = window.dashboardInstance.health;
            return [h.multiSelect.selected.size, h.getFilteredIssues().length];
        });
        expect(size).toBe(visible);
    });

    test('no warning while the whole selection is on screen', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        await expect(page.locator('#health-bulk-bar .config-bulk-offscreen')).toHaveCount(0);
    });

    test('the bar reuses the config bulk-bar shell and sits above the feed', async ({ page }) => {
        await openHealth(page);
        await page.locator('.health-view-item').first().locator('.health-view-select-box').click({ force: true });
        const bar = page.locator('#health-bulk-bar .config-bulk-bar');
        await expect(bar).toBeVisible();
        // Above the list, not floating over it — the config bar's placement.
        const order = await page.evaluate(() => {
            const host = document.getElementById('health-bulk-bar');
            const feed = document.querySelector('.health-view-feed');
            if (!host || !feed) return null;
            return host.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
        });
        expect(order).toBe('before');
    });

    test('bulk check mode applies to every selected row', async ({ page }) => {
        const urls = await seedAndOpen(page, 2, 'hms-mode');
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId) || 1);
        await selectByUrls(page, urls);

        await page.evaluate(() => window.dashboardInstance.health.multiSelect.bulkSetCheckMode('monitor'));

        await expect.poll(async () => {
            const stored = await page.evaluate(async (pid) => {
                const res = await fetch(`/api/bookmarks?page=${pid}`);
                return res.ok ? await res.json() : [];
            }, pageId);
            return urls.filter((u) => stored.some(
                (b) => String(b.url).trim() === u && b.monitor === true
            )).length;
        }, { timeout: 15_000 }).toBe(2);
    });
});
