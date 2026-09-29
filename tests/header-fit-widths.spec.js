// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The header gives up its destinations only when they do not fit. It used to
 * measure the clock by the box it is drawn in -- the row's 1fr track, so the
 * sum always came out at exactly the row's width -- and a fraction of a pixel
 * decided: 1440px hid the buttons, 1452px did not. Walked across a range of
 * widths with room to spare, the destinations have to stay at every one.
 */
test('the destinations stay at every width with room for them', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout');
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pageNav != null);

    const widths = [1440, 1441];
    for (let w = 1100; w <= 1700; w += 13) widths.push(w);
    const hidden = [];
    for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.dashboardInstance.pageNav.fitHeaderZones());
        const state = await page.evaluate(() => ({
            fit: document.body.getAttribute('data-header-fit'),
            shown: getComputedStyle(document.querySelector('.section-controls .header-destinations')).display !== 'none',
        }));
        if (state.fit !== '0' || !state.shown) hidden.push(`${width}px: step ${state.fit}`);
    }
    expect(hidden).toEqual([]);
});
