// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A tour closed on this page stays closed when a settings read lands after it.
 *
 * The read can have left before the mark was saved; init() took it whole, and
 * the inbox tour opened again over the list now and then -- in use and in the
 * suite alike. Forgetting a tip on purpose still brings it back.
 */
test('a tip marked on this page outlives a stale settings read', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => !!window.DiscoverabilityState?.init, null, { timeout: 15_000 });
    const out = await page.evaluate(() => {
        const ds = window.DiscoverabilityState;
        ds.markTipSeen('probeTourV1', { persist: false });
        ds.init({ seenTips: [] });
        const kept = ds.hasSeenTip('probeTourV1');
        ds.forgetTip('probeTourV1', { persist: false });
        ds.init({ seenTips: [] });
        return { kept, forgotten: !ds.hasSeenTip('probeTourV1') };
    });
    expect(out).toEqual({ kept: true, forgotten: true });
});
