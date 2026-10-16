// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Fixes from a read-through of search.js and dashboard-inbox.js.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function openSearch(page) {
    await page.keyboard.press('Shift+Period');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 10_000 });
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent != null);
}

const query = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);

test.describe('search', () => {
    /*
     * The click had its own copy of the Enter dispatch, with no branch for the
     * mode hint: it fell through to openBookmark(undefined), which closed the
     * panel and threw when the timer read bookmark.url.
     */
    test('clicking the "press / to search names" hint runs the name search', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: {
                    name: 'Qwertyprobe notes', url: 'https://qwertyprobe.example/', category: '',
                } }),
            });
            await d.loadAllBookmarks?.();
        });
        await openSearch(page);
        await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.settings.enableFuzzySuggestions = false;
            sc.interleaveMode = false;
        });
        await page.keyboard.type('qwertyprobe', { delay: 10 });

        const hint = page.locator('#search-matches .search-match', { hasText: 'Press / to search names' });
        await expect(hint).toBeVisible({ timeout: 10_000 });
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await hint.click();

        await expect.poll(() => query(page)).toBe('/qwertyprobe');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        await page.waitForTimeout(250);
        expect(errors).toEqual([]);
    });

    /*
     * setScope took one character off the front, so `tag:` travelled as if it
     * had been typed: Shift+Tab from the tags opened finders on `?tag:`.
     */
    test('Shift+Tab from the tags lands on an empty finder line', async ({ page }) => {
        await dashboard(page);
        await openSearch(page);
        await page.evaluate(() => window.dashboardInstance.searchComponent.openInTagMode());
        await expect.poll(() => query(page)).toBe('tag:');

        await page.keyboard.press('Shift+Tab');

        await expect.poll(() => query(page)).toMatch(/^\?/);
        expect(await query(page)).not.toContain('tag:');
    });

    /*
     * The bookmarks heading counted rows: group headings, "N more" and filter
     * completions included, and the results inside a closed group left out.
     */
    test('the bookmarks heading counts results, not rows', async ({ page }) => {
        await dashboard(page);
        await openSearch(page);
        const count = await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.currentQuery = 'zzcount';
            const bookmark = (i) => ({ type: 'bookmark', shortcut: '', bookmark: { name: `B${i}`, url: `https://b${i}.example/` } });
            const rows = [
                { type: 'command-group-header', groupId: 'search_strong', count: 4, expanded: true },
                ...[0, 1, 2, 3].map(bookmark),
                { type: 'command-group-header', groupId: 'search_contains', count: 20, expanded: true },
                ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(bookmark),
                { type: 'group-more', groupId: 'search_contains', count: 8 },
                { type: 'command-group-header', groupId: 'search_elsewhere', count: 5, expanded: false },
            ];
            const out = sc._composeScopedSections(rows);
            return out.find((row) => row.type === 'scope-section' && row.scope === 'bookmarks')?.count;
        });
        expect(count).toBe(4 + 20 + 5);
    });

    test('status completions offer untagged and unnoted', async ({ page }) => {
        await dashboard(page);
        await openSearch(page);
        const completions = await page.evaluate(() => window.dashboardInstance.searchComponent
            .getFilterAutocompleteMatches('status:un').map((m) => m.completion.trim()));
        expect(completions).toEqual(expect.arrayContaining(['status:untagged', 'status:unnoted']));
    });

    /*
     * A shortcut that opens as it is typed is not a search, and was filling the
     * recent searches with "gh".
     */
    test('a shortcut that opens as it is typed stays out of the search history', async ({ page, context }) => {
        await dashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: {
                    name: 'Shortcut probe', url: 'https://shortcut-probe.example/', category: '', shortcut: 'qzx',
                } }),
            });
            await d.loadAllBookmarks?.();
        });
        await openSearch(page);
        await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.settings.shortcutOpenMode = 'instant';
            sc.settings.openInNewTab = true;
            sc.searchHistory = [];
        });
        await context.route('https://shortcut-probe.example/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
        const popup = context.waitForEvent('page');
        await page.keyboard.type('qzx', { delay: 20 });
        await (await popup).close();

        const history = await page.evaluate(() => window.dashboardInstance.searchComponent.searchHistory);
        expect(history).not.toContain('qzx');
        expect(history).not.toContain('QZX');
    });
});
