// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The refresh clock, widened past the custom widget.
 *
 * The machinery was written for the one widget that talks to a service of the
 * reader's own, and gated to it by name. A processor reading is the same shape
 * of problem -- a figure that is only true for a moment -- so the gate becomes
 * a table of which types keep a clock and how fast.
 *
 * What is pinned here is that widening it did not loosen it: still one clock
 * per tile however often it is redrawn, still nothing for a tile that draws
 * from data the dashboard already holds, and the custom widget's own cadence
 * untouched.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** The render core, wherever this build keeps it. */
function core(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const c = d.renderCore || d;
        return typeof c.startWidgetTimer === 'function';
    });
}

test.describe('the widget refresh clock', () => {
    test('a polled type gets one, a passive type does not', async ({ page }) => {
        await openDashboard(page);
        expect(await core(page)).toBe(true);

        const counts = await page.evaluate(() => {
            const c = window.dashboardInstance.renderCore || window.dashboardInstance;
            c.stopWidgetTimers();
            c.startWidgetTimer({ id: 'w_cpu1', type: 'cpu', config: { refreshSeconds: 5 } });
            const polled = c.widgetTimerCount();
            // Health draws from figures the dashboard already has; a clock on
            // it would redraw the same numbers for ever.
            c.startWidgetTimer({ id: 'w_health1', type: 'health', config: {} });
            const afterPassive = c.widgetTimerCount();
            c.stopWidgetTimers();
            return { polled, afterPassive };
        });

        expect(counts.polled).toBe(1);
        expect(counts.afterPassive).toBe(1);
    });

    test('one tile keeps one clock however often it is drawn', async ({ page }) => {
        await openDashboard(page);

        const count = await page.evaluate(() => {
            const c = window.dashboardInstance.renderCore || window.dashboardInstance;
            c.stopWidgetTimers();
            const widget = { id: 'w_cpu2', type: 'cpu', config: { refreshSeconds: 10 } };
            // A repaint, a drag ending, a figure arriving: all redraws.
            c.startWidgetTimer(widget);
            c.startWidgetTimer(widget);
            c.startWidgetTimer(widget);
            const total = c.widgetTimerCount();
            c.stopWidgetTimers();
            return total;
        });

        expect(count).toBe(1);
    });

    test('each type has its own floor, and custom keeps its own field', async ({ page }) => {
        await openDashboard(page);

        const seconds = await page.evaluate(() => {
            const c = window.dashboardInstance.renderCore || window.dashboardInstance;
            return {
                cpuAsked: c.widgetPollSeconds({ type: 'cpu', config: { refreshSeconds: 30 } }),
                // Below the floor is clamped up to it...
                cpuFloor: c.widgetPollSeconds({ type: 'cpu', config: { refreshSeconds: 0.2 } }),
                // ...while nothing stored at all, or a nonsense value, means
                // the default rather than the fastest the floor would allow.
                cpuDefault: c.widgetPollSeconds({ type: 'cpu', config: {} }),
                cpuZero: c.widgetPollSeconds({ type: 'cpu', config: { refreshSeconds: 0 } }),
                // ttl, not refreshSeconds, and a 30s floor of its own: that
                // field is a cache expiry as well as a cadence.
                custom: c.widgetPollSeconds({ type: 'custom', config: { ttl: 5 } }),
                passive: c.widgetPollSeconds({ type: 'health', config: {} }),
            };
        });

        expect(seconds.cpuAsked).toBe(30);
        // One second: below that the delta between two /proc reads is noise.
        expect(seconds.cpuFloor).toBe(1);
        expect(seconds.cpuDefault).toBeGreaterThanOrEqual(1);
        expect(seconds.cpuZero).toBe(seconds.cpuDefault);
        expect(seconds.custom).toBe(30);
        expect(seconds.passive).toBe(0);
    });

    test('the custom widget still keeps exactly one clock', async ({ page }) => {
        await openDashboard(page);

        const kept = await page.evaluate(() => {
            const c = window.dashboardInstance.renderCore || window.dashboardInstance;
            c.stopCustomWidgetTimers();
            c.startCustomWidgetTimer({ id: 'w_c1', type: 'custom', config: { ttl: 60 } });
            const n = c.customWidgetTimerCount();
            c.stopCustomWidgetTimers();
            return n;
        });

        expect(kept).toBe(1);
    });

    /*
     * The tile is redrawn by the clock, not merely re-fetched: the cached
     * reading has to be dropped or the tile would draw the same figure for ever.
     */
    test('a beat drops the cached reading and draws again', async ({ page }) => {
        await openDashboard(page);

        let served = 0;
        await page.route('**/api/system/metrics**', (route) => {
            served += 1;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    cpu: { available: true, percent: served * 10, load1: 0.07, load5: 0.15, load15: 0.11, cores: 4 },
                }),
            });
        });

        const out = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const c = d.renderCore || d;
            document.querySelectorAll('.poll-probe').forEach((n) => n.remove());

            // A tile on the page, the way the clock expects to find one.
            const block = document.createElement('div');
            block.className = 'dashboard-widget poll-probe';
            block.setAttribute('data-widget-id', 'w_cpu9');
            block.style.cssText = 'width:400px;position:fixed;left:10px;top:10px;z-index:9999;';
            const body = document.createElement('div');
            body.className = 'dashboard-widget-body';
            block.appendChild(body);
            document.body.appendChild(block);

            const widget = { id: 'w_cpu9', type: 'cpu', config: { refreshSeconds: 1 } };
            d._widgetSystem = {};
            await window.DashboardWidgets.cpu(body, widget, d);
            const first = body.textContent.trim();

            // One beat by hand: no waiting on a real second.
            await c.tickWidget(widget);
            const second = body.textContent.trim();

            block.remove();
            return { first, second };
        });

        // The figure moved, which it cannot do if the cache is never cleared.
        expect(out.first).not.toBe(out.second);
    });
});
