// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * When the health report lands on an open Bookmarks view, the rail counts
 * every facet again and the rows take their scores. Both grew with the
 * library in a way they had no need to: every count turned each address into
 * its health key with `new URL`, again for every facet; and every row looked
 * itself up by walking the whole library. Three thousand bookmarks made that
 * the better part of half a second, after the list was already on screen.
 */
async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
}

test('an address becomes its health key once, however often it is asked', async ({ page }) => {
    await openBookmarks(page);
    const parses = await page.evaluate(() => {
        const utils = window.BookmarkUrlUtils;
        const urls = Array.from({ length: 500 }, (_, i) => `https://host-${i}.example.org/path/${i}/`);
        const Real = window.URL;
        let count = 0;
        window.URL = class extends Real { constructor(...a) { count += 1; super(...a); } };
        try {
            // Ten facets asking about the same five hundred addresses.
            for (let round = 0; round < 10; round += 1) urls.forEach((u) => utils.canonicalBookmarkURLKey(u));
        } finally {
            window.URL = Real;
        }
        return count;
    });
    expect(parses).toBeLessThanOrEqual(500);
});

test('the key for an address is the same, cached or not', async ({ page }) => {
    await openBookmarks(page);
    const keys = await page.evaluate(() => {
        const k = window.BookmarkUrlUtils.canonicalBookmarkURLKey;
        const inputs = ['HTTPS://Example.COM/', 'example.com/a/b/', 'http://[::1]:8080/x?y=1#frag', '  not a url  ', ''];
        return inputs.map((u) => [k(u), k(u)]);
    });
    expect(keys).toEqual([
        ['https://example.com', 'https://example.com'],
        ['https://example.com/a/b', 'https://example.com/a/b'],
        ['http://[::1]:8080/x?y=1', 'http://[::1]:8080/x?y=1'],
        ['https://not%20a%20url', 'https://not%20a%20url'],
        ['', ''],
    ]);
});

test('scores reach the rows without each row walking the whole library', async ({ page }) => {
    await openBookmarks(page);
    const walked = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const c = d.config.instance;
        const src = d.allBookmarks;
        d.allBookmarks = Array.from({ length: 2000 }, (_, i) => ({ ...src[i % src.length], url: `https://many-${i}.example.org/` }));
        c.invalidateVisibleBookmarks?.();
        c.repaintBookmarkRowsOnly();
        // The rows drawn are the library's first; put them at its end, where
        // a walk from the start finds them last.
        d.allBookmarks.reverse();
        const rows = document.querySelectorAll('#config-bm-list .config-bm-row').length;
        const P = window.DashboardConfig.prototype;
        const original = P.bookmarkKey;
        let count = 0;
        P.bookmarkKey = function (...a) { count += 1; return original.apply(this, a); };
        try {
            c.syncWorkbenchRowsHealth();
        } finally {
            P.bookmarkKey = original;
        }
        return { count, rows, total: d.allBookmarks.length + (d.unsortedBookmarks || []).length };
    });
    expect(walked.rows).toBeGreaterThan(5);
    // One key per bookmark to build the lookup, and the rows read from it:
    // not rows x bookmarks.
    expect(walked.count).toBeLessThanOrEqual(walked.total + walked.rows);
});
