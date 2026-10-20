// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Beszel: four tiles that read one hub -- every system, one system, only what
 * needs a look, and every disk. Drawn with a stubbed answer in the shape the
 * server sends (widgets_beszel.go, which has the Go tests for the hub half).
 *
 * What these pin is the part the reader sees: one column is terse and two
 * columns say more, and a system that is not up never shows a number, because
 * the numbers Beszel keeps for it are from before it went down.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const minute = 60_000;

function system(id, name, meters, extra = {}) {
    return { id, title: name, kind: 'system', openUrl: `http://beszel.example/system/${name}`,
        when: Date.now() - 14 * minute, meters, ...extra };
}

const UP_NAS = { status: 'up', cpu: 23, mem: 61, disk: 88.4, temp: 54, uptime: 41 * 86400, agent: '0.21.0',
    load: [1.2, 0.9, 0.8], net: 4_100_000, fs: [{ name: '/', pct: 88.4 }, { name: 'disk3', pct: 93 }] };
const UP_HTPC = { status: 'up', cpu: 91, mem: 55, disk: 40, temp: 71, uptime: 3 * 86400, agent: '0.21.0' };
const DOWN = { status: 'down' };

function systemsAnswer() {
    return {
        fetchedAt: Date.now(),
        libraries: [{ id: 's1', name: 'nas' }, { id: 's2', name: 'htpc' }, { id: 's3', name: 'vps' }],
        counts: { up: 2, down: 1, paused: 0, pending: 0 },
        items: [system('s1', 'nas', UP_NAS), system('s2', 'htpc', UP_HTPC), system('s3', 'vps', DOWN)],
    };
}

