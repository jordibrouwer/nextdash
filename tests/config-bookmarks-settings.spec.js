const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Bookmarks had no settings at all: the list made these choices on the
 * user's behalf and forgot them between visits.
 */
async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#config');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.waitForSelector('#config-bm-list', { timeout: 15_000 });
}

test.describe('Config → Bookmarks settings', () => {
    test('every declared field renders a control', async ({ page }) => {
        await openBookmarks(page);
        const missing = await page.evaluate(() => [
            'configBookmarksSort', 'configBookmarksPageSize', 'bookmarkDeleteConfirmFrom',
            'defaultMonitorIntervalMinutes', 'newBookmarkCheckMode', 'newBookmarkPinned',
            'bookmarkStaleDays', 'bulkFaviconConfirmFrom', 'bookmarkArchiveUrl',
        ].filter((f) => !document.querySelector(`[data-behavior-field="${f}"]`)));
        expect(missing).toEqual([]);
    });

    // The list reset to page order on every visit, unlike Health and the Inbox.
    test('the list opens on the stored sort', async ({ page }) => {
        await openBookmarks(page);
        const sort = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.dash.settings.configBookmarksSort = 'opens';
            c.bmSort = null;              // as it is on a fresh open
            return c.defaultBookmarksSort();
        });
        expect(sort).toBe('opens');
    });

    test('page size follows the setting, and falls back when it is nonsense', async ({ page }) => {
        await openBookmarks(page);
        const sizes = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const out = [];
            c.dash.settings.configBookmarksPageSize = 120;
            out.push(c.bmPageSize());
            c.dash.settings.configBookmarksPageSize = 3;      // below the floor
            out.push(c.bmPageSize());
            c.dash.settings.configBookmarksPageSize = 'nope';
            out.push(c.bmPageSize());
            return out;
        });
        expect(sizes).toEqual([120, 50, 50]);
    });

    // Undo and the 30-day trash already cover a misclick, so a cleanup pass
    // should not cost one Enter per row.
    test('the delete threshold decides whether to ask', async ({ page }) => {
        await openBookmarks(page);
        const asked = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.dash.settings.bookmarkDeleteConfirmFrom = 5;
            return { one: c.deleteNeedsConfirm(1), four: c.deleteNeedsConfirm(4), five: c.deleteNeedsConfirm(5) };
        });
        expect(asked).toEqual({ one: false, four: false, five: true });
    });

    test('the stale threshold drives the statistics', async ({ page }) => {
        await openBookmarks(page);
        const days = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.dash.settings.bookmarkStaleDays = 30;
            const thirty = c.bookmarkStaleDays();
            c.dash.settings.bookmarkStaleDays = 2;   // below the floor
            return [thirty, c.bookmarkStaleDays()];
        });
        expect(days).toEqual([30, 90]);
    });

    // The API is reachable without the browser, so the range lives server-side too.
    test('the server clamps values the controls could never produce', async ({ page }) => {
        await openBookmarks(page);
        const stored = await page.evaluate(async () => {
            const current = await (await fetch('/api/settings')).json();
            const post = (body) => (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            await post({
                ...current,
                configBookmarksSort: 'nonsense',
                configBookmarksPageSize: 99999,
                bookmarkStaleDays: 1,
                bookmarkArchiveUrl: 'javascript:alert(1)',
                defaultMonitorIntervalMinutes: 1,
            });
            const after = await (await fetch('/api/settings')).json();
            await post(current);
            return {
                sort: after.configBookmarksSort,
                size: after.configBookmarksPageSize,
                stale: after.bookmarkStaleDays,
                archive: after.bookmarkArchiveUrl,
                interval: after.defaultMonitorIntervalMinutes,
            };
        });
        expect(stored.sort).toBe('page');
        expect(stored.size).toBe(500);
        expect(stored.stale).toBe(7);
        // Never a javascript: URL — this string is handed to window.open.
        expect(stored.archive).toBe('https://web.archive.org/web/*/{url}');
        expect(stored.interval).toBe(5);
    });

    test('the archive template is used instead of a hardcoded Wayback URL', async ({ page }) => {
        await openBookmarks(page);
        const opened = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.dash.settings.bookmarkArchiveUrl = 'https://archive.ph/newest/{url}';
            let seen = '';
            const real = window.open;
            window.open = (u) => { seen = u; return null; };
            c.openBookmarkArchive({ url: 'https://example.com/a b' });
            window.open = real;
            return seen;
        });
        expect(opened).toContain('archive.ph/newest/');
        expect(opened).toContain(encodeURIComponent('https://example.com/a b'));
    });
});
