// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The three bulk actions that fetch a page rather than read the report.
 *
 * Rebuilding a preview, refreshing a favicon and keeping a copy on disk were
 * each on a row's own menu, which is where the tedium was: a filter that finds
 * forty bookmarks with no preview is exactly the case for doing them at once.
 *
 * They are the slow ones — a local copy fetches every asset on a page — so what
 * these tests pin is as much about the waiting as the doing: one request at a
 * time, a bar that counts, a refusal that stops the sweep instead of repeating
 * itself forty times.
 */

async function dismissFaviconOverlay(page) {
    await page.evaluate(() => {
        const overlay = document.getElementById('favicon-prefetch-overlay');
        if (overlay) overlay.hidden = true;
    });
}

async function seedAndSelect(page, count) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);

    const stamp = Date.now();
    const urls = Array.from({ length: count }, (_, i) => `https://bulkfetch-${i}-${stamp}.invalid`);
    await page.evaluate(async (list) => {
        const d = window.dashboardInstance;
        const pid = Number(d.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const url of list) {
            await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pid, bookmark: { name: url, url, category: '', checkStatus: true } }),
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
    await page.locator('[data-health-filter="all"]').click();
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 20_000 });

    const picked = await page.evaluate((list) => {
        const h = window.dashboardInstance.health;
        const issues = h.getFilteredIssues().filter((i) => list.includes(String(i.url).trim()));
        issues.forEach((i) => h.multiSelect.toggle(h.issueKey(i)));
        return issues.length;
    }, urls);
    expect(picked).toBe(count);
    return urls;
}

test.describe('health bulk: the three that fetch a page', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            try {
                const key = window.DashboardHealth?.STATE_KEY;
                if (key) localStorage.removeItem(key);
            } catch { /* private mode */ }
        }).catch(() => { /* page already closed */ });
    });

    test('the bulk bar offers all three', async ({ page }) => {
        await seedAndSelect(page, 2);
        for (const action of ['preview', 'favicon', 'local-copy']) {
            await expect(page.locator(`.health-view-bulk-bar [data-bulk="${action}"], [data-bulk="${action}"]`).first())
                .toBeVisible();
        }
    });

    /*
     * One at a time, not twenty at once.
     *
     * Each of these fetches a page belonging to somebody else. Twenty parallel
     * requests from one client is a burst a small server reads as an attack,
     * which is the same reason the re-check sweep is sequential.
     */
    test('previews are rebuilt one request at a time, each asking for a fresh answer', async ({ page }) => {
        await seedAndSelect(page, 3);
        const seen = await page.evaluate(async () => {
            const calls = [];
            let inFlight = 0;
            let peak = 0;
            const original = window.fetch;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/bookmark-preview')) {
                    calls.push(url);
                    inFlight += 1;
                    peak = Math.max(peak, inFlight);
                    return new Promise((resolve) => setTimeout(() => {
                        inFlight -= 1;
                        resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
                    }, 40));
                }
                return original.apply(this, arguments);
            };
            await window.dashboardInstance.health.multiSelect.bulkRebuildPreviews();
            window.fetch = original;
            return { calls, peak };
        });
        expect(seen.calls.length).toBe(3);
        expect(seen.peak).toBe(1);
        // Without refresh=1 a cached answer comes back and the sweep changes
        // nothing at all.
        seen.calls.forEach((url) => expect(url).toContain('refresh=1'));
    });

    /*
     * Favicons are written per page, not per row.
     *
     * There is no per-bookmark write: a single row's refresh reads the whole
     * page's bookmarks, changes one and saves them all back. Done row by row,
     * three rows on one page would be three loads and three saves of the same
     * list, and the last save would carry only the last icon.
     */
    test('three rows on one page are saved once, with all three icons', async ({ page }) => {
        await seedAndSelect(page, 3);
        const result = await page.evaluate(async () => {
            const saves = [];
            const original = window.fetch;
            window.BookmarkPreviewService = window.BookmarkPreviewService || {};
            const originalIcon = window.BookmarkPreviewService.fetchAndUploadFavicon;
            let n = 0;
            window.BookmarkPreviewService.fetchAndUploadFavicon = async () => `/data/icons/bulk-${n += 1}.png`;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/bookmarks?page=') && init?.method === 'POST') {
                    saves.push(JSON.parse(init.body).filter((b) => String(b.icon || '').includes('bulk-')).length);
                    return Promise.resolve(new Response('{}', { status: 200 }));
                }
                return original.apply(this, arguments);
            };
            await window.dashboardInstance.health.multiSelect.bulkRefreshFavicons();
            window.fetch = original;
            window.BookmarkPreviewService.fetchAndUploadFavicon = originalIcon;
            return { saves };
        });
        expect(result.saves.length).toBe(1);
        expect(result.saves[0]).toBe(3);
    });

    /*
     * monolith missing answers 412, and will answer 412 for every row after.
     *
     * Carrying on would spend minutes proving the same thing, so the sweep
     * stops and says what to do about it instead.
     */
    test('a missing monolith stops the sweep on the first row', async ({ page }) => {
        await seedAndSelect(page, 4);
        const calls = await page.evaluate(async () => {
            let n = 0;
            const original = window.fetch;
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/archives/capture')) {
                    n += 1;
                    return Promise.resolve(new Response(JSON.stringify({ error: 'monolith not found', available: false }),
                        { status: 412, headers: { 'Content-Type': 'application/json' } }));
                }
                return original.apply(this, arguments);
            };
            const h = window.dashboardInstance.health;
            const confirm = h.confirm;
            h.confirm = async () => true;
            await h.multiSelect.bulkCaptureLocalCopies();
            h.confirm = confirm;
            window.fetch = original;
            return n;
        });
        expect(calls).toBe(1);
    });

    // Saving a copy takes seconds per page, so a selection of twenty is minutes.
    // The count belongs in the question rather than in the surprise.
    test('saving copies asks first, names how many, and a no fetches nothing', async ({ page }) => {
        await seedAndSelect(page, 4);
        const seen = await page.evaluate(async () => {
            let captures = 0;
            const original = window.fetch;
            window.fetch = function (input) {
                const url = typeof input === 'string' ? input : input?.url || '';
                if (url.includes('/api/archives/capture')) captures += 1;
                return original.apply(this, arguments);
            };
            const h = window.dashboardInstance.health;
            const confirm = h.confirm;
            let title = '';
            h.confirm = async (t) => { title = t; return false; };
            await h.multiSelect.bulkCaptureLocalCopies();
            h.confirm = confirm;
            window.fetch = original;
            return { title, captures };
        });
        expect(seen.title).toContain('4');
        // Declining has to stop it, not merely be recorded: this is the action
        // that costs minutes.
        expect(seen.captures).toBe(0);
    });
});
