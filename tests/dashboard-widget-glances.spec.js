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

    // The view's stylesheet loads on the same page; none of its rules may
    // reach the tile's rows (it once had its own .glances-bar, an 8 px track).
    test('tile rows keep their height beside the view stylesheet', async ({ page }) => {
        await open(page);
        // The views' sheets are fetched when a view opens; fetch them now.
        await page.evaluate(() => window.ViewStyles?.ensureViewStyles?.());
        expect(await page.evaluate(() => [...document.styleSheets].some((s) => {
            try { return [...s.cssRules].some((r) => r.selectorText === '.glances-disk-bar'); } catch { return false; }
        }))).toBe(true);
        for (const width of [320, 680]) {
            const tile = await draw(page, { result: answer(), width });
            const rows = tile.locator('.glances-bar:visible');
            await expect(rows.first()).toBeVisible();
            const heights = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
            expect(heights.length, `rows at ${width}`).toBeGreaterThan(0);
            // A row is a line of text (about 14 px); the view's track was 8.
            for (const h of heights) expect(h, `row height at ${width}`).toBeGreaterThanOrEqual(12);
            const label = await rows.first().locator('.glances-label').evaluate((e) => e.getBoundingClientRect().height);
            expect(label).toBeGreaterThanOrEqual(12);
        }
        const wide = await draw(page, { result: answer(), width: 680 });
        const fsHeights = await wide.locator('.glances-fs:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        expect(fsHeights.length).toBe(2);
        for (const h of fsHeights) expect(h).toBeGreaterThanOrEqual(12);
    });

    test('the tile and the view keep their own globals', async ({ page }) => {
        await open(page);
        expect(await page.evaluate(() => typeof window.DashboardGlancesTile?.draw)).toBe('function');
        expect(await page.evaluate(() => typeof window.DashboardGlancesTile?.LIMITS?.cpu)).toBe('object');
        // DashboardGlances is the view's class (loaded with the view), never the tile's drawing.
        expect(await page.evaluate(() => window.DashboardGlances === undefined || typeof window.DashboardGlances === 'function')).toBe(true);
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

    test('narrow with every meter ticked draws no swap bar, the three bars and the line', async ({ page }) => {
        await open(page);
        const all = ['cpu', 'mem', 'swap', 'disk', 'temp', 'load', 'net'];
        const tile = await draw(page, { result: answer(), config: { meters: all }, width: 320 });
        await expect(tile.locator('.glances-bar:visible')).toHaveCount(3);
        await expect(tile.locator('.glances-bar[data-meter="swap"]:visible')).toHaveCount(0);
        const line = tile.locator('.glances-line:visible');
        await expect(line).toContainText('54');
        await expect(line).toContainText('1.2');
        await expect(line).toContainText('MB/s');
    });

    test('narrow with two meters draws two bars and no line', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { meters: ['cpu', 'disk'] }, width: 320 });
        await expect(tile.locator('.glances-bar:visible')).toHaveCount(2);
        await expect(tile.locator('.glances-line')).toHaveCount(0);
    });

    test('narrow line drops an unticked part without stray separators', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { meters: ['cpu', 'mem', 'disk', 'temp', 'load'] }, width: 320 });
        const text = (await tile.locator('.glances-line:visible').textContent()) || '';
        expect(text).not.toContain('MB/s');
        expect(text.trim()).not.toMatch(/·\s*$/);
        expect(text).toContain('·');
    });

    test('wide with a list without swap draws no swap bar', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { meters: ['cpu', 'mem', 'load', 'disk', 'temp'] }, width: 680 });
        await expect(tile.locator('.glances-bar[data-meter="swap"]')).toHaveCount(0);
        await expect(tile.locator('.glances-bar[data-meter="cpu"]:visible')).toHaveCount(1);
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

/** Opens a fresh Glances widget in Config → Widgets and returns its panel. */
async function addInConfig(page) {
    await open(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    // Quickstart sweeps favicons on a fresh store and reopens Overview when it finishes.
    await page.waitForTimeout(6000);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
        await window.dashboardInstance.config.openConfigView('widgets');
    });
    await page.locator('[data-widget-catalogue]').click();
    await page.locator('.modal--widget-catalogue [data-widget-option="glances"]').first().click();
    await page.locator('.modal--widget-catalogue [data-widget-add="glances"]').click();
    await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]')).toBeFocused({ timeout: 10_000 });
    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const panel = page.locator(`[data-widget-detail="${index}"]`);
    await expect(panel).toBeVisible();
    return panel;
}

