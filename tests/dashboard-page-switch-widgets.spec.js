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

    /**
     * The hover that warms a page must not be the reason it opens empty.
     *
     * prefetchPageData asked for the bookmarks and the categories and stopped,
     * and setPageDataCache stores a missing block list as null. getCachedPageData
     * handed that null on, and null walks straight through
     * _applyLoadedPageData's `blocks !== undefined` guard -- so a page whose tab
     * had been hovered opened with every widget gone and its order lost, while
     * the same page reached by a plain click opened correctly.
     *
     * Driven through the pointer, not through prefetchPageData(): the hover is
     * what the reader does, and it is what binds the bug to the click.
     */
    test('a tab that was hovered still opens with its widgets', async ({ page }) => {
        await openDashboard(page);
        const target = await otherPageId(page);
        test.skip(target === null, 'needs a second page');

        /*
         * Start again once the second page exists, with a bare reload.
         *
         * Creating a page writes, and so does anything openDashboard dismisses
         * on the way in -- and a write moves the data revision, which makes the
         * next switch drop its cache on purpose. That is the one path where
         * this bug cannot show, so the setup must not sit on it. A plain reload
         * puts the tab in the ordinary state this is about: two pages that have
         * been there a while, one of them never opened in this session.
         */
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        // The target page is given a widget on the server side of the boundary,
        // so the prefetch and the switch are answered the same way and the test
        // does not depend on what the fixture happens to ship.
        await page.route(`**/api/pages/${target}/blocks`, (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ pageId: target, widgets: [{ id: 'w-hover-probe', type: 'uptime' }], order: ['w-hover-probe'] }),
        }));

        const tab = page.locator('.page-nav-btn').nth(await page.evaluate(
            (id) => (window.dashboardInstance.pages || []).findIndex((p) => Number(p.id) === Number(id)),
            target,
        ));

        await tab.hover();
        // The prefetch is best-effort and unawaited; wait for the entry it writes.
        await page.waitForFunction(
            (id) => !!window.dashboardInstance._pageDataCache?.get(Number(id)),
            target,
            { timeout: 10_000 },
        );

        await tab.click();
        await page.waitForFunction(
            (id) => Number(window.dashboardInstance.currentPageId) === Number(id),
            target,
            { timeout: 10_000 },
        );
        await page.waitForTimeout(600);

        const landed = await page.evaluate(() => ({
            widgets: (window.dashboardInstance.widgets || []).length,
            order: (window.dashboardInstance.blockOrder || []).length,
        }));

        expect(landed.widgets, 'the hovered page opened without its widgets').toBeGreaterThan(0);
        expect(landed.order, 'the hovered page opened without its block order').toBeGreaterThan(0);
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
