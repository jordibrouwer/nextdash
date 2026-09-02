// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A deleted bookmark leaves the page there and then, not on the next reload.
 *
 * The delete itself always worked — the row was gone from the data and from the
 * file. What failed was the re-render behind it: ensureCategorySortControls
 * looked the chevron up with querySelector, which finds it at any depth, and
 * then passed it to titleEl.insertBefore, which requires a direct child. Once
 * the chevron moved into .category-title-trailing that throw took down
 * patchBookmarkData mid-pass, so the row stayed on screen — and stayed bound to
 * a bookmark that no longer existed, which is why it then ignored its own
 * context menu.
 */

const PROBE_NAME = 'E2E live removal probe';
const PROBE_URL = 'https://live-removal.example/probe';

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Clear any probe left behind by an earlier run before adding a fresh one. */
async function removeProbeBookmarks(page) {
    await page.evaluate(async ({ url }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pageId = window.dashboardInstance.currentPageId;
        const res = await api(`/api/bookmarks?page=${pageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const keep = (Array.isArray(list) ? list : []).filter((b) => b.url !== url);
        if (keep.length === (list || []).length) return;
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, { url: PROBE_URL }).catch(() => { /* the page may already be closed */ });
}

async function addProbeBookmark(page) {
    await removeProbeBookmarks(page);
    await page.evaluate(async ({ name, url }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, bookmark: { name, url } }),
        });
    }, { name: PROBE_NAME, url: PROBE_URL });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('deleting a bookmark on the dashboard', () => {
    /*
     * The throw itself, at the point it happens. The delete path only reaches
     * this when a category is patched, so asserting on the row alone let the
     * bug through -- this pins the call that broke the render.
     */
    test('rebuilding a category header does not throw', async ({ page }) => {
        await openDashboard(page);

        const results = await page.evaluate(() => {
            const d = window.dashboardInstance;
            // Force the branch that creates the controls rather than updating them.
            document.querySelectorAll('.category-sort-controls').forEach((el) => el.remove());
            const out = [];
            document.querySelectorAll('.category[data-category-id]').forEach((categoryEl) => {
                const id = categoryEl.getAttribute('data-category-id');
                const category = (d.categories || []).find((c) => String(c.id) === String(id));
                if (!category) return;
                try {
                    window.DashboardCategorySort.ensureCategorySortControls(d, categoryEl, category, d.renderCore);
                    out.push({ id, ok: true });
                } catch (error) {
                    out.push({ id, threw: `${error.name}: ${error.message}` });
                }
            });
            return out;
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results.filter((r) => r.threw)).toEqual([]);
    });

    test('takes the row off the page without a reload', async ({ page }) => {
        await openDashboard(page);
        await addProbeBookmark(page);

        // A bookmark can render in more than one place at once -- its own
        // category and a smart collection such as Today -- so this counts rows
        // rather than expecting exactly one.
        const row = page.locator(`[data-bookmark-url="${PROBE_URL}"]`);
        expect(await row.count()).toBeGreaterThan(0);

        const failures = [];
        page.on('pageerror', (e) => failures.push(String(e.message)));

        await page.evaluate(async ({ url }) => {
            const d = window.dashboardInstance;
            const index = d.bookmarks.findIndex((b) => b.url === url);
            await d.inlineEdit.deleteBookmarkInline(
                {
                    bookmark: d.bookmarks[index],
                    index,
                    scope: 'current',
                    pageId: d.currentPageId,
                    original: { ...d.bookmarks[index] },
                },
                { skipConfirm: true },
            );
        }, { url: PROBE_URL });

        await expect(row).toHaveCount(0, { timeout: 10_000 });
        expect(failures).toEqual([]);
    });
});