async function savedConfig(page) {
    return page.evaluate(async () => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const blocks = await (await send('/api/pages/1/blocks')).json();
        return (blocks.widgets || []).find((w) => w.type === 'glances')?.config ?? null;
    });
}

const SETUP = {
    connected: 'Glances 4.x',
    plugins: ['cpu', 'mem', 'fs'],
    filesystems: [{ name: '/' }, { name: '/mnt/disk3' }, { name: '/mnt/disk4' }],
};

test.describe('the Glances settings panel', () => {
    test('panel connects without a password and lists filesystems', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/glances/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETUP) });
        });
        const panel = await addInConfig(page);
        await panel.locator('[data-widget-setting="server"]').fill('http://glances.lan:61208');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Glances 4.x');
        expect(sent?.server).toBe('http://glances.lan:61208');
        expect(sent?.draftCredential).toBeUndefined();
        const boxes = panel.locator('[data-widget-setting="filesystems"]');
        await expect(boxes).toHaveCount(3);
        await expect(boxes.nth(1)).toBeChecked();
    });

    // Save reads both boxes empty as "not signed in"; Connect must ask the same way.
    test('Connect with both boxes cleared sends no credential', async ({ page }) => {
        const sent = [];
        await page.route('**/api/widgets/glances/setup', async (route) => {
            sent.push(route.request().postDataJSON());
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETUP) });
        });
        const panel = await addInConfig(page);
        await panel.locator('[data-widget-setting="server"]').fill('http://glances.lan:61208');
        await panel.locator('[data-widget-auth="basicUser"]').fill('glances');
        await panel.locator('[data-widget-auth="secret"]').fill('glances-pass-0123');
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page))?.credentialId ?? null, { timeout: 15_000 }).not.toBeNull();
        // The panel has drawn itself again after the save, with the user filed.
        await expect(panel.locator('[data-widget-save]')).toBeDisabled();
        await expect(panel.locator('[data-widget-auth="basicUser"]')).toHaveValue('glances');

        // Both boxes emptied: Connect asks with no credential at all.
        await panel.locator('[data-widget-auth="basicUser"]').fill('');
        await panel.locator('[data-widget-auth="secret"]').fill('');
        await panel.locator('[data-widget-auth="secret"]').blur();
        await expect(panel.locator('[data-widget-save]')).toBeEnabled();
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Glances 4.x');
        const last = sent.at(-1);
        expect(last?.server).toBe('http://glances.lan:61208');
        expect(last?.credentialId).toBeUndefined();
        expect(last?.draftCredential).toBeUndefined();
    });

    test('panel connects with basic auth', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/glances/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETUP) });
        });
        const panel = await addInConfig(page);
        await panel.locator('[data-widget-setting="server"]').fill('http://glances.lan:61208');
        await panel.locator('[data-widget-auth="basicUser"]').fill('glances');
        await panel.locator('[data-widget-auth="secret"]').fill('glances-pass-0123');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Glances 4.x');
        expect(sent?.draftCredential).toMatchObject({ basicUser: 'glances', basicPassword: 'glances-pass-0123' });
    });

    test('panel shows "Glances 4 is needed" for a v3 host', async ({ page }) => {
        await page.route('**/api/widgets/glances/setup', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ error: 'needs Glances 4' }) });
        });
        const panel = await addInConfig(page);
        await panel.locator('[data-widget-setting="server"]').fill('http://glances.lan:61208');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Glances 4 is needed');
        await expect(panel.locator('[data-widget-setting="filesystems"]')).toHaveCount(0);
    });

    test('saved widget keeps meters and filesystems', async ({ page }) => {
        await page.route('**/api/widgets/glances/setup', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETUP) });
        });
        const panel = await addInConfig(page);
        await panel.locator('[data-widget-setting="server"]').fill('http://glances.lan:61208');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Glances 4.x');
        await panel.locator('[data-widget-setting="filesystems"][value="/mnt/disk4"]').uncheck();
        await panel.locator('[data-widget-setting="filesystems"][value="/"]').uncheck();
        await panel.locator('[data-widget-setting="meters"][value="swap"]').uncheck();
        await panel.locator('[data-widget-setting="meters"][value="net"]').uncheck();
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page))?.filesystems ?? null, { timeout: 15_000 })
            .toEqual(['/mnt/disk3']);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        const config = await savedConfig(page);
        expect(config.server).toBe('http://glances.lan:61208');
        expect(config.filesystems).toEqual(['/mnt/disk3']);
        expect(config.meters).toEqual(['cpu', 'mem', 'load', 'disk', 'temp']);
        expect(config.credentialId).toBeUndefined();
    });
});
