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
        await expect(page.locator('[data-docker-chart="disk"] canvas')).toHaveCount(1);
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
        await expect(page.locator('[data-docker-chart="cpu"] canvas')).toHaveCount(1);
        await expect(page.locator('[data-docker-chart="mem"] canvas')).toHaveCount(1);
        await expect(page.locator('[data-docker-chart="cpu"]')).toContainText('38');
        // Under the figures, not above them.
        const figures = await page.locator('[data-docker-mem]').boundingBox();
        const first = await charts.first().boundingBox();
        expect(figures && first && first.y > figures.y).toBe(true);
    });

    test('the line spans the hour: oldest at the left, now at the right', async ({ page }) => {
        const points = hour();
        await openResources(page, { ...NOW, historyEnabled: true, history: points });
        const chart = page.locator('[data-docker-chart="cpu"] .nd-chart');
        await chart.focus();
        // Home is the oldest point, End is now.
        await page.keyboard.press('Home');
        const oldest = await chart.locator('.nd-chart-readout').textContent();
        await page.keyboard.press('End');
        const newest = await chart.locator('.nd-chart-readout').textContent();
        const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        expect(oldest).toContain(time(points[0].t));
        expect(newest).not.toBe(oldest);
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

/*
 * The charts are uPlot through NdChart: a hover says the value in the chart
 * being pointed at, the others follow with their cursor only; the arrow keys
 * read the points aloud; a drag or + zooms and 0 puts it back; a screen reader
 * gets a table; a theme change draws them again; and without uPlot the plain
 * charts are still there.
 */
test.describe('the charts can be read', () => {
    test('hover shows the value in the pointed chart only, the others follow', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        // The four are drawn once uPlot has arrived, a moment after the figures.
        await expect(page.locator('[data-docker-chart] canvas')).toHaveCount(4);
        // A pointer needs the page to itself: What's new or the tour can open
        // over a fresh profile.
        await dismissBlockingOverlays(page);
        // hover() waits for the drawer to finish sliding in; a position read
        // mid-slide pointed at where the chart was going to be.
        await page.locator('[data-docker-chart="cpu"] .u-over').hover();
        await expect(page.locator('[data-docker-chart="cpu"] .nd-chart-tip')).toBeVisible();
        await expect(page.locator('[data-docker-chart="cpu"] .nd-chart-tip')).toContainText('%');
        await expect(page.locator('[data-docker-chart="mem"] .nd-chart-tip')).toBeHidden();
        // The memory chart's cursor moved with it.
        const memCursor = await page.locator('[data-docker-chart="mem"] .u-cursor-x').evaluate((el) => getComputedStyle(el).transform);
        expect(memCursor).not.toBe('none');
    });

    test('the arrow keys move along the points and say each one', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        const chart = page.locator('[data-docker-chart="cpu"] .nd-chart');
        await expect(chart).toHaveAttribute('aria-label', /CPU.*peak/);
        await chart.focus();
        const readout = chart.locator('.nd-chart-readout');
        await expect(readout).not.toBeEmpty();
        const at = await readout.textContent();
        await page.keyboard.press('ArrowLeft');
        await expect(readout).not.toHaveText(at || '');
    });

    test('+ zooms in on the hour and 0 puts the whole hour back', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        const chart = page.locator('[data-docker-chart="cpu"] .nd-chart');
        const readout = chart.locator('.nd-chart-readout');
        await chart.focus();
        // Home reads the first point in view: the start of the hour, until
        // a zoom around now leaves the start out of view.
        await page.keyboard.press('Home');
        const oldest = await readout.textContent();
        await page.keyboard.press('End');
        await page.keyboard.press('+');
        await page.keyboard.press('Home');
        await expect(readout).not.toHaveText(oldest || '');
        await page.keyboard.press('0');
        await page.keyboard.press('Home');
        await expect(readout).toHaveText(oldest || '');
    });

    test('a screen reader gets the hour as a table', async ({ page }) => {
        const points = hour();
        await openResources(page, { ...NOW, historyEnabled: true, history: points });
        // 120 sampled points and the figure now.
        await expect(page.locator('[data-docker-chart="cpu"] table.nd-chart-table tbody tr')).toHaveCount(points.length + 1);
    });

    test('a theme change draws the charts again in the new colours', async ({ page }) => {
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        const canvas = page.locator('[data-docker-chart="cpu"] canvas');
        await expect(canvas).toHaveCount(1);
        await canvas.evaluate((el) => { el.dataset.before = '1'; });
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('theme-changed')));
        await expect(page.locator('[data-docker-chart="cpu"] canvas')).toHaveCount(1);
        await expect(page.locator('[data-docker-chart="cpu"] canvas[data-before]')).toHaveCount(0);
    });

    test('without uPlot the plain charts are still drawn', async ({ page }) => {
        await page.route('**/vendor/uplot/**', (route) => route.abort());
        await openResources(page, { ...NOW, historyEnabled: true, history: hour() });
        await expect(page.locator('[data-docker-chart="cpu"] path.docker-chart-line')).toHaveCount(1, { timeout: 10_000 });
        await expect(page.locator('[data-docker-chart]')).toHaveCount(4);
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
