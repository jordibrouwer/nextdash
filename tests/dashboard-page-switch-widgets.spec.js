// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Switching pages must not lose the widgets, and must not refetch what it
 * already has.
 *
 * Two faults met here. The block list is fetched per switch and its failure was
 * silent -- `blocks` became null and _applyLoadedPageData reads that as "this
 * page has no widgets", so a dropped request emptied the page rather than
 * leaving what was there. And every ping wrote LastChecked into
 * bookmarks-*.json, which the server hashes into the data revision, so the
 * client dropped its page cache on every switch and refetched all three
 * endpoints each time -- the rebuild that made switching feel slow.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/**
 * The id of a page that is not the one currently shown.
 *
 * The fixture ships a single page, and this bug only exists between two, so one
 * is created when there is nothing to switch to.
 */
async function otherPageId(page) {
    const existing = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const other = (d.pages || []).find((p) => Number(p.id) !== Number(d.currentPageId));
        return other ? Number(other.id) : null;
    });
    if (existing !== null) return existing;

    await page.evaluate(() => window.dashboardInstance.structureCreate.createPageFromForm('E2E switch probe'));
    await page.waitForFunction(() => (window.dashboardInstance.pages || []).length > 1, null, { timeout: 15_000 });
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const other = (d.pages || []).find((p) => Number(p.id) !== Number(d.currentPageId));
        return other ? Number(other.id) : null;
    });
}

test.describe('switching pages', () => {
    test('keeps the widgets when the block list does not arrive', async ({ page }) => {
        await openDashboard(page);
        const target = await otherPageId(page);
        test.skip(target === null, 'needs a second page');

        // Give the page a widget to lose.
        await page.evaluate(() => {
            window.dashboardInstance.widgets = [{ id: 'w-probe', type: 'uptime', title: 'Probe' }];
        });

        // Only the block list fails; bookmarks and categories still arrive, so
        // the load runs to completion and applies. Aborting the request instead
        // would fail the whole load and never reach the branch under test.
        await page.route('**/api/pages/*/blocks', (route) => route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"unavailable"}',
        }));

        await page.evaluate((id) => window.dashboardInstance.data.loadPageBookmarks(id, {
            forceFetch: true,
            quiet: true,
        }), target);
        await page.waitForTimeout(1200);

        // Not emptied by a request that never answered.
        const widgets = await page.evaluate(() => (window.dashboardInstance.widgets || []).length);
        expect(widgets).toBeGreaterThan(0);
    });

    test('a page already loaded is served from cache, not refetched', async ({ page }) => {
        await openDashboard(page);
        const first = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const second = await otherPageId(page);
        test.skip(second === null, 'needs a second page');

        const load = (id) => page.evaluate((pid) => window.dashboardInstance.data.loadPageBookmarks(pid), id);

        // Warm both pages.
        await load(second);
        await page.waitForTimeout(800);
        await load(first);
        await page.waitForTimeout(800);

        // Now count what a switch between two known pages actually asks for.
        const urls = [];
        page.on('request', (r) => {
            const u = r.url();
            if (/\/api\/(bookmarks|categories|pages\/\d+\/blocks)/.test(u)) urls.push(u);
        });

        await load(second);
        await page.waitForTimeout(1200);

        expect(urls).toEqual([]);
    });
});
