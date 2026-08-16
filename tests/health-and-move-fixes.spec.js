// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Four fixes from the backlog scan, each of the same kind: something the app
 * already knew and did not act on.
 *
 * A move was the one structural edit without a way back, while deleting a row
 * has offered eight seconds of Undo for a long time. The inbox search read a
 * field name the API never sends. And on the health side, the monitor computed
 * a failure's cause on every failed check and threw it away, while the 30-day
 * uptime figure was worked out over whatever samples the per-URL cap had left —
 * about a week, on a five-minute monitor — and labelled "30 days" regardless.
 *
 * The Go-side halves (failure class, confirmation re-check, certificates from
 * every check) are pinned by Go tests; what this file can reach is the browser
 * half: the undo, the search field, and the honesty of the uptime tile.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

test.describe('a move can be taken back', () => {
    test('one bookmark returns to the category it came from', async ({ page }) => {
        await dashboard(page);
        const target = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const bm = d.bookmarks.find((b) => b.category);
            const other = (d.categories || []).map((c) => c.id).find((id) => id !== bm?.category);
            if (!bm || !other) return null;
            window.__t = { url: bm.url, from: bm.category, to: other };
            return window.__t;
        });
        test.skip(!target, 'needs two categories and a categorised bookmark');

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const bm = d.bookmarks.find((b) => b.url === window.__t.url);
            const ref = d.renderCore?.resolveBookmarkReference?.(bm) || { bookmark: bm, scope: 'current' };
            d.bookmarkRows.applyBookmarkCategoryMove(ref, window.__t.to);
        });
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.bookmarks.find((b) => b.url === window.__t.url)?.category),
        { timeout: 5_000 }).toBe(target.to);

        // The toast now carries the same Undo the delete toast has always had.
        const undo = page.locator('.app-notification-action').first();
        await expect(undo).toBeVisible({ timeout: 5_000 });
        await undo.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.bookmarks.find((b) => b.url === window.__t.url)?.category),
        { timeout: 5_000 }).toBe(target.from);
    });

    test('a bulk move puts every bookmark back where it was, not all in one place', async ({ page }) => {
        await dashboard(page);
        const seeded = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cats = (d.categories || []).map((c) => c.id);
            if (cats.length < 3) return null;
            // Two bookmarks in two different categories, so an undo that files
            // them together would be visible.
            const [a, b] = d.bookmarks.slice(0, 2);
            if (!a || !b) return null;
            a.category = cats[0];
            b.category = cats[1];
            window.__b = { a: a.url, b: b.url, from: [cats[0], cats[1]], to: cats[2] };
            return window.__b;
        });
        test.skip(!seeded, 'needs three categories and two bookmarks');

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const refs = [window.__b.a, window.__b.b].map((url) => {
                const bm = d.bookmarks.find((x) => x.url === url);
                return d.renderCore?.resolveBookmarkReference?.(bm) || { bookmark: bm, scope: 'current' };
            });
            d.bookmarkRows.applyBookmarkCategoryMove(refs, window.__b.to, { count: refs.length });
        });
        await expect.poll(() => page.evaluate(() => {
            const d = window.dashboardInstance;
            return [window.__b.a, window.__b.b]
                .map((url) => d.bookmarks.find((x) => x.url === url)?.category);
        }), { timeout: 5_000 }).toEqual([seeded.to, seeded.to]);

        // A grouped toast is debounced before it appears, so wait for the button
        // rather than for the move.
        const undo = page.locator('.app-notification-action').first();
        await expect(undo).toBeVisible({ timeout: 10_000 });
        await undo.click();
        // Undoing by moving again would file both into one category; the undo
        // works from the snapshot the move took.
        await expect.poll(() => page.evaluate(() => {
            const d = window.dashboardInstance;
            return [window.__b.a, window.__b.b]
                .map((url) => d.bookmarks.find((x) => x.url === url)?.category);
        }), { timeout: 5_000 }).toEqual(seeded.from);
    });
});

test.describe('the inbox searches the summary it stores', () => {
    test('a phrase only in the fetched description is found', async ({ page }) => {
        await dashboard(page);
        const hits = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.items = [{
                id: 'x1',
                url: 'https://example.com/one',
                title: 'Plain title',
                // The name the API actually sends. The haystack read
                // previewDescription for a day — a key that is never on the
                // object — so the summary was searchable in theory only.
                previewDesc: 'a distinctive summary sentence',
                addedAt: Date.now(),
            }];
            inbox.searchQuery = 'distinctive summary';
            const found = inbox.getFilteredItems().length;
            inbox.searchQuery = '';
            return found;
        });
        expect(hits).toBe(1);
    });
});

test.describe('an uptime window says what it could not cover', () => {
    test('a monitor with a week of samples does not print a bare 30 days', async ({ page }) => {
        await dashboard(page);
        // The health module is loaded on demand, so open the view before asking
        // it to render anything.
        await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
        await page.waitForTimeout(1500);
        const tiles = await page.evaluate(() => {
            const health = window.dashboardInstance.health?._module || window.dashboardInstance.health;
            const day = 24 * 3600_000;
            const html = health.renderUptimeTiles({
                uptime24h: { ratio: 1, samples: 288 },
                uptime7d: { ratio: 0.99, samples: 2000 },
                uptime30d: { ratio: 0.99, samples: 2000 },
                // Seven days of history behind a thirty-day figure, which is what
                // the per-URL sample cap leaves a five-minute monitor.
                coveredMs: 7 * day,
            });
            const host = document.createElement('div');
            host.innerHTML = html;
            return [...host.querySelectorAll('.health-monitor-stat')]
                .map((el) => el.innerText.replace(/\s+/g, ' ').trim());
        });
        expect(tiles).toHaveLength(3);
        // The 24h tile is fully covered and says nothing about history.
        expect(tiles[0]).toMatch(/checks/i);
        // The 30d tile is not, and says so instead of counting checks.
        expect(tiles[2]).toMatch(/history/i);
    });
});