async function draw(page, { type, result, config = {}, width = 320 }) {
    await page.evaluate(async ({ type, result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        const realNext = window.nextDashFetch;
        const stub = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}`)
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        window.fetch = stub;
        if (realNext) window.nextDashFetch = stub;
        document.getElementById('beszel-test')?.remove();
        const host = document.createElement('div');
        host.id = 'beszel-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: `w_${type}_${width}`, type, config }, d);
        } finally {
            window.fetch = realFetch;
            if (realNext) window.nextDashFetch = realNext;
            delete d._widgetMedia;
        }
    }, { type, result, config, width });
    return page.locator('#beszel-test');
}

/** Opens a fresh widget of this type in Config → Widgets and returns its panel. */
async function addInConfig(page, type) {
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
    await page.locator(`.modal--widget-catalogue [data-widget-option="${type}"]`).first().click();
    await page.locator(`.modal--widget-catalogue [data-widget-add="${type}"]`).click();
    await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]')).toBeFocused({ timeout: 10_000 });
    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const panel = page.locator(`[data-widget-detail="${index}"]`);
    await expect(panel).toBeVisible();
    return panel;
}

async function savedConfig(page, type) {
    return page.evaluate(async (type) => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const blocks = await (await send('/api/pages/1/blocks')).json();
        return (blocks.widgets || []).find((w) => w.type === type)?.config ?? null;
    }, type);
}

const TYPES = ['beszel', 'beszel-system', 'beszel-attention', 'beszel-storage'];

test.describe('the Beszel widgets', () => {
    test('all four offered under System, each with a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async (types) => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const system = (Config?.WIDGET_TYPE_GROUPS || []).find(([group]) => group === 'system')?.[1] || [];
            return types.map((type) => ({
                type,
                offered: (Config?.WIDGET_TYPES || []).includes(type),
                grouped: system.includes(type),
                renderer: typeof window.DashboardWidgets?.[type],
            }));
        }, TYPES);
        for (const one of state) {
            expect(one, one.type).toMatchObject({ offered: true, grouped: true, renderer: 'function' });
        }
    });

    test('systems: one column names the heaviest meter, two columns draw them all', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { type: 'beszel', result: systemsAnswer(), width: 320 });
        const nasNarrow = tile.locator('.beszel-row').filter({ hasText: 'nas' });
        await expect(nasNarrow).toContainText(/disk 88/);
        await expect(tile.locator('.beszel-head')).toBeHidden();
        await expect(tile.locator('.media-meter:visible')).toHaveCount(0);

        tile = await draw(page, { type: 'beszel', result: systemsAnswer(), width: 680 });
        await expect(tile.locator('.beszel-head')).toBeVisible();
        // cpu, mem and disk for each of the two systems that are up.
        await expect(tile.locator('.media-meter:visible')).toHaveCount(6);
        await expect(tile.locator('.beszel-row').filter({ hasText: 'nas' }).locator('.media-meter[data-tone="warn"]:visible'))
            .toHaveCount(1);
    });

    test('a system that is down shows its state and never a number', async ({ page }) => {
        await open(page);
        // As Beszel keeps them: the readings from before it went down. The
        // server leaves them out; the tile must not draw them if one slips in.
        const stale = systemsAnswer();
        stale.items[2].meters = { status: 'down', cpu: 12, mem: 40, disk: 77, temp: 50 };
        for (const width of [320, 680]) {
            const tile = await draw(page, { type: 'beszel', result: stale, width });
            const vps = tile.locator('.beszel-row').filter({ hasText: 'vps' });
            await expect(vps, `${width}px`).toContainText(/down/i);
            await expect(vps.locator('.media-meter'), `${width}px`).toHaveCount(0);
            await expect(vps, `${width}px`).not.toContainText('%');
        }
    });

    test('one system: bars on one column, and the last hour beside them on two', async ({ page }) => {
        await open(page);
        const spark = Array.from({ length: 60 }, (_, i) => 10 + (i % 7) * 5);
        const result = { ...systemsAnswer(), counts: { up: 1, down: 0, paused: 0, pending: 0 },
            items: [system('s1', 'nas', { ...UP_NAS, spark }, { subtitle: 'agent 0.21.0' })] };

        let tile = await draw(page, { type: 'beszel-system', result, config: { system: 's1' }, width: 320 });
        await expect(tile.locator('.media-meter:visible')).toHaveCount(3);
        await expect(tile.locator('.beszel-spark')).toBeHidden();

        tile = await draw(page, { type: 'beszel-system', result, config: { system: 's1' }, width: 680 });
        await expect(tile.locator('.beszel-spark')).toBeVisible();
        await expect(tile.locator('.beszel-spark-bar')).toHaveCount(60);

        const down = { ...result, items: [system('s3', 'vps', DOWN)] };
        tile = await draw(page, { type: 'beszel-system', result: down, config: { system: 's3' }, width: 680 });
        await expect(tile).toContainText(/down/i);
        await expect(tile.locator('.media-meter')).toHaveCount(0);
        await expect(tile.locator('.beszel-spark')).toHaveCount(0);
    });

    test('attention: the problems with their reason, or one line when there are none', async ({ page }) => {
        await open(page);
        const result = { ...systemsAnswer(), items: [
            system('s3', 'vps', DOWN, { subtitle: 'down' }),
            system('s2', 'htpc', UP_HTPC, { subtitle: 'cpu 91% · 71°' }),
        ] };
        let tile = await draw(page, { type: 'beszel-attention', result, width: 320 });
        await expect(tile.locator('.beszel-counts')).toContainText('2');
        await expect(tile.locator('.beszel-counts')).toContainText('1');
        await expect(tile.locator('.beszel-reason:visible')).toHaveCount(0);

        tile = await draw(page, { type: 'beszel-attention', result, width: 680 });
        await expect(tile.locator('.beszel-reason:visible')).toHaveText(['down', 'cpu 91% · 71°']);

        const fine = { ...systemsAnswer(), counts: { up: 3, down: 0, paused: 0, pending: 0 }, items: [] };
        tile = await draw(page, { type: 'beszel-attention', result: fine, width: 320 });
        await expect(tile.locator('.beszel-fine')).toContainText('3');
    });

    test('storage: the fullest disk first, grouped per system when wide', async ({ page }) => {
        await open(page);
        const fs = (sys, name, path, pct) => ({ id: `${sys}:${path}`, title: name, subtitle: path, kind: 'fs',
            library: name, libraryId: sys, openUrl: `http://beszel.example/system/${name}`,
            meters: { status: 'up', disk: pct, fs: [{ name: path, pct }] } });
        const result = { ...systemsAnswer(), items: [
            fs('s1', 'nas', 'disk3', 93), fs('s1', 'nas', '/', 88.4), fs('s2', 'htpc', '/', 40),
        ] };
        let tile = await draw(page, { type: 'beszel-storage', result, width: 320 });
        const narrow = tile.locator('.beszel-disk:visible');
        await expect(narrow).toHaveCount(3);
        await expect(narrow.first()).toContainText('disk3');
        await expect(tile.locator('.beszel-group:visible')).toHaveCount(0);

        tile = await draw(page, { type: 'beszel-storage', result, width: 680 });
        await expect(tile.locator('.beszel-group:visible')).toHaveCount(2);
        await expect(tile.locator('.beszel-disk:visible')).toHaveCount(3);
    });

    test('one system: sign in with an email and a password, then choose the system', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/beszel/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                connected: '3 systems',
                systems: [{ id: 's1', name: 'nas', status: 'up' }, { id: 's2', name: 'htpc', status: 'up' },
                    { id: 's3', name: 'vps', status: 'down' }] }) });
        });
        const panel = await addInConfig(page, 'beszel-system');
        await panel.locator('[data-widget-setting="server"]').fill('http://beszel.lan:8090');
        await panel.locator('[data-widget-auth="basicUser"]').fill('reader@example.org');
        await panel.locator('[data-widget-auth="secret"]').fill('beszel-pass-0123');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('3 systems');
        expect(sent?.draftCredential?.session).toMatchObject({
            loginPath: '/api/collections/users/auth-with-password', user: 'reader@example.org',
            password: 'beszel-pass-0123', tokenHeader: 'Authorization' });

        await panel.locator('[data-widget-setting="system"]').selectOption('s2');
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page, 'beszel-system'))?.system ?? null, { timeout: 15_000 }).toBe('s2');
        expect(JSON.stringify(await savedConfig(page, 'beszel-system'))).not.toContain('beszel-pass-0123');
    });
});
