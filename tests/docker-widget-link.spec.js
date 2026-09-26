// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const { mockDocker } = require('./helpers/docker-mock');

/*
 * The Containers tile is a way in, not just a report: the whole tile opens
 * the Docker view, and when an image update is waiting the tile carries its
 * own link straight to that filter. Config's Docker block is the other half
 * of the same feature -- the schedule that keeps "N updates" honest even
 * when nobody has the view open.
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

/**
 * Draw the docker widget into a real, attached tile (modelled on
 * tests/widget-wide-columns.spec.js's drawAt), so the tile's own link can
 * actually be clicked rather than only inspected.
 */
function setupDockerWidget(page, { updates = 0 } = {}) {
    return page.evaluate(async (updates) => {
        document.querySelectorAll('.docker-link-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget docker-link-probe';
        host.setAttribute('data-widget-type', 'docker');
        host.style.cssText = 'width:340px;position:fixed;left:10px;top:10px;z-index:9999;';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        d._widgetSystem = {};
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes('/api/system/metrics')
            ? new Response(JSON.stringify({
                docker: {
                    available: true, running: 2, stopped: 1, paused: 0, unhealthy: 0,
                    total: 3, images: 5, updates, unhealthyNames: [], restartedNames: [],
                },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        try {
            await window.DashboardWidgets.docker(body, { id: 'probe-docker', type: 'docker', config: {} }, d);
        } finally {
            window.fetch = realFetch;
        }
    }, updates);
}

test.describe('docker widget link and config settings', () => {
    test('clicking the containers tile opens the docker view', async ({ page }) => {
        await mockDocker(page);
        await openDashboard(page);
        await setupDockerWidget(page, { updates: 2 });
        await expect(page.locator('[data-widget-type="docker"]')).toContainText('2 updates');
        await page.locator('[data-widget-type="docker"] [data-docker-open]').click();
        await expect(page).toHaveURL(/#docker/);
    });

    test('updates line opens the updates filter', async ({ page }) => {
        await mockDocker(page);
        await openDashboard(page);
        await setupDockerWidget(page, { updates: 1 });
        await expect(page.locator('[data-widget-type="docker"]')).toContainText('1 update');
        await page.locator('[data-docker-updates-link]').click();
        // The shell renders filters as tabs (aria-selected), not toggle
        // buttons -- confirmed against the real markup rather than the plan's
        // guess at it.
        await expect(page.locator('[data-docker-filter="updates"][aria-selected="true"]')).toBeVisible();
    });

    test('config saves the update interval', async ({ page }) => {
        await mockDocker(page);
        await openDashboard(page);
        await page.goto('/#config/widgets');
        await page.waitForSelector('[data-setting="dockerUpdateInterval"]');
        const select = page.locator('[data-setting="dockerUpdateInterval"]');
        await select.selectOption('12h');
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerUpdateInterval)
            .toBe('12h');
        // The e2e data dir is shared across specs -- leave the setting as found.
        await select.selectOption('off');
        await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).dockerUpdateInterval)
            .toBe('off');
    });
});

module.exports = { setupDockerWidget, openDashboard };
