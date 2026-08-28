// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The uptime tile fills itself, without a trip through the health view.
 *
 * It read the full report, which is loaded when Health is opened and never
 * before — so a tile added to the dashboard said "Open Health once to fill this
 * in" until the reader went and did that, a chore invented by where the data
 * happened to be loaded rather than by anything about uptime. The badge's own
 * `?view=facts` request now carries what the tile draws, per monitored row.
 */

async function dashboardWithAMonitor(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
            name: 'Watched', url: 'http://127.0.0.1:9/watched', checkStatus: true, monitor: true } }) });
        await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({
            widgets: [{ type: 'uptime', title: 'Uptime' }] }) });
        // The report is cached for minutes; this test wants its own.
        await f('/api/bookmark-health?view=facts&refresh=1');
    });
    // A fresh load, so nothing but the badge's own request has run.
    await page.reload({ waitUntil: 'networkidle' });
}

test.describe('the uptime tile on a dashboard that has never opened Health', () => {
    test('draws its monitored row from the badge request alone', async ({ page }) => {
        await dashboardWithAMonitor(page);

        // The health view was never opened, so the rows the tile used to insist
        // on — report.issues — are not in hand.
        expect(await page.evaluate(() => Boolean(
            window.dashboardInstance?.healthReport?.issues
            || window.dashboardInstance?.health?.report?.issues))).toBe(false);

        const tile = page.locator('.dashboard-widget[data-widget-type="uptime"]');
        await expect(tile).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => tile.innerText(), { timeout: 20_000 }).toContain('127.0.0.1');
        // And the sentence that used to stand in for the row is gone.
        expect(await tile.innerText()).not.toContain('Open Health');
    });

    test('the facts response carries the row a monitor with no samples has', async ({ page }) => {
        await dashboardWithAMonitor(page);

        const row = await page.evaluate(async () => {
            const res = await fetch('/api/bookmark-health?view=facts');
            const data = await res.json();
            return (data.rows || []).find((r) => String(r.url).includes('/watched')) || null;
        });
        // No samples, no certificate, no failure — the shape the row filter used
        // to drop, and the bookmark the reader just asked to watch.
        expect(row).not.toBe(null);
        expect(row.monitor).toBe(true);
    });

    test('reads the same row through HealthFacts as the full report gives', async ({ page }) => {
        await dashboardWithAMonitor(page);

        const facts = await page.evaluate(() => {
            window.HealthFacts.remember({
                summary: {},
                rows: [{
                    url: 'https://watched.example/', monitor: true,
                    uptime7d: 0.98, uptime7dSamples: 300, downSince: 1234, heartbeat: 'udx.',
                }],
            });
            return window.HealthFacts.get('https://watched.example/');
        });

        expect(facts.uptime7d).toBeCloseTo(0.98, 4);
        expect(facts.downSince).toBe(1234);
        // One letter per bucket on the wire, the states the sparkline colours by
        // in hand — the same list the full report's buckets reduce to.
        expect(facts.heartbeat).toEqual(['up', 'down', 'degraded', 'empty']);
    });
});
