// @ts-check
const fs = require('fs');
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const { openConfigBookmarks, bmRow } = require('./helpers/config-bookmarks');

/**
 * The dashboard's selection bar and the Bookmarks view's act on the same
 * bookmarks, and draw their buttons from one list (shared/bulk-actions.js).
 * These hold both bars to that list, and drive the actions the dashboard
 * gained from it through their buttons.
 */

async function seedAndSelect(page, host) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (h) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const slug of ['a', 'b']) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, allowDuplicate: true,
                    bookmark: { category: '', createdAt: Date.now(), name: `Bulk ${slug} ${h}`, url: `https://${h}/${slug}`, tags: [] } }),
            });
        }
    }, host);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const size = await page.evaluate((h) => {
        const d = window.dashboardInstance;
        const ms = d.multiSelect;
        ms.clear();
        d.bookmarks.filter((b) => String(b.url).includes(h))
            .forEach((b) => ms.selected.add(ms.keyFor(b, d.currentPageId)));
        ms.sync();
        return ms.selected.size;
    }, host);
    expect(size).toBe(2);
    return page.locator('.multi-select-toolbar');
}

const offered = (page, surface) => page.evaluate((s) => window.BulkActions.forSurface(s)
    .map((a) => ({ id: a.id, label: a.label })), surface);

test('the dashboard bar offers every dashboard action in the list, in its order', async ({ page }) => {
    const bar = await seedAndSelect(page, `parity-${Date.now()}.example`);
    const want = await offered(page, 'dashboard');
    const have = await bar.locator('[data-bulk-action]').evaluateAll((els) => els.map((el) => el.dataset.bulkAction));
    expect(have).toEqual(want.map((a) => a.id));
    await expect(bar.locator('[data-bulk-action="delete"]')).toHaveText('Delete 2');
    await expect(bar.locator('[data-bulk-action="clear"]')).toHaveText('Clear selection');
});

test('the Bookmarks view bar offers its actions in the same order and words', async ({ page }) => {
    await openConfigBookmarks(page);
    for (const n of [1, 2]) {
        await bmRow(page, n).hover();
        await bmRow(page, n).locator('.config-bm-tick').check();
    }
    const want = (await offered(page, 'bookmarks')).map((a) => a.id);
    const bar = page.locator('[data-bm-selbar]');
    const have = await bar.locator('[data-bulk-action]').evaluateAll((els) => els.map((el) => el.dataset.bulkAction));
    // Re-check and Mute only appear for rows in the health report.
    expect(have).toEqual(want.filter((id) => have.includes(id) || !['recheck', 'mute'].includes(id)));
    for (const id of ['open', 'copy', 'pin']) expect(have).toContain(id);
    const dash = await page.evaluate(() => window.BulkActions.label('copy', null));
    await expect(bar.locator('[data-bulk-action="copy"]')).toHaveText(dash);
});

test('Export CSV on the dashboard downloads the ticked rows', async ({ page }) => {
    const host = `export-${Date.now()}.example`;
    const bar = await seedAndSelect(page, host);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        bar.locator('[data-bulk-action="export"]').click(),
    ]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    expect(csv).toContain(`https://${host}/a`);
    expect(csv).toContain(`https://${host}/b`);
    expect(csv.trim().split(/\r\n/)).toHaveLength(3);
});

test('Fetch previews on the dashboard stores a preview on each ticked row', async ({ page }) => {
    const host = `preview-${Date.now()}.example`;
    await page.route('**/api/bookmark-preview?*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Fetched title', description: 'About it' }),
    }));
    const bar = await seedAndSelect(page, host);
    await bar.locator('[data-bulk-action="previews"]').click();
    await expect.poll(() => page.evaluate(async (h) => {
        const res = await fetch(`/api/bookmarks?page=${window.dashboardInstance.currentPageId}`);
        const rows = await res.json();
        return rows.filter((b) => String(b.url).includes(h)).map((b) => b.previewTitle);
    }, host), { timeout: 15_000 }).toEqual(['Fetched title', 'Fetched title']);
});

test('Re-check on the dashboard probes each ticked row once', async ({ page }) => {
    const host = `recheck-${Date.now()}.example`;
    const pinged = [];
    await page.route('**/api/ping?*', (route) => {
        pinged.push(new URL(route.request().url()).searchParams.get('url'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'online', ping: 5 }) });
    });
    const bar = await seedAndSelect(page, host);
    await bar.locator('[data-bulk-action="recheck"]').click();
    await expect.poll(() => pinged.filter((u) => String(u).includes(host)).sort(), { timeout: 15_000 })
        .toEqual([`https://${host}/a`, `https://${host}/b`]);
});

test('Copy links in the Bookmarks view puts the ticked addresses on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openConfigBookmarks(page);
    for (const n of [1, 2]) {
        await bmRow(page, n).hover();
        await bmRow(page, n).locator('.config-bm-tick').check();
    }
    const urls = await page.evaluate(() => {
        const c = window.dashboardInstance.config.instance;
        return c.selectedBookmarks().map((b) => b.url);
    });
    await page.locator('[data-bm-selbar] [data-bulk-action="copy"]').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(urls.join('\n'));
});
