// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-helpers');

/*
 * The bookmark list as a workbench: filters down the left, rows in the
 * middle, the bookmark (or the selection) on the right.
 */

/**
 * The e2e fixture starts with exactly one page, so "the other page keeps its
 * count" has nothing to point at. Give it a second, with one bookmark on it,
 * entirely over the API — this is fixture setup, not the thing under test.
 */
async function ensureSecondPageWithBookmark(page) {
    const pages = await (await page.request.get('/api/pages')).json();
    let second = pages[1];
    if (!second) {
        const maxId = Math.max(0, ...pages.map((p) => Number(p.id) || 0));
        second = { id: maxId + 1, name: `Page ${maxId + 1}` };
        await page.request.post('/api/pages', {
            data: [...pages, second],
            headers: { 'X-NextDash-Token': WRITE_TOKEN },
        });
    }
    const existing = await (await page.request.get(`/api/bookmarks?page=${second.id}`)).json();
    if (!existing.length) {
        await page.request.post('/api/bookmarks/add', {
            data: { page: second.id, bookmark: { name: 'Rail fixture bookmark', url: 'https://example.com/rail-fixture' } },
            headers: { 'X-NextDash-Token': WRITE_TOKEN },
        });
    }
}

test.describe('the bookmarks workbench', () => {
    test('is laid out as rail, list and panel', async ({ page }) => {
        await openBookmarks(page);
        const rail = page.locator('#config-bm-rail');
        const main = page.locator('#config-bm-workbench .config-bm-main');
        const panel = page.locator('#config-bm-panel');
        await expect(rail).toBeVisible();
        await expect(panel).toBeVisible();
        await expect(rail.locator('#config-bm-search')).toBeVisible();

        const [r, m, p] = await Promise.all([rail, main, panel].map((l) => l.boundingBox()));
        expect(r && m && p, 'all three parts have a box').toBeTruthy();
        expect(r.x + r.width).toBeLessThanOrEqual(m.x + 1);
        expect(m.x + m.width).toBeLessThanOrEqual(p.x + 1);

        // Every group in full, in a narrow column: no scrollbar either way.
        const fit = await rail.evaluate((el) => ({
            vertical: el.scrollHeight <= el.clientHeight + 1,
            horizontal: el.scrollWidth <= el.clientWidth + 1,
        }));
        expect(fit).toEqual({ vertical: true, horizontal: true });
        expect(r.width).toBeLessThanOrEqual(180);
    });

    test('a page in the rail filters the list, and the other pages keep their counts', async ({ page }) => {
        await ensureSecondPageWithBookmark(page);
        await openBookmarks(page);
        const pages = page.locator('#config-bm-rail [data-bm-rail="page"]');
        expect(await pages.count(), 'the fixture has at least two pages').toBeGreaterThan(1);

        const second = pages.nth(1);
        const pageId = await second.getAttribute('data-value');
        const expected = Number(await second.locator('.config-bm-rail-count').innerText());
        const otherBefore = await pages.nth(0).locator('.config-bm-rail-count').innerText();

        await second.click();
        await expect(second).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.visibleBookmarks().length)).toBe(expected);
        const pageIds = await page.evaluate(() => [...new Set(
            window.dashboardInstance.config.visibleBookmarks().map((b) => String(b.pageId)))]);
        expect(pageIds).toEqual([pageId]);
        // Its own filter does not shrink the other entries.
        await expect(pages.nth(0).locator('.config-bm-rail-count')).toHaveText(otherBefore);

        // A token names it, and clears it.
        await page.click(`#config-bm-rail [data-bm-rail-clear="page"]`);
        await expect(second).toHaveAttribute('aria-pressed', 'false');
    });

    test('a view in the rail is the cleanup filter, and survives a reload', async ({ page }) => {
        await openBookmarks(page);
        await page.click('#config-bm-rail [data-bm-rail="cleanup"][data-value="untagged"]');
        await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('filter=untagged');
        const rows = await page.evaluate(() => window.dashboardInstance.config.visibleBookmarks()
            .every((b) => !(b.tags || []).some((t) => String(t).trim())));
        expect(rows).toBe(true);
        await page.reload();
        await page.waitForSelector('#config-bm-rail [data-bm-rail="cleanup"][data-value="untagged"][aria-pressed="true"]', { timeout: 15_000 });
    });

    test('two tags widen the list, and each is its own token', async ({ page }) => {
        await openBookmarks(page);
        const tags = page.locator('#config-bm-rail [data-bm-rail="tag"]');
        test.skip(await tags.count() < 2, 'fixture has fewer than two tags');
        const a = await tags.nth(0).getAttribute('data-value');
        const b = await tags.nth(1).getAttribute('data-value');
        await tags.nth(0).click();
        const one = await page.evaluate(() => window.dashboardInstance.config.visibleBookmarks().length);
        await page.locator(`#config-bm-rail [data-bm-rail="tag"][data-value="${b}"]`).click();
        const two = await page.evaluate(() => window.dashboardInstance.config.visibleBookmarks().length);
        expect(two).toBeGreaterThanOrEqual(one);
        await expect(page.locator(`[data-bm-rail-clear="tag:${a}"]`)).toBeVisible();
        await expect(page.locator(`[data-bm-rail-clear="tag:${b}"]`)).toBeVisible();
    });

    test('the health facet filters on what health knows', async ({ page }) => {
        await openBookmarks(page);
        // One known-broken, checked bookmark, as the health report would describe it.
        const url = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const b = c.dash.allBookmarks[0];
            b.checkStatus = true;
            window.HealthFacts.remember({ issues: [{ url: b.url, brokenSince: Date.now() - 1000 }] });
            c.repaintBookmarksList();
            return b.url;
        });
        const broken = page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]');
        await expect(broken.locator('.config-bm-rail-count')).toHaveText('1');
        await broken.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.visibleBookmarks().map((b) => b.url))).toEqual([url]);
        await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('health=broken');
    });

    test('a facet with nothing left is dimmed, not hidden', async ({ page }) => {
        await openBookmarks(page);
        await page.fill('#config-bm-search', 'zzzznothingmatches');
        const firstPage = page.locator('#config-bm-rail [data-bm-rail="page"]').first();
        await expect(firstPage).toHaveClass(/is-empty/);
        await expect(firstPage.locator('.config-bm-rail-count')).toHaveText('0');
    });

    test('a long category name is shown whole, wrapped rather than cut', async ({ page }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        const pages = await (await page.request.get('/api/pages')).json();
        const pid = pages[0].id;
        const catsBefore = await (await page.request.get(`/api/categories?page=${pid}`)).json();
        const bmsBefore = await (await page.request.get(`/api/bookmarks?page=${pid}`)).json();
        const name = 'selfhost-with-a-long-name';
        const id = 'rail-long-name-fixture';
        try {
            // Fixture setup over the API: a category and one bookmark in it.
            await page.request.post(`/api/categories?page=${pid}`, {
                data: [...catsBefore, { id, name, sortMode: 'order' }], headers,
            });
            await page.request.post(`/api/bookmarks?page=${pid}`, {
                data: [...bmsBefore, { name: 'Long name fixture', url: 'https://example.com/long-name', category: id }],
                headers,
            });
            await openBookmarks(page);
            const item = page.locator(`#config-bm-rail [data-bm-rail="category"][data-value$="${id}"]`);
            await expect(item).toHaveAttribute('title', new RegExp(`${name} \\(1\\)$`));
            const label = item.locator('.config-bm-rail-label');
            await expect(label).toHaveText(new RegExp(`${name}$`));
            expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
            const rail = page.locator('#config-bm-rail');
            const fit = await rail.evaluate((el) => ({
                vertical: el.scrollHeight <= el.clientHeight + 1,
                horizontal: el.scrollWidth <= el.clientWidth + 1,
            }));
            expect(fit).toEqual({ vertical: true, horizontal: true });
            expect((await rail.boundingBox()).width).toBeLessThanOrEqual(180);
        } finally {
            await page.request.post(`/api/bookmarks?page=${pid}`, { data: bmsBefore, headers });
            await page.request.post(`/api/categories?page=${pid}`, { data: catsBefore, headers });
        }
    });
});
