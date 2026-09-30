// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/*
 * A change from another tab that arrives while this tab is still applying the
 * last one was dropped: the drain afterwards reads this tab's sessionStorage,
 * which only the publishing tab writes to.
 */
test('a sync event that arrives mid-refresh is kept for the drain', async ({ page, context }) => {
    await open(page);
    const other = await context.newPage();
    await open(other);

    await other.evaluate(() => {
        const d = window.dashboardInstance;
        d._configReturnRefreshInFlight = true;
        try { sessionStorage.removeItem(d.pendingStructureSyncKey); } catch { /* ignore */ }
    });
    await page.evaluate(() => window.dashboardInstance.configSync.publishConfigSync('structure'));

    await expect.poll(() => other.evaluate(() => {
        const d = window.dashboardInstance;
        return sessionStorage.getItem(d.pendingStructureSyncKey);
    })).not.toBeNull();
    await other.evaluate(() => { window.dashboardInstance._configReturnRefreshInFlight = false; });
    await other.close();
});
