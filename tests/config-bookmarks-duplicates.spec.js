// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Duplicate URLs on one page.
 *
 * Bookmarks carry no id, so a row's identity is derived from page + URL. That
 * pair collides when the same URL sits twice on a page — the case the
 * "Duplicate URLs" cleanup filter exists to surface — and every write keyed on
 * it used to hit both copies at once: ticking one row and deleting took the
 * other with it.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !window.dashboardInstance._deferredAllBookmarksLoadInFlight);
}

/**
 * Seeds two bookmarks sharing a URL on the first page, distinguishable by name.
 * Returns the page id they live on.
 */
async function seedDuplicatePair(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const cfg = d.config;
        const pageId = d.pages[0].id;
        const url = 'https://duplicate.example.com/';
        d.allBookmarks = [
            ...d.allBookmarks.filter((b) => b.url !== url),
            { name: 'First copy', url, pageId, category: '', tags: [] },
            { name: 'Second copy', url, pageId, category: '', tags: [] },
        ];
        cfg.repaintBookmarksList();
        return pageId;
    });
}

async function openBookmarks(page) {
    await loadDashboard(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();
}

test.describe('duplicate URLs on one page', () => {
    test('each copy gets its own row key', async ({ page }) => {
        await openBookmarks(page);
        await seedDuplicatePair(page);

        const keys = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            return cfg.visibleBookmarks()
                .filter((b) => b.url === 'https://duplicate.example.com/')
                .map((b) => cfg.bookmarkKey(b));
        });
        expect(keys).toHaveLength(2);
        expect(keys[0]).not.toBe(keys[1]);
    });

    test('deleting one copy leaves the other in place', async ({ page }) => {
        let posted = null;
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() === 'POST') {
                posted = JSON.parse(route.request().postData() || '[]');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });

        await openBookmarks(page);
        await seedDuplicatePair(page);

        // Tick the second copy only, then bulk delete it.
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            const dupes = cfg.visibleBookmarks().filter((b) => b.url === 'https://duplicate.example.com/');
            cfg.bmSelected.clear();
            cfg.bmSelected.add(cfg.bookmarkKey(dupes[1]));
            cfg.confirmAction = async () => true;
            await cfg.bulkDelete(cfg.bookmarksFromKeys([...cfg.bmSelected]));
        });

        await expect.poll(() => posted !== null).toBe(true);
        const survivors = posted.filter((b) => b.url === 'https://duplicate.example.com/');
        expect(survivors).toHaveLength(1);
        expect(survivors[0].name).toBe('First copy');
    });

    test('editing one copy does not rewrite the other', async ({ page }) => {
        let posted = null;
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() === 'POST') {
                posted = JSON.parse(route.request().postData() || '[]');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });

        await openBookmarks(page);
        await seedDuplicatePair(page);

        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            const dupes = cfg.visibleBookmarks().filter((b) => b.url === 'https://duplicate.example.com/');
            cfg.bmSelected.clear();
            cfg.bmSelected.add(cfg.bookmarkKey(dupes[1]));
            await cfg.mutateSelected(cfg.bookmarksFromKeys([...cfg.bmSelected]), (b) => ({ ...b, category: 'tagged-by-test' }));
        });

        await expect.poll(() => posted !== null).toBe(true);
        const pair = posted.filter((b) => b.url === 'https://duplicate.example.com/');
        expect(pair).toHaveLength(2);
        expect(pair.find((b) => b.name === 'First copy').category).toBe('');
        expect(pair.find((b) => b.name === 'Second copy').category).toBe('tagged-by-test');
    });
});
