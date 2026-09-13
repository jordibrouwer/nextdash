// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One delta, two meanings.
 *
 * The app grew three of them: .dashboard-widget-stat-delta on a widget figure,
 * .dashboard-widget-trend-change on the trend tile, and .config-tile-delta in
 * config's statistics. Three names for one idea -- and, worse, they disagreed:
 * the first two read --status-success / --status-error, while config read
 * --accent-success and painted a fall in grey.
 *
 * Two of the three are one thing now: the widget figure and config's tile are
 * the same component, so their delta is .stat-tile-delta in both and cannot
 * drift by construction. The trend tile is still its own element with its own
 * layout rules, so what these tests hold is the part that can still drift --
 * the trend tile agreeing with the shared delta.
 *
 * That disagreement turns out to be right, so it is kept and made explicit
 * rather than flattened. A delta on a *state* carries direction: one more
 * broken bookmark is worse, so it is red. A delta on a *count* does not: one
 * fewer bookmark this week is smaller, not worse, and colouring it red would
 * be the app having an opinion nobody asked for.
 *
 * So: two modes, one set of rules. Directional deltas agree with each other
 * across every surface; neutral ones stay quiet.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // config-view.css rides in the lazy views bundle, so a config class read
    // from the dashboard resolves to whatever it inherits rather than to its
    // own rule. Open config, and wait for the styling to have landed rather
    // than for the markup that arrives a paint earlier.
    await page.waitForFunction(() => window.dashboardInstance?.config != null, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.waitForFunction(() => {
        const probe = document.createElement('span');
        probe.className = 'config-tile-delta';
        document.body.appendChild(probe);
        const styled = parseFloat(window.getComputedStyle(probe).marginLeft) > 0;
        probe.remove();
        return styled;
    }, null, { timeout: 20_000 });
}

/** The colour a class combination resolves to, read off a probe. */
const colourOf = (page, className) => page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.className = name;
    document.body.appendChild(probe);
    const value = window.getComputedStyle(probe).color;
    probe.remove();
    return value;
}, className);

test.describe('delta tones', () => {
    test('every directional delta agrees on better', async ({ page }) => {
        await openDashboard(page);

        const shared = await colourOf(page, 'stat-tile-delta stat-tile-delta--good');
        const trend = await colourOf(page, 'dashboard-widget-trend-change is-better');

        expect(trend, 'the trend tile disagrees on better').toBe(shared);
    });

    test('every directional delta agrees on worse', async ({ page }) => {
        await openDashboard(page);

        const shared = await colourOf(page, 'stat-tile-delta stat-tile-delta--bad');
        const trend = await colourOf(page, 'dashboard-widget-trend-change is-worse');

        expect(trend, 'the trend tile disagrees on worse').toBe(shared);
    });

    test('a count that moved is quiet, not bad news', async ({ page }) => {
        await openDashboard(page);

        const neutral = await colourOf(page, 'stat-tile-delta stat-tile-delta--neutral');
        const worse = await colourOf(page, 'stat-tile-delta stat-tile-delta--bad');
        const plain = await colourOf(page, 'stat-tile-delta');

        // A count going down is smaller, not worse: it must not borrow the
        // colour the app uses to say something is wrong.
        expect(neutral, 'a falling count was painted as bad news').not.toBe(worse);
        expect(neutral, 'the neutral delta is not the quiet one').toBe(plain);
    });
});
