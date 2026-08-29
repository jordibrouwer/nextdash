// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Back and Forward move between views and pages.
 *
 * Measured before this existed: opening the inbox left history.length
 * unchanged, and Back stripped the hash while the inbox stayed on screen --
 * the address bar and the view came apart. From a view, a numeric hash was
 * actively reverted, so Back to a bookmarks page did nothing at all.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
}

test('the history module pushes once and suppresses pushes while restoring', async ({ page }) => {
    await openDashboard(page);

    const result = await page.evaluate(async () => {
        const H = window.DashboardHistory;
        const before = history.length;
        H.pushLocation('/#probe-one');
        const afterPush = history.length;
        // The same URL twice is not two places.
        H.pushLocation('/#probe-one');
        const afterDuplicate = history.length;
        let restoringSeen = false;
        await H.runRestore(async () => {
            restoringSeen = H.isRestoring();
            // After an await, which is where a view opener writes its URL:
            // every opener is async and settles its address bar at the end.
            // Releasing the flag synchronously would let that write push.
            await new Promise((r) => setTimeout(r, 20));
            H.pushLocation('/#probe-two');
        });
        return {
            pushed: afterPush - before,
            duplicateAdded: afterDuplicate - afterPush,
            suppressed: history.length - afterDuplicate,
            restoringSeen,
            settled: H.isRestoring(),
        };
    });

    expect(result.pushed, 'pushLocation did not add an entry').toBe(1);
    expect(result.duplicateAdded, 'the same URL was pushed twice').toBe(0);
    expect(result.suppressed, 'a push during a restore added an entry').toBe(0);
    expect(result.restoringSeen, 'isRestoring() was false inside runRestore').toBe(true);
    expect(result.settled, 'the restoring flag was never cleared').toBe(false);
});

test('opening a view adds one history entry', async ({ page }) => {
    await openDashboard(page);

    const before = await page.evaluate(() => history.length);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    const after = await page.evaluate(() => ({
        len: history.length,
        hash: location.hash,
        view: window.dashboardInstance.activeView,
    }));

    // Measured before this change: history.length did not move, so Back had
    // nothing to return to.
    expect(after.len - before, 'opening the inbox added no history entry').toBe(1);
    expect(after.hash).toBe('#inbox');
    expect(after.view).toBe('inbox');
});

test('a filter click is not a history step', async ({ page }) => {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();

    const before = await page.evaluate(() => history.length);
    await page.locator('[data-inbox-filter="unread"]').click();
    await expect(page.locator('[data-inbox-filter="unread"]')).toHaveClass(/is-active/);
    const after = await page.evaluate(() => ({
        len: history.length,
        search: location.search,
    }));

    // The address bar still describes the filter -- it is shareable -- but
    // Back must leave the inbox rather than walk its filter history.
    expect(after.len - before, 'a filter click added a history entry').toBe(0);
    expect(after.search, 'the filter left the address bar').toContain('ib_filter=unread');
});

test('Back leaves a view and Forward returns to it', async ({ page }) => {
    await openDashboard(page);
    const startHash = await page.evaluate(() => location.hash);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();

    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('bookmarks');
    // The failure this replaces: the hash changed while the inbox stayed on
    // screen, so the address bar and the view disagreed.
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(startHash);

    await page.goForward();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('inbox');
});

test('Back from a view reaches the bookmarks page, not a reverted hash', async ({ page }) => {
    await openDashboard(page);
    const startHash = await page.evaluate(() => location.hash);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();

    await page.goBack();

    // Measured before this change: the hash went back to #inbox and the view
    // never moved, because the numeric-hash branch called restoreInboxHash().
    await expect.poll(() => page.evaluate(() => location.hash),
        { timeout: 10_000 }).toBe(startHash);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView))
        .toBe('bookmarks');
    await expect(page.locator('.inbox-layout')).toHaveCount(0);
});

test('Back walks views, not the filters set inside them', async ({ page }) => {
    await openDashboard(page);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    for (const f of ['unread', 'all', 'unread']) {
        await page.locator(`[data-inbox-filter="${f}"]`).click();
        await expect(page.locator(`[data-inbox-filter="${f}"]`)).toHaveClass(/is-active/);
    }
    // Through the module rather than a header button: which buttons the header
    // shows depends on settings, and this test is about history, not chrome.
    await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('health');

    // One step back is the inbox, not the previous filter.
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('inbox');
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('bookmarks');
});

test('config sections are not history steps', async ({ page }) => {
    await openDashboard(page);
    const startHash = await page.evaluate(() => location.hash);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('config');

    const afterOpen = await page.evaluate(() => history.length);
    for (const section of ['appearance', 'behavior']) {
        await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
        await expect.poll(() => page.evaluate(() => location.hash)).toContain(section);
    }
    const afterSections = await page.evaluate(() => history.length);

    // A config visit is a rummage through sections. Making each one a step
    // turns one Back into six.
    expect(afterSections - afterOpen, 'a section change added a history entry').toBe(0);

    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('bookmarks');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(startHash);
});

test('stripping deep-link params keeps the history state', async ({ page }) => {
    await openDashboard(page);

    const kept = await page.evaluate(() => {
        // stripDeepLinkParams returns early when there is nothing to strip, so
        // give it a param to remove or it would pass without reaching its write.
        history.replaceState({ marker: 'keep-me' }, '', `${location.pathname}?page=1${location.hash}`);
        window.DashboardDeepLink.stripDeepLinkParams();
        return { marker: history.state?.marker || null, search: location.search };
    });

    expect(kept.marker, 'stripDeepLinkParams replaced the state with null').toBe('keep-me');
    expect(kept.search, 'the deep-link param was not stripped').not.toContain('page=1');
});

test('one Back routes the address once, not twice', async ({ page }) => {
    await openDashboard(page);

    /*
     * A popstate that changes the hash fires hashchange too, so one press
     * routed the same address twice. That is not merely wasteful:
     * requestPageNavigation awaits confirmInlineEditBeforeNavigation() before
     * it changes the view, so with an unsaved edit open the second run reached
     * the confirmation again and asked twice for one Back.
     */
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        window.__routes = [];
        const original = d.routeFromHash.bind(d);
        d.routeFromHash = function () {
            window.__routes.push(window.DashboardHistory.isRestoring());
            return original();
        };
    });

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => { window.__routes = []; });

    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 10_000 }).toBe('bookmarks');

    const routes = await page.evaluate(() => window.__routes);
    expect(routes.length, `one Back routed the address ${routes.length} times`).toBe(1);
    // And the one run is the guarded one: an unguarded route lets the opener's
    // own URL write push a fresh entry, which is Back walking in place.
    expect(routes[0], 'the surviving route ran outside the restore guard').toBe(true);
});

test('a bare hash assignment is not treated as Back', async ({ page }) => {
    await openDashboard(page);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();

    // `location.hash = '#1'` fires popstate with exactly the shape a real Back
    // has -- same event, same null state. Only the entry being landed on tells
    // them apart, and a stale numeric hash must not pull you out of the inbox.
    await page.evaluate(() => { window.location.hash = '#1'; });

    await expect(page.locator('.inbox-layout')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#inbox');
});
