// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * _applyLoadedPageData's preserveView guard: a background bookmark/category
 * load landing while a full-container view (inbox/health/config) is open must
 * not yank the user back to the bookmarks grid or rewrite the hash out from
 * under them.
 *
 * The guard combines three independent signals — the URL hash, the
 * dashboard-layout element's class, and dash.activeView — because each alone
 * has a blind spot the other two cover (see the comment above
 * DashboardData.FULL_CONTAINER_VIEWS). Every full-container view's identity
 * now lives in that one table so a new view is one row there rather than
 * three hand-copied edits — exactly the shape of omission that broke deep
 * links once already (see dashboard-deep-link-timing.spec.js). These tests
 * pin the table's coverage of the three existing views and reproduce the
 * actual failure mode: a background reload landing mid-view.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

test.describe('FULL_CONTAINER_VIEWS table covers every known view', () => {
    test('inbox, health and config each match their own hash, layout class and activeView', async ({ page }) => {
        await openDashboard(page);

        const results = await page.evaluate(() => {
            const table = DashboardData.FULL_CONTAINER_VIEWS;
            const byView = Object.fromEntries(table.map((entry) => [entry.view, entry]));
            const d = window.dashboardInstance;
            return {
                names: table.map((entry) => entry.view),
                inboxHash: byView.inbox.matchesHash('#inbox'),
                healthHash: byView.health.matchesHash('#health'),
                configHash: byView.config.matchesHash('#config'),
                configSectionHash: byView.config.matchesHash('#config/appearance'),
                bookmarksHashRejected: table.some((entry) => entry.matchesHash('#3')),
                inboxLayoutClass: byView.inbox.layoutClass,
                healthLayoutClass: byView.health.layoutClass,
                configLayoutClass: byView.config.layoutClass,
                isEnabledIsCallable: table.every((entry) => typeof entry.isEnabled(d) === 'boolean'),
            };
        });

        expect(results.names.sort()).toEqual(['config', 'health', 'inbox']);
        expect(results.inboxHash).toBe(true);
        expect(results.healthHash).toBe(true);
        expect(results.configHash).toBe(true);
        expect(results.configSectionHash).toBe(true);
        expect(results.bookmarksHashRejected).toBe(false);
        expect(results.inboxLayoutClass).toBe('inbox-layout');
        expect(results.healthLayoutClass).toBe('health-layout');
        expect(results.configLayoutClass).toBe('config-layout');
        expect(results.isEnabledIsCallable).toBe(true);
    });
});

test.describe('a background page-data load does not evict an open full-container view', () => {
    for (const { hash, layoutClass, label } of [
        { hash: '#health', layoutClass: 'health-layout', label: 'health' },
        { hash: '#inbox', layoutClass: 'inbox-layout', label: 'inbox' },
    ]) {
        test(`${label}: hash, layout class and activeView all survive`, async ({ page }) => {
            await openDashboard(page);
            await page.goto(`/${hash}`);
            await page.waitForFunction(
                (cls) => document.getElementById('dashboard-layout')?.classList.contains(cls),
                layoutClass,
                { timeout: 15_000 },
            );

            // The real caller of _applyLoadedPageData: a background bookmark
            // reload for the current page, exactly what a stale-revision sync
            // or a prefetch landing late would trigger.
            await page.evaluate(async () => {
                const d = window.dashboardInstance;
                await d.data.loadPageBookmarks(d.currentPageId, { forceFetch: true, skipRender: true });
            });

            const state = await page.evaluate((cls) => ({
                hash: window.location.hash,
                hasLayoutClass: document.getElementById('dashboard-layout')?.classList.contains(cls),
                activeView: window.dashboardInstance.activeView,
            }), layoutClass);

            expect(state.hash, 'hash was rewritten out from under the open view').toBe(hash);
            expect(state.hasLayoutClass, 'layout class was replaced, view was evicted').toBe(true);
            expect(state.activeView, 'activeView reverted to bookmarks').toBe(label);
        });
    }
});
