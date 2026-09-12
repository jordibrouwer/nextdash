// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One delta, not two.
 *
 * A figure that moved and says which way is the same idea wherever it appears,
 * and the app had grown two of them: .dashboard-widget-trend-change on the
 * trend tile, with is-better / is-worse / is-level, and a second one added to
 * the shared stat grid with --good / --bad. Same meaning, two names, two sets
 * of colours to keep in step.
 *
 * They are one component now. The trend tile keeps its own class so its
 * layout rules still find it, but the tones come from the shared delta -- so
 * a change to what "better" looks like lands in both places at once.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.DashboardWidgetUtils != null, null, { timeout: 20_000 });
}

/** The colour a class resolves to, read off a probe in the document. */
const colourOf = (page, className) => page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.className = name;
    document.body.appendChild(probe);
    const value = window.getComputedStyle(probe).color;
    probe.remove();
    return value;
}, className);

test.describe('one delta', () => {
    test('better means the same colour on both tiles', async ({ page }) => {
        await openDashboard(page);

        const shared = await colourOf(page, 'dashboard-widget-stat-delta dashboard-widget-stat-delta--good');
        const trend = await colourOf(page, 'dashboard-widget-trend-change is-better');

        expect(trend, 'the trend tile has its own idea of "better"').toBe(shared);
    });

    test('worse means the same colour on both tiles', async ({ page }) => {
        await openDashboard(page);

        const shared = await colourOf(page, 'dashboard-widget-stat-delta dashboard-widget-stat-delta--bad');
        const trend = await colourOf(page, 'dashboard-widget-trend-change is-worse');

        expect(trend, 'the trend tile has its own idea of "worse"').toBe(shared);
    });

    test('and unchanged is quiet on both', async ({ page }) => {
        await openDashboard(page);

        const shared = await colourOf(page, 'dashboard-widget-stat-delta');
        const trend = await colourOf(page, 'dashboard-widget-trend-change is-level');

        expect(trend).toBe(shared);
    });
});
