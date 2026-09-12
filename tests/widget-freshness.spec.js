// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A widget that polls says when it last looked.
 *
 * Seven widget types refresh on their own interval -- cpu every five seconds,
 * disks every minute, weather every half hour. Only the custom widget ever
 * said so. The rest show a figure with no age on it, and a cached number that
 * looks live is worse than a stale one that admits it.
 *
 * The element is not new: .dashboard-widget-asof has been in the stylesheet
 * since the custom widget landed. What is new is that every polled widget
 * fills it, from one shared builder rather than seven copies.
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

test.describe('widget freshness', () => {
    test('the shared builder renders an age, or nothing when there is none', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(() => {
            const utils = window.DashboardWidgetUtils;
            const dash = window.dashboardInstance;
            const withTime = utils.asOf(dash, Date.now());
            const withoutTime = utils.asOf(dash, 0);
            return {
                hasBuilder: typeof utils.asOf === 'function',
                className: withTime ? withTime.className : '',
                text: withTime ? withTime.textContent : '',
                whenUnknown: withoutTime,
            };
        });

        expect(result.hasBuilder, 'DashboardWidgetUtils.asOf is missing').toBe(true);
        expect(result.className).toContain('dashboard-widget-asof');
        expect(result.text.trim(), 'the age line came back empty').not.toBe('');

        // No timestamp means no line at all: an empty "as of" says less than
        // nothing, because it reads as a figure whose age is unknown.
        expect(result.whenUnknown, 'a widget with no fetch time still drew a line').toBeNull();
    });

    test('a stale figure marks itself', async ({ page }) => {
        await openDashboard(page);

        const tone = await page.evaluate(() => {
            const utils = window.DashboardWidgetUtils;
            const dash = window.dashboardInstance;
            // Older than the interval it was promised to refresh on.
            const line = utils.asOf(dash, Date.now() - 600_000, { intervalMs: 5_000 });
            return line.className;
        });

        expect(tone, 'a figure past its own interval did not say so')
            .toContain('dashboard-widget-asof--stale');
    });

    test('a fresh figure does not', async ({ page }) => {
        await openDashboard(page);

        const tone = await page.evaluate(() => {
            const utils = window.DashboardWidgetUtils;
            const dash = window.dashboardInstance;
            const line = utils.asOf(dash, Date.now(), { intervalMs: 5_000 });
            return line.className;
        });

        expect(tone).not.toContain('dashboard-widget-asof--stale');
    });

    test('the cadence comes from the render core, not a second copy', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(() => {
            const utils = window.DashboardWidgetUtils;
            const dash = window.dashboardInstance;
            const widget = { type: 'cpu', config: {} };
            return {
                fromUtils: utils.refreshMs(widget, dash),
                fromCore: dash.renderCore.widgetPollSeconds(widget) * 1000,
                unpolled: utils.refreshMs({ type: 'health' }, dash),
            };
        });

        expect(result.fromUtils, 'the two disagree on the cadence').toBe(result.fromCore);
        expect(result.fromUtils).toBeGreaterThan(0);
        // A widget that does not poll has no interval to be late against.
        expect(result.unpolled).toBe(0);
    });

    test('a system widget stamps when it read', async ({ page }) => {
        await openDashboard(page);

        const stamped = await page.evaluate(async () => {
            const dash = window.dashboardInstance;
            dash._widgetSystem = {};
            const data = await window.DashboardWidgetSystem
                .fetchMetrics(dash, 'cpu', { cacheKey: 'probe' });
            // Null when the endpoint is unavailable in this environment; the
            // stamp only has to be there when an answer is.
            return data === null ? 'unavailable' : typeof data._fetchedAt;
        });

        expect(['number', 'unavailable']).toContain(stamped);
    });
});
