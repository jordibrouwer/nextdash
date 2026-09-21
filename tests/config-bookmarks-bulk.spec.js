// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks, captureRowWrites } = require('./config-bookmarks-helpers');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

async function capturePosts(page) {
    return captureRowWrites(page);
}

/** Tick the first `n` rows with the keyboard. */
async function tickRows(page, n) {
    await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < n; i += 1) {
        await page.keyboard.press('j');
        await page.keyboard.press('x');
    }
    return page.evaluate(() => [...window.dashboardInstance.config.bmSelected]);
}

test.describe('the bulk form', () => {
    test('two ticked rows turn the panel into one form for both', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'bulk');
        await expect(panel).toContainText('2');
        await expect(panel.locator('[data-bm-bulk-action="apply"]')).toBeDisabled();
    });

    test('fields the selection disagrees on read mixed', async ({ page }) => {
        await openBookmarks(page);
        const keys = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const all = c.dash.allBookmarks;
            const a = all[0];
            const b = all.find((x) => x.pinned !== a.pinned) || all[1];
            b.pinned = !a.pinned;
            return [c.bookmarkKey(a), c.bookmarkKey(b)];
        });
        await page.evaluate((ks) => {
            const c = window.dashboardInstance.config;
            ks.forEach((k) => c.bmSelected.add(k));
            c.afterSelectionChange();
        }, keys);
        await expect(page.locator('#config-bm-panel .config-bm-bulk-pinned')).toContainText(/mixed|1 of 2/i);
    });

    test('adding a tag changes only the tags of the ticked rows', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const keys = await tickRows(page, 2);
        const before = await page.evaluate((ks) => ks.map((k) => {
            const b = window.dashboardInstance.config.findBookmarkByKey(k);
            return { url: b.url, pinned: Boolean(b.pinned), name: b.name };
        }), keys);

        await page.fill('#config-bm-panel [data-bm-bulk-field="tags"]', 'bulkadded');
        await page.click('#config-bm-panel [data-bm-bulk-action="apply"]');

        await expect.poll(() => posts.length).toBeGreaterThan(0);
        const written = posts.flat();
        for (const b of before) {
            const row = written.find((w) => w.url === b.url);
            expect(row, `${b.url} was written`).toBeTruthy();
            expect(row.tags).toContain('bulkadded');
            // Only what changed is sent: the pin and the name are not.
            expect('pinned' in row).toBe(false);
            expect('name' in row).toBe(false);
        }
        const untouched = written.filter((w) => !before.some((b) => b.url === w.url));
        expect(untouched.every((w) => !(w.tags || []).includes('bulkadded'))).toBe(true);
    });

    test('pin all pins every ticked row', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const keys = await tickRows(page, 2);
        const urls = await page.evaluate((ks) => ks.map((k) =>
            window.dashboardInstance.config.findBookmarkByKey(k).url), keys);
        await page.click('#config-bm-panel [data-bm-bulk-pin="true"]');
        await expect(page.locator('#config-bm-panel [data-bm-bulk-pin="true"]')).toHaveAttribute('aria-pressed', 'true');
        await page.click('#config-bm-panel [data-bm-bulk-action="apply"]');
        await expect.poll(() => posts.length).toBeGreaterThan(0);
        for (const url of urls) {
            expect(posts.flat().find((w) => w.url === url).pinned).toBe(true);
        }
    });

    test('the form says how many ticked rows the filter hides', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        await page.fill('#config-bm-search', 'zzzznothingmatches');
        await expect(page.locator('#config-bm-panel .config-bm-bulk-hidden')).toContainText('2');
    });

    test('Tag selected in the right-click menu goes to the tags field', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        await page.locator('#config-bm-list .config-bm-row.is-checked').first().click({ button: 'right' });
        await page.getByText(/Tag 2 selected/).click();
        await expect(page.locator('#config-bm-panel [data-bm-bulk-field="tags"]')).toBeFocused();
    });

    test('the bulk bar is gone', async ({ page }) => {
        await openBookmarks(page);
        await tickRows(page, 2);
        await expect(page.locator('.config-bulk-bar, #config-bm-bulk')).toHaveCount(0);
    });

    test('Escape clears the selection first, then the filters', async ({ page }) => {
        await openBookmarks(page);
        await page.fill('#config-bm-search', 'a');
        await page.locator('#config-bm-search').blur();
        await tickRows(page, 2);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(0);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmQuery)).toBe('');
        await expect(page.locator('#config-bm-list')).toBeVisible();
    });

    test('a move with No category takes the category away', async ({ page }) => {
        const posts = [];
        await page.route('**/api/bookmarks/move', async (route) => {
            posts.push(JSON.parse(route.request().postData() || '{}'));
            const body = posts[posts.length - 1];
            return route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ moved: (body.items || []).map((i) => ({ fromPage: i.pageId, url: i.url, category: 'x' })), skipped: [] }),
            });
        });
        await openBookmarks(page);
        await page.evaluate(() => window.dashboardInstance.config.addPage());
        await page.waitForFunction(() => window.dashboardInstance.pages.length > 1, null, { timeout: 15_000 });
        const target = await page.evaluate(() =>
            String(window.dashboardInstance.pages[window.dashboardInstance.pages.length - 1].id));
        try {
            await page.click('[data-config-section="bookmarks"]');
            // Two categorised rows from the list on screen.
            const rows = page.locator('#config-bm-list .config-bm-row');
            await expect(rows.first()).toBeVisible();
            const keys = await page.evaluate(() => {
                const c = window.dashboardInstance.config;
                return [...document.querySelectorAll('#config-bm-list .config-bm-row')]
                    .map((r) => r.getAttribute('data-bm-key'))
                    .filter((k) => c.findBookmarkByKey(k)?.category)
                    .slice(0, 2);
            });
            test.skip(keys.length < 2, 'needs two categorised bookmarks');
            for (const k of keys) await page.locator(`[data-bm-tick="${k}"]`).check();
            const urls = await page.evaluate((ks) => ks.map((k) =>
                window.dashboardInstance.config.findBookmarkByKey(k).url), keys);
            const panel = page.locator('#config-bm-panel');
            await expect(panel).toHaveAttribute('data-bm-panel-mode', 'bulk');
            await panel.locator('[data-bm-bulk-field="page"]').selectOption(target);
            await panel.locator('[data-bm-bulk-field="category"]').selectOption('');
            await panel.locator('[data-bm-bulk-action="apply"]').click();
            // One move request: to the target, with the category taken away.
            const landed = () => posts.filter((p) => String(p.toPage) === target)
                .flatMap((p) => (p.items || []).map((i) => ({ ...i, category: p.category })))
                .filter((w) => urls.includes(w.url));
            await expect.poll(() => landed().length).toBeGreaterThanOrEqual(urls.length);
            for (const row of landed()) expect(row.category).toBe('');
        } finally {
            await page.unroute('**/api/bookmarks/move');
            await page.evaluate(async (p) => {
                const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
                await api(`/api/pages/${p}`, { method: 'DELETE' });
            }, target);
        }
    });
});
