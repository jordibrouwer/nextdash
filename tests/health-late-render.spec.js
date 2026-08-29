// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * A view that has been left must not paint itself back over what replaced it.
 *
 * Health's slow operations -- a re-check of a dead host, an archive lookup --
 * run for seconds, and loadAndRender() calls render() when they land. render()
 * begins with container.innerHTML = '', so a report arriving after you have
 * gone back to your bookmarks wiped the grid and put the health list in its
 * place, while the URL and the page tab still said bookmarks.
 */
async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('health');
}

test('a report landing after you leave does not repaint over the grid', async ({ page }) => {
    await openHealth(page);

    // A slow report, the way a re-check of an unreachable host is slow.
    await page.route('**/api/bookmark-health**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await route.continue();
    });

    await page.evaluate(() => {
        window.__pending = window.dashboardInstance.health.loadAndRender({ refresh: true });
    });
    // Leave for the grid while the report is still in flight.
    await page.evaluate(() => window.dashboardInstance.pageNav?.requestPageNavigation(
        window.dashboardInstance.currentPageId));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('bookmarks');

    await page.evaluate(() => window.__pending);

    const after = await page.evaluate(() => ({
        view: window.dashboardInstance.activeView,
        layout: document.getElementById('dashboard-layout').className,
        health: !!document.querySelector('.health-view-feed, .health-view-header'),
    }));
    expect(after.view).toBe('bookmarks');
    expect(after.health, 'the health view painted itself back over the grid').toBe(false);
    expect(after.layout, 'the container was left wearing health-layout').not.toContain('health-layout');
});

test('the sixty-second refresh keeps your place in the list', async ({ page }) => {
    await openHealth(page);

    /*
     * The Monitored filter reloads itself every sixty seconds. Rebuilding the
     * list from nothing puts the page back at the top, so a reader partway
     * down was moved without touching anything. Every row action already keeps
     * its place through keepPlaceAt(); the timer was the one refresh that did
     * not ask.
     */
    await page.evaluate(() => {
        const h = window.dashboardInstance.health;
        // Enough rows that the page can be scrolled at all.
        h.filter = 'all';
        h.render();
    });
    const scrollable = await page.evaluate(() =>
        document.documentElement.scrollHeight > window.innerHeight + 200);
    test.skip(!scrollable, 'needs a list long enough to scroll');

    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(300);

    // The refresh the timer performs, through the same entry point.
    await page.evaluate(() => window.dashboardInstance.health.refreshKeepingPlace());
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.health.loading),
        { timeout: 15_000 }).toBe(false);

    const landed = await page.evaluate(() => Math.round(window.scrollY));
    expect(landed, `the refresh moved the reader to ${landed}`).toBeGreaterThan(300);
});

test('a duplicate-group menu removed by a re-render does not leak or hang', async ({ page }) => {
    await openHealth(page);

    /*
     * The menu is built by hand, outside the view's own menu machinery, and
     * cleaned up on only two paths: an outside click, or picking a group. A
     * re-render empties the container the menu lives in, so pressing R while
     * it was open left a capturing document listener bound for the life of the
     * page and a promise that never settled -- the merge flow awaiting it was
     * wedged, and every repeat stacked another listener.
     */
    const outcome = await page.evaluate(async () => {
        const h = window.dashboardInstance.health;
        const wrap = document.createElement('span');
        wrap.className = 'health-view-menu-wrap';
        const anchor = document.createElement('button');
        wrap.appendChild(anchor);
        document.getElementById('dashboard-layout').appendChild(wrap);

        // The menu only appears when the report holds more than one group, and
        // chooseDuplicateGroup reads them off the report itself.
        h.report = h.report || {};
        h.report.duplicateGroups = [
            { url: 'https://a.example/one', bookmarks: [{ name: 'A' }, { name: 'B' }] },
            { url: 'https://b.example/two', bookmarks: [{ name: 'C' }, { name: 'D' }] },
        ];
        let settled = false;
        const pending = h.chooseDuplicateGroup(anchor).then((v) => { settled = true; return v; });
        const menuOpened = !!document.querySelector('.health-view-merge-group-menu');

        // The re-render that takes the menu away.
        h.render();
        await new Promise((r) => setTimeout(r, 150));

        const raced = await Promise.race([
            pending,
            new Promise((r) => setTimeout(() => r('__timeout__'), 1200)),
        ]);
        return { settled, menuOpened, raced: raced === '__timeout__' ? 'timeout' : 'resolved' };
    });

    expect(outcome.menuOpened, 'the menu never opened, so the test proves nothing').toBe(true);
    expect(outcome.raced, 'the promise never settled after the menu was removed').toBe('resolved');
    expect(outcome.settled).toBe(true);
});

test('pruning a selection closes the checkbox column with it', async ({ page }) => {
    await openHealth(page);

    /*
     * Every other mutator in the multi-select pairs syncRows() with
     * syncToolbar(); prune() called only the second. syncRows() is also what
     * maintains .has-multi-select on the feed -- the class that opens the
     * checkbox column -- so a prune that emptied the selection took the count
     * to zero and left the gutter standing with nothing in it.
     */
    // A report of our own: the fixture install has none, and this measures a
    // selection, which needs rows to select.
    await page.evaluate(() => {
        const h = window.dashboardInstance.health;
        h.report = {
            summary: { total: 2, healthyCount: 1, brokenCount: 1 },
            issues: [
                { pageId: 1, index: 0, name: 'Prune one', url: 'https://p1.example/',
                  status: 'broken', flags: ['broken'], score: 10, lastChecked: Date.now() },
                { pageId: 1, index: 1, name: 'Prune two', url: 'https://p2.example/',
                  status: 'healthy', flags: ['healthy'], score: 100, lastChecked: Date.now() },
            ],
        };
        h.filter = 'all';
        h.render();
    });

    const outcome = await page.evaluate(() => {
        const h = window.dashboardInstance.health;
        const sel = h.multiSelect;
        const issues = sel.allIssues?.() || [];
        if (!issues.length) return { skip: true };

        sel.toggle(h.issueKey(issues[0]));
        const opened = !!document.querySelector('.health-view-feed.has-multi-select');

        // A key the report no longer has: what prune() is for.
        sel.selected.clear();
        sel.selected.add('gone::not-in-this-report');
        sel.prune();

        return {
            opened,
            size: sel.selected.size,
            columnStillOpen: !!document.querySelector('.health-view-feed.has-multi-select'),
        };
    });
    test.skip(outcome.skip === true, 'needs at least one issue in the report');

    expect(outcome.opened, 'ticking a row never opened the column').toBe(true);
    expect(outcome.size, 'prune did not drop the dead key').toBe(0);
    expect(outcome.columnStillOpen, 'the checkbox column stayed open after the prune').toBe(false);
});
