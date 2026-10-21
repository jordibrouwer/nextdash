// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Glances: one tile that reads one machine. Drawn with a stubbed answer in the
 * shape the server sends (widgets_glances.go, which has the Go tests for the
 * Glances half).
 *
 * What these pin is the part the reader sees: one column is terse and two
 * columns say more, a reading the machine did not send is a dash and never a
 * zero, and a failure is a line of words with no meters.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const METERS = {
    status: 'up', cpu: 23, mem: 61, swap: 12, disk: 88.4, temp: 54, uptime: 41 * 86400,
    load: [1.2, 0.9, 0.8], net: 4_100_000, netUp: 250_000, host: 'nas', os: 'Debian 12',
    fs: [{ name: '/', pct: 88.4 }, { name: '/mnt/disk3', pct: 93 }],
    temps: [{ name: 'Package id 0', value: 54 }, { name: 'nvme0', value: 71 }],
    spark: Array.from({ length: 40 }, (_, i) => 10 + (i % 7) * 5),
};

function answer(meters = METERS) {
    return { fetchedAt: Date.now(), libraries: [], items: [
        { id: 'glances', title: meters.host || 'nas', kind: 'system', openUrl: 'http://glances.example:61208', meters }] };
}

async function draw(page, { result, config = {}, width = 320 }) {
    await page.evaluate(async ({ result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        const realNext = window.nextDashFetch;
        const stub = async (url, ...rest) => (String(url).includes('/api/widgets/glances')
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        window.fetch = stub;
        if (realNext) window.nextDashFetch = stub;
        document.getElementById('glances-test')?.remove();
        const host = document.createElement('div');
        host.id = 'glances-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.glances(body, { id: `w_glances_${width}`, type: 'glances', config }, d);
        } finally {
            window.fetch = realFetch;
            if (realNext) window.nextDashFetch = realNext;
            delete d._widgetMedia;
        }
    }, { result, config, width });
    return page.locator('#glances-test');
}

test.describe('the Glances tile', () => {
    test('narrow tile draws cpu ram disk bars and one text line', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 320 });
        await expect(tile.locator('.glances-bar:visible')).toHaveCount(3);
        // The disk bar is the fullest filesystem, not the root's own.
        await expect(tile.locator('.glances-bar[data-meter="disk"]:visible')).toContainText('93');
        await expect(tile.locator('.glances-bar[data-meter="disk"] .media-meter')).toHaveAttribute('data-tone', 'bad');
        const line = tile.locator('.glances-line:visible');
        await expect(line).toHaveCount(1);
        await expect(line).toContainText('54');
        await expect(line).toContainText('1.2');
        await expect(line).toContainText('MB/s');
        await expect(tile.locator('.glances-spark')).toBeHidden();
        await expect(tile.locator('.glances-fs:visible')).toHaveCount(0);
    });

    test('wide tile adds swap, load, filesystems, net up, temps and sparkline', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 680 });
        await expect(tile.locator('.glances-head:visible')).toContainText('nas');
        await expect(tile.locator('.glances-head:visible')).toContainText('Debian 12');
        await expect(tile.locator('.glances-bar:visible')).toHaveCount(4);
        await expect(tile.locator('.glances-bar[data-meter="swap"]:visible')).toContainText('12');
        await expect(tile.locator('.glances-bar[data-meter="load"]:visible')).toContainText('1.2');
        await expect(tile.locator('.glances-fs:visible')).toHaveCount(2);
        await expect(tile.locator('.glances-fs:visible').first()).toContainText('/mnt/disk3');
        await expect(tile.locator('.glances-net:visible')).toContainText('KB/s');
        await expect(tile.locator('.glances-temp:visible')).toHaveCount(2);
        await expect(tile.locator('.glances-temp:visible').first()).toContainText('71');
        await expect(tile.locator('.glances-spark-bar')).toHaveCount(40);
        await expect(tile.locator('.glances-spark')).toBeVisible();

        const without = await draw(page, { result: answer({ ...METERS, spark: undefined }), width: 680 });
        await expect(without.locator('.glances-spark')).toHaveCount(0);
    });

    test('a sensor with its own lines is toned by them', async ({ page }) => {
        await open(page);
        const meters = { ...METERS, temps: [{ name: 'nvme0', value: 60, warn: 55, crit: 80 }, { name: 'cpu', value: 72 }] };
        const tile = await draw(page, { result: answer(meters), width: 680 });
        await expect(tile.locator('.glances-temp[data-tone="warn"]')).toHaveCount(2);
        const cool = await draw(page, { result: answer({ ...METERS, temps: [{ name: 'cpu', value: 60 }] }), width: 680 });
        await expect(cool.locator('.glances-temp[data-tone]')).toHaveCount(0);
    });

    test('the meters setting chooses the bars', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { meters: ['cpu'] }, width: 320 });
        await expect(tile.locator('.glances-bar:visible')).toHaveCount(1);
        await expect(tile.locator('.glances-bar[data-meter="cpu"]')).toHaveCount(1);
    });

    test('missing readings draw a dash', async ({ page }) => {
        await open(page);
        const sparse = { status: 'up', cpu: 10, mem: 20, host: 'pi' };
        let tile = await draw(page, { result: answer(sparse), width: 320 });
        const disk = tile.locator('.glances-bar[data-meter="disk"]:visible');
        await expect(disk).toContainText('–');
        await expect(disk.locator('.media-meter')).toHaveCount(0);
        await expect(tile.locator('.glances-line:visible')).toContainText('–');
        await expect(tile.locator('.glances-line:visible')).not.toContainText('0');

        tile = await draw(page, { result: answer(sparse), width: 680 });
        const swap = tile.locator('.glances-bar[data-meter="swap"]:visible');
        await expect(swap).toContainText('–');
        await expect(swap.locator('.media-meter')).toHaveCount(0);
        await expect(tile.locator('.glances-net:visible')).toContainText('–');
    });

    test('unreachable shows the error and no bars', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: { error: 'unreachable', items: [] }, width: 320 });
        await expect(tile).toContainText(/could not be reached/i);
        await expect(tile.locator('.glances-bar')).toHaveCount(0);
        await expect(tile.locator('.media-meter')).toHaveCount(0);
    });

    test('login refused is worded for a password', async ({ page }) => {
        await open(page);
        const refused = await draw(page, { result: { error: 'login refused', items: [] }, width: 320 });
        await expect(refused).toContainText('Glances refused that login.');
        const v4 = await draw(page, { result: { error: 'needs Glances 4', items: [] }, width: 320 });
        await expect(v4).toContainText('This tile needs Glances 4.');
        const gone = await draw(page, { result: { error: 'not available', items: [] }, width: 320 });
        await expect(gone).toContainText('Glances has no data for this tile.');
    });

    test('click opens #glances', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 680 });
        await tile.locator('.glances-head').click();
        await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#glances\/overview\?w=w_glances_680&p=\d+$/);
    });

    test('click open goes to the server address', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { window.__opened = null; window.open = (url) => { window.__opened = url; return null; }; });
        const tile = await draw(page, { result: answer(), config: { click: 'open', target: '_blank' }, width: 680 });
        await tile.locator('.glances-head').click();
        expect(await page.evaluate(() => window.__opened)).toBe('http://glances.example:61208');
    });
});
