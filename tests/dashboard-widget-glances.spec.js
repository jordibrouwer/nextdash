// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The Glances widget: one host on the dashboard, from nextDash's own record
 * (/api/glances/hosts and /api/glances/history), drawn with stubbed answers.
 *
 * What these pin is what the reader sees: the meters or the processor graph, a
 * host that does not answer saying so and never printing the numbers it had,
 * and a way into the Glances page on that host.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const ROWS = [
    { id: 'main', name: 'Home', configured: true, paused: false, level: 'ok', ok: true, at: Date.now() - 5000, lastOk: Date.now() - 5000, cpu: 22, mem: 61, disk: 91, temp: 54 },
    { id: 'nas', name: 'NAS', configured: true, paused: false, level: 'unknown', ok: false, at: Date.now() - 1000, lastOk: Date.now() - 3 * 3600 * 1000, cpu: 95, mem: 95, disk: 95, temp: 90 },
    { id: 'pi', name: 'Pi', configured: false, paused: false, level: 'unknown', ok: false, at: 0, lastOk: 0, cpu: null, mem: null, disk: null, temp: null },
];

async function draw(page, { config = {}, rows = ROWS }) {
    await page.evaluate(async ({ config, rows }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.__glancesCalls = [];
        window.fetch = async (url, ...rest) => {
            const u = String(url);
            if (u.includes('/api/glances/')) window.__glancesCalls.push(u);
            if (u.includes('/api/glances/hosts')) return new Response(JSON.stringify({ hosts: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            if (u.includes('/api/glances/history')) {
                const now = Date.now();
                return new Response(JSON.stringify({ series: { cpu: Array.from({ length: 20 }, (_, i) => [now - (20 - i) * 180000, 10 + i * 2]) } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(url, ...rest);
        };
        document.getElementById('glances-test')?.remove();
        const host = document.createElement('div');
        host.id = 'glances-test';
        host.style.width = '320px';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.glances(body, { id: 'w_glances_test', type: 'glances', config }, d);
        } finally {
            window.fetch = realFetch;
        }
    }, { config, rows });
    const calls = await page.evaluate(() => window.__glancesCalls);
    return { tile: page.locator('#glances-test'), calls };
}

test.describe('the Glances widget', () => {
    test('meters: the host, its state, and three bars with their figures', async ({ page }) => {
        await open(page);
        const { tile } = await draw(page, { config: {} });
        await expect(tile).toContainText('Home');
        await expect(tile).toContainText('Healthy');
        await expect(tile).toContainText('22%');
        await expect(tile).toContainText('61%');
        await expect(tile).toContainText('91%');
        await expect(tile.locator('.dashboard-widget-meter')).toHaveCount(3);
        await expect(tile.locator('.dashboard-widget-meter-fill--bad, .dashboard-widget-meter-fill--warn')).toHaveCount(1);
        await expect(tile.locator('a.dashboard-widget-glances-open')).toHaveAttribute('href', '#glances/overview');
    });

    test('graph: the processor, with its last hour behind it', async ({ page }) => {
        await open(page);
        const { tile, calls } = await draw(page, { config: { style: 'graph' } });
        await expect(tile).toContainText('22%');
        await expect(tile.locator('svg.dashboard-widget-glances-spark path')).toHaveCount(1);
        await expect(tile).toContainText('last hour');
        expect(calls.some((c) => c.includes('/api/glances/history') && c.includes('series=cpu'))).toBe(true);
    });

    test('another host is chosen by its id, and the link goes to that host', async ({ page }) => {
        await open(page);
        const { tile, calls } = await draw(page, { config: { host: 'nas', style: 'graph' } });
        await expect(tile).toContainText('NAS');
        await expect(tile.locator('a.dashboard-widget-glances-open')).toHaveAttribute('href', '#glances/overview?host=nas');
        // A host that does not answer is not asked for a graph, and shows none of the numbers it had.
        await expect(tile).toContainText('Not answering since');
        await expect(tile).not.toContainText('95%');
        expect(calls.some((c) => c.includes('/api/glances/history'))).toBe(false);
    });

    test('a host without an address, one that is not there, and no Glances at all say so', async ({ page }) => {
        await open(page);
        let { tile } = await draw(page, { config: { host: 'pi' } });
        await expect(tile).toContainText('No address yet');
        ({ tile } = await draw(page, { config: { host: 'gone' } }));
        await expect(tile).toContainText('not in Config');
        // A host not read yet is waiting, not away.
        ({ tile } = await draw(page, { config: {}, rows: [{ ...ROWS[0], at: 0, lastOk: 0, ok: false, level: 'unknown', cpu: null, mem: null, disk: null }] }));
        await expect(tile).toContainText('Waiting for the first reading');
        await expect(tile).not.toContainText('Not answering');
        ({ tile } = await draw(page, { config: {}, rows: [] }));
        await expect(tile).toContainText('Glances is not set up');
    });

    test('Config offers the Glances widget, with the hosts to pick from', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: (Config?.WIDGET_TYPES || []).includes('glances'),
                fields: (Config?.WIDGET_SETTINGS?.glances || []).map((f) => f.key),
            };
        });
        expect(state.offered).toBe(true);
        expect(state.fields).toEqual(['host', 'style', 'refreshSeconds']);
    });
});
