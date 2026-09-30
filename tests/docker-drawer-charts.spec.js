// @ts-check
const { test, expect } = require('./fixtures');
const { mockDocker } = require('./helpers/docker-mock');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Resources tab: the figures now, and under them the last hour of each as
 * a chart. The hour comes from the server's sampler; when that is switched off
 * in Config → Containers the charts are not drawn at all.
 */

function hour(now = Date.now()) {
    const points = [];
    for (let i = 119; i >= 0; i -= 1) {
        points.push({ t: now - i * 30_000, cpu: i === 60 ? 38 : 2, mem: (100 + (i % 7)) * 1024 * 1024 });
    }
    return points;
}

async function openResources(page, stats) {
    await mockDocker(page);
    await page.route('**/api/docker/containers/*/stats**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(stats),
    }));
    await page.goto('/#docker/sonarr');
    await page.locator('[data-docker-drawer] [data-slp-tab="resources"]').click();
    await expect(page.locator('[data-docker-cpu]')).toContainText('3.2');
}

const NOW = { cpuPercent: 3.2, memoryUsed: 262144000, memoryLimit: 8589934592 };

test.describe('resource charts', () => {
    // Network and disk: rates from the newest sampled point, in the figures
    // and as two more charts of the hour.
    test('network and disk I/O, now and over the hour', async ({ page }) => {
        const MiB = 1024 * 1024;
        const history = hour().map((p, i, all) => (i === all.length - 1
            ? { ...p, netIn: 2 * MiB, netOut: 512 * 1024, diskRead: 0, diskWrite: 3 * MiB }
            : { ...p, netIn: 1024, netOut: 1024, diskRead: 0, diskWrite: 0 }));
        await openResources(page, { ...NOW, historyEnabled: true, history });
        await expect(page.locator('[data-docker-net]')).toHaveText('↓ 2.0 MiB/s · ↑ 0.5 MiB/s');
        await expect(page.locator('[data-docker-diskio]')).toHaveText('read 0 B/s · write 3.0 MiB/s');
        await expect(page.locator('[data-docker-chart="net"]')).toContainText('2.5 MiB/s');
        await expect(page.locator('[data-docker-chart="disk"] path.docker-chart-line')).toHaveCount(1);
    });

    test('history off: network and disk stay a dash', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: false, history: [] });
        await expect(page.locator('[data-docker-net]')).toHaveText('—');
        await expect(page.locator('[data-docker-diskio]')).toHaveText('—');
    });

    test('four charts of the last hour under the figures, each with its peak', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        const charts = page.locator('[data-docker-chart]');
        await expect(charts).toHaveCount(4);
        await expect(page.locator('[data-docker-chart="cpu"] path.docker-chart-line')).toHaveCount(1);
        await expect(page.locator('[data-docker-chart="mem"] path.docker-chart-line')).toHaveCount(1);
        await expect(page.locator('[data-docker-chart="cpu"]')).toContainText('38');
        // Under the figures, not above them.
        const figures = await page.locator('[data-docker-mem]').boundingBox();
        const first = await charts.first().boundingBox();
        expect(figures && first && first.y > figures.y).toBe(true);
    });

    test('the line spans the hour: oldest at the left, now at the right', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        const xs = await page.locator('[data-docker-chart="cpu"] path.docker-chart-line').evaluate((path) => {
            const d = path.getAttribute('d') || '';
            const nums = [...d.matchAll(/[ML]\s*([\d.]+)/g)].map((m) => Number(m[1]));
            return { first: nums[0], last: nums[nums.length - 1] };
        });
        expect(xs.first).toBeLessThan(5);
        expect(xs.last).toBeGreaterThan(295);
    });

    test('just started: says it is still collecting', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: [] });
        await expect(page.locator('[data-docker-chart]')).toHaveCount(0);
        await expect(page.locator('[data-docker-chart-note]')).toContainText('Collecting');
    });

    test('switched off: no charts, and where to switch it on', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: false, history: [] });
        await expect(page.locator('[data-docker-chart]')).toHaveCount(0);
        await expect(page.locator('[data-docker-chart-note]')).toContainText('Config');
    });

    test('Config → Containers has the switch, on by default', async ({ page }) => {
        await mockDocker(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('containers'); });
        await expect(page.getByLabel('Keep the last hour of CPU and memory')).toBeChecked();
    });
});

// Each beat is a stats call to the daemon, so a hidden tab makes none.
test('the figures are not polled while the tab is hidden', async ({ page }) => {
    let calls = 0;
    page.on('request', (req) => { if (/\/api\/docker\/containers\/[^/]+\/stats/.test(req.url())) calls += 1; });
    await openResources(page, NOW);
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    });
    const before = calls;
    await page.waitForTimeout(4500);
    expect(calls - before).toBe(0);
});
