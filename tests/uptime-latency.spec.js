// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Uptime widget can draw the response time of the last day beside a row.
 * The history is stubbed; what is pinned is what is made of it.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.DashboardWidgetUptime, null, { timeout: 20_000 });
}

test.describe('Uptime: response time', () => {
    test('hourly means of the timed checks, the last figure, nothing for a day with no timings', async ({ page }) => {
        await openDashboard(page);
        const now = Date.now();
        await page.route('**/api/health/history?url=*', (route) => {
            const url = decodeURIComponent(new URL(route.request().url()).searchParams.get('url'));
            const hour = 3600 * 1000;
            const samples = url.includes('quiet')
                ? [{ t: now - 2 * hour, u: true }, { t: now - hour, u: true }]
                : [
                    { t: now - 5 * hour + 600000, u: true, p: 100 }, { t: now - 5 * hour + 1200000, u: true, p: 300 },
                    { t: now - 3 * hour, u: true, p: 150 }, { t: now - hour, u: true, p: 90 },
                    { t: now - 2 * hour, u: false, p: 9000 },
                    { t: now - 30 * hour, u: true, p: 5000 },
                ];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ samples }) });
        });
        const out = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d._widgetLatency = new Map();
            const busy = await window.DashboardWidgetUptime.latencyFor(d, 'https://busy.example/');
            const quiet = await window.DashboardWidgetUptime.latencyFor(d, 'https://quiet.example/');
            const line = window.DashboardWidgetUptime.latencyLine(busy);
            return {
                points: busy.points.map((p) => Math.round(p.ms)),
                last: busy.last,
                quiet,
                text: line.textContent,
                polyline: line.querySelector('polyline')?.getAttribute('points').split(' ').length,
            };
        });
        // 5h ago: mean of 100 and 300; the failed check and the day-old one are left out.
        expect(out.points).toEqual([200, 150, 90]);
        expect(out.last).toBe(90);
        expect(out.quiet).toBeNull();
        expect(out.text).toBe('90 ms');
        expect(out.polyline).toBe(3);
    });

    test('tiles drawn again while the history is on its way share one request', async ({ page }) => {
        await openDashboard(page);
        let asked = 0;
        await page.route('**/api/health/history?url=*', async (route) => {
            asked += 1;
            await new Promise((r) => setTimeout(r, 200));
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ samples: [] }) });
        });
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d._widgetLatency = new Map();
            await Promise.all([1, 2, 3, 4].map(() => window.DashboardWidgetUptime.latencyFor(d, 'https://shared.example/')));
        });
        expect(asked).toBe(1);
    });

    test('is a setting the server keeps', async ({ page }) => {
        await openDashboard(page);
        const stored = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({ widgets: [{ type: 'uptime', config: { latency: true } }] }) });
            return (await (await fetch('/api/pages/1/blocks')).json()).widgets[0].config.latency;
        });
        expect(stored).toBe(true);
    });
});
