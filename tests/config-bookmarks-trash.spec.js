// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    WRITE_TOKEN,
} = require('./e2e-helpers');

const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Deleting from Config → Bookmarks writes to the trash.
 *
 * The dashboard's delete paths record the removed rows so they stay recoverable
 * for 30 days. Config → Bookmarks is where a clearout actually happens, so a
 * delete there that only offered an 8-second undo toast was the one most likely
 * to be regretted and the least recoverable.
 */

async function openBookmarks(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !window.dashboardInstance._deferredAllBookmarksLoadInFlight);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();
}

/** Adds bookmarks to the first page through the real page write. */
async function seedBookmarks(page, names) {
    return page.evaluate(async (rows) => {
        const d = window.dashboardInstance;
        const pageId = Number(d.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/bookmarks?page=${pageId}`);
        const list = res.ok ? await res.json() : [];
        const next = [...list, ...rows.map((name) => ({
            name,
            url: `https://${name}.example/`,
            category: '',
            tags: [],
            shortcut: '',
        }))];
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
        });
        await d.loadAllBookmarks();
        d.config.repaintBookmarksList();
        return pageId;
    }, names);
}

async function trashEntries(page) {
    const res = await page.request.get('/api/trash');
    const body = await res.json();
    return body.items || [];
}

test.describe('Config → Bookmarks writes deletes to the trash', () => {
    test.beforeEach(async ({ page }) => {
        await page.request.delete('/api/trash', { data: { all: true }, headers: writeHeaders });
    });

    test('a single row delete lands in the trash', async ({ page }) => {
        await openBookmarks(page);
        const marker = `cfg-single-${Date.now()}`;
        await seedBookmarks(page, [marker]);

        await page.evaluate(async (name) => {
            const cfg = window.dashboardInstance.config;
            const target = cfg.visibleBookmarks().find((b) => b.name === name);
            cfg.confirmAction = async () => true;
            await cfg.deleteBookmarkByKey(cfg.bookmarkKey(target));
        }, marker);

        await expect.poll(async () => {
            const items = await trashEntries(page);
            return items.some((i) => i.bookmark?.name === marker);
        }, { timeout: 10_000 }).toBe(true);
    });

    test('the trash entry keeps the URL and the page it was deleted from', async ({ page }) => {
        await openBookmarks(page);
        const marker = `cfg-fields-${Date.now()}`;
        const pageId = await seedBookmarks(page, [marker]);

        await page.evaluate(async (name) => {
            const cfg = window.dashboardInstance.config;
            const target = cfg.visibleBookmarks().find((b) => b.name === name);
            cfg.confirmAction = async () => true;
            await cfg.deleteBookmarkByKey(cfg.bookmarkKey(target));
        }, marker);

        await expect.poll(async () => (await trashEntries(page)).length, { timeout: 10_000 })
            .toBeGreaterThan(0);
        const entry = (await trashEntries(page)).find((i) => i.bookmark?.name === marker);
        expect(entry).toBeTruthy();
        expect(entry.bookmark.url).toBe(`https://${marker}.example/`);
        expect(Number(entry.pageId)).toBe(Number(pageId));
    });

    test('a deleted row restores from the trash back onto its page', async ({ page }) => {
        await openBookmarks(page);
        const marker = `cfg-restore-${Date.now()}`;
        const pageId = await seedBookmarks(page, [marker]);

        await page.evaluate(async (name) => {
            const cfg = window.dashboardInstance.config;
            const target = cfg.visibleBookmarks().find((b) => b.name === name);
            cfg.confirmAction = async () => true;
            await cfg.deleteBookmarkByKey(cfg.bookmarkKey(target));
        }, marker);

        await expect.poll(async () => {
            const items = await trashEntries(page);
            return items.some((i) => i.bookmark?.name === marker);
        }, { timeout: 10_000 }).toBe(true);

        const entry = (await trashEntries(page)).find((i) => i.bookmark?.name === marker);
        const restored = await page.request.post('/api/trash/restore', {
            data: { id: entry.id },
            headers: writeHeaders,
        });
        expect(restored.ok()).toBe(true);

        const onPage = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/bookmarks?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, pageId);
        expect(onPage.some((b) => b.name === marker)).toBe(true);
    });

    test('a bulk delete lands every row in the trash', async ({ page }) => {
        await openBookmarks(page);
        const stamp = Date.now();
        const markers = [`cfg-bulk-a-${stamp}`, `cfg-bulk-b-${stamp}`, `cfg-bulk-c-${stamp}`];
        await seedBookmarks(page, markers);

        await page.evaluate(async (names) => {
            const cfg = window.dashboardInstance.config;
            cfg.bmSelected.clear();
            cfg.visibleBookmarks()
                .filter((b) => names.includes(b.name))
                .forEach((b) => cfg.bmSelected.add(cfg.bookmarkKey(b)));
            cfg.confirmAction = async () => true;
            await cfg.bulkDelete(cfg.bookmarksFromKeys([...cfg.bmSelected]));
        }, markers);

        await expect.poll(async () => {
            const items = await trashEntries(page);
            return markers.filter((m) => items.some((i) => i.bookmark?.name === m)).length;
        }, { timeout: 10_000 }).toBe(3);
    });

    test('bulk-deleted entries each carry their own index', async ({ page }) => {
        await openBookmarks(page);
        const stamp = Date.now();
        const markers = [`cfg-idx-a-${stamp}`, `cfg-idx-b-${stamp}`];
        await seedBookmarks(page, markers);

        await page.evaluate(async (names) => {
            const cfg = window.dashboardInstance.config;
            cfg.bmSelected.clear();
            cfg.visibleBookmarks()
                .filter((b) => names.includes(b.name))
                .forEach((b) => cfg.bmSelected.add(cfg.bookmarkKey(b)));
            cfg.confirmAction = async () => true;
            await cfg.bulkDelete(cfg.bookmarksFromKeys([...cfg.bmSelected]));
        }, markers);

        await expect.poll(async () => {
            const items = await trashEntries(page);
            return markers.filter((m) => items.some((i) => i.bookmark?.name === m)).length;
        }, { timeout: 10_000 }).toBe(2);

        const items = await trashEntries(page);
        const mine = markers.map((m) => items.find((i) => i.bookmark?.name === m));
        // Positions are what restore puts a row back at, so two rows deleted
        // together must not collapse onto the same index.
        const indices = mine.map((i) => Number(i.index));
        expect(new Set(indices).size).toBe(2);
    });

    test('a failed page write records nothing', async ({ page }) => {
        await openBookmarks(page);
        const marker = `cfg-failed-${Date.now()}`;
        await seedBookmarks(page, [marker]);

        // The trash write runs only after the page write succeeds, so a delete
        // that never persisted must not leave a phantom entry behind.
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() === 'POST') {
                return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });

        await page.evaluate(async (name) => {
            const cfg = window.dashboardInstance.config;
            const target = cfg.visibleBookmarks().find((b) => b.name === name);
            cfg.confirmAction = async () => true;
            await cfg.deleteBookmarkByKey(cfg.bookmarkKey(target));
        }, marker);

        await page.waitForTimeout(1000);
        const items = await trashEntries(page);
        expect(items.some((i) => i.bookmark?.name === marker)).toBe(false);
    });
});
