// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A tab nobody looks at keeps no clocks: no redraw, no weather call. The first
 * look after it comes back catches up.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.DashboardWidgets?.countdown, null, { timeout: 20_000 });
}

/** Make the page believe it is hidden or visible, and say so the way a browser does. */
async function setHidden(page, hidden) {
    await page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

test('a countdown tile does not redraw while hidden, and catches up on return', async ({ page }) => {
    await page.clock.install();
    await openDashboard(page);
    await page.evaluate(() => {
        const body = document.createElement('div');
        document.body.appendChild(body);
        window.__probeBody = body;
        window.__probeDraws = 0;
        new MutationObserver(() => { window.__probeDraws += 1; }).observe(body, { childList: true, subtree: true, characterData: true });
        window.DashboardWidgets.countdown(body, { id: 'probe', type: 'countdown', title: 'X', config: { date: '2030-01-01' } }, window.dashboardInstance);
        window.__probeDraws = 0;
    });
    await page.clock.runFor(130_000);
    const visibleDraws = await page.evaluate(() => window.__probeDraws);
    expect(visibleDraws).toBeGreaterThan(0);

    await setHidden(page, true);
    await page.evaluate(() => { window.__probeDraws = 0; });
    await page.clock.runFor(300_000);
    expect(await page.evaluate(() => window.__probeDraws)).toBe(0);

    await setHidden(page, false);
    expect(await page.evaluate(() => window.__probeDraws)).toBeGreaterThan(0);
});
