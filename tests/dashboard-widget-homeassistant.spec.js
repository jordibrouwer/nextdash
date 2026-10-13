// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Home Assistant: chosen entities per room, a safe few switchable. Drawn with
 * a stubbed answer; the server half (which entities may be switched at all)
 * has Go tests.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const minute = 60_000;

function answer(extra = {}) {
    const now = Date.now();
    return {
        fetchedAt: now,
        controls: true,
        libraries: [{ id: 'Kitchen', name: 'Kitchen' }, { id: 'Living room', name: 'Living room' }],
        items: [
            { id: 'light.ceiling', title: 'Ceiling light', kind: 'entity', library: 'Living room', libraryId: 'Living room',
              addedAt: now - 5 * minute, value: 'on', control: 'toggle', on: true, icon: 'light', openUrl: 'http://ha.example/history' },
            { id: 'sensor.temperature', title: 'Temperature', kind: 'entity', library: 'Living room', libraryId: 'Living room',
              addedAt: now - 2 * minute, value: '21.4 °C', icon: 'temperature', openUrl: 'http://ha.example/history' },
            { id: 'scene.movie_night', title: 'Movie night', kind: 'entity', library: 'Living room', libraryId: 'Living room',
              control: 'run', icon: 'scene', openUrl: 'http://ha.example/history' },
            { id: 'binary_sensor.back_door', title: 'Back door', kind: 'entity', library: 'Kitchen', libraryId: 'Kitchen',
              value: 'off', icon: 'door', openUrl: 'http://ha.example/history' },
            { id: 'light.garden', title: 'Garden light', kind: 'entity', library: 'Kitchen', libraryId: 'Kitchen',
              value: 'unavailable', unavailable: true, icon: 'light', openUrl: 'http://ha.example/history' },
        ],
        ...extra,
    };
}

/** Draws the tile with the answer stubbed; `action` answers the switch. */
async function draw(page, { result, next = null, config = {}, action = { status: 200, body: { states: [] } } }) {
    await page.evaluate(async ({ result, next, config, action }) => {
        const d = window.dashboardInstance;
        window.__haSent = [];
        window.__haRealFetch = window.__haRealFetch || window.fetch;
        const realFetch = window.__haRealFetch;
        window.fetch = async (url, init = {}) => {
            const text = String(url);
            if (text.includes('/api/widgets/homeassistant/action')) {
                window.__haSent.push({ body: JSON.parse(init.body || '{}'), headers: init.headers || {} });
                return new Response(JSON.stringify(action.body), { status: action.status, headers: { 'Content-Type': 'application/json' } });
            }
            if (text.includes('/api/widgets/homeassistant')) {
                const loads = window.__haSent.filter((sent) => sent.load).length;
                window.__haSent.push({ load: true, headers: init.headers || {} });
                const reply = loads > 0 && next ? next : result;
                return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return realFetch(url, init);
        };
        document.getElementById('ha-test')?.remove();
        const host = document.createElement('div');
        host.id = 'ha-test';
        host.style.width = '320px';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        delete d._widgetMedia;
        await window.DashboardWidgets.homeassistant(body, { id: 'w_hass00000001', type: 'homeassistant', config }, d);
    }, { result, next, config, action });
    return page.locator('#ha-test');
}

test.describe('the Home Assistant widget', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(() => { if (window.__haRealFetch) window.fetch = window.__haRealFetch; }).catch(() => {});
    });

    test('offered, with a renderer and its settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])].includes('homeassistant'),
                renderer: typeof window.DashboardWidgets?.homeassistant,
                settings: (Config?.WIDGET_SETTINGS?.homeassistant || []).map((f) => f.key),
            };
        });
        expect(state.offered).toBe(true);
        expect(state.renderer).toBe('function');
        expect(state.settings).toEqual(['groupBy', 'showLastChanged', 'layout', 'click', 'target', 'rows', 'ttl']);
    });

    test('a tab per room; values, a switch and a start button', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer() });
        await expect(tile.locator('[data-media-tab]')).toHaveText(['Kitchen', 'Living room']);
        await tile.locator('[data-media-tab="Living room"]').click();
        await expect(tile.locator('[data-ha-toggle="light.ceiling"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(tile.locator('[data-ha-value="sensor.temperature"]')).toHaveText('21.4 °C');
        await expect(tile.locator('[data-ha-run="scene.movie_night"]')).toBeVisible();
        await tile.locator('[data-media-tab="Kitchen"]').click();
        // A door sensor reads as a door, not as on/off.
        await expect(tile.locator('[data-ha-value="binary_sensor.back_door"]')).toHaveText('closed');
        await expect(tile.locator('[data-media-item="light.garden"]').locator('..')).toHaveClass(/is-unavailable/);
    });

    test('a switch goes through the server, and back when refused', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { layout: 'list' },
            action: { status: 200, body: { states: [{ id: 'light.ceiling', state: 'off', on: false }] } } });
        const toggle = tile.locator('[data-ha-toggle="light.ceiling"]');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        const sent = await page.evaluate(() => window.__haSent.filter((s) => s.body));
        expect(sent[0].body).toEqual({ pageId: expect.any(Number), id: 'w_hass00000001', entity: 'light.ceiling' });

        tile = await draw(page, { result: answer(), config: { layout: 'list' }, action: { status: 403, body: {} } });
        await tile.locator('[data-ha-toggle="light.ceiling"]').click();
        await expect(tile.locator('[data-ha-toggle="light.ceiling"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(tile.locator('.media-stale')).toContainText(/could not switch ceiling light/i);
    });

    test('a scene starts and says so', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { layout: 'list' },
            action: { status: 200, body: { states: [] } } });
        await tile.locator('[data-ha-run="scene.movie_night"]').click();
        await expect(tile.locator('[data-ha-run="scene.movie_night"]')).toHaveText('✓');
    });

    // A scene changes other lights; the tile asks again rather than wait for
    // its next refresh, and stays on the tab the reader was on.
    test('after a scene the tile reads Home Assistant again', async ({ page }) => {
        await open(page);
        const after = answer();
        after.items = after.items.map((item) => (item.id === 'light.ceiling' ? { ...item, on: false, value: 'off' } : item));
        const tile = await draw(page, { result: answer(), next: after, action: { status: 200, body: { states: [] } } });
        await tile.locator('[data-media-tab="Living room"]').click();
        await expect(tile.locator('[data-ha-toggle="light.ceiling"]')).toHaveAttribute('aria-pressed', 'true');
        await tile.locator('[data-ha-run="scene.movie_night"]').click();
        await expect(tile.locator('[data-ha-toggle="light.ceiling"]')).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
        await expect(tile.locator('[data-media-tab="Living room"]')).toHaveAttribute('aria-selected', 'true');
        await expect(tile.locator('[data-ha-run="scene.movie_night"]')).toBeFocused();
    });

    test('without the write token the controls are view only', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer({ controls: false }), config: { layout: 'list' } });
        await expect(tile.locator('[data-ha-toggle="light.ceiling"]')).toBeDisabled();
        await expect(tile.locator('[data-ha-toggle="light.ceiling"]')).toHaveAttribute('title', /view only/i);
    });

    test('the tile asks with the write token, so its owner can switch', async ({ page }) => {
        await open(page);
        // The test server runs with a write token; the page carries it.
        const token = await page.evaluate(() => document.querySelector('meta[name="nextdash-write-token"]')?.content || '');
        expect(token).not.toBe('');
        await draw(page, { result: answer() });
        const load = await page.evaluate(() => window.__haSent.find((s) => s.load));
        expect(load.headers['X-NextDash-Token']).toBe(token);
    });

    test('chosen in the panel: search, pick, reorder, save', async ({ page }) => {
        await page.route('**/api/widgets/homeassistant/setup', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'Home', version: '2026.10.1', entities: [
                    { id: 'light.ceiling', name: 'Ceiling light', domain: 'light', state: 'on' },
                    { id: 'light.reading', name: 'Reading lamp', domain: 'light', state: 'off' },
                    { id: 'sensor.temperature', name: 'Temperature', domain: 'sensor', state: '21' },
                ] }) });
        });
        await open(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        // Quickstart sweeps favicons on a fresh store and reopens Overview when it finishes.
        await page.waitForTimeout(6000);
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = { 'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
            await window.dashboardInstance.config.openConfigView('widgets');
        });
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('.modal--widget-catalogue [data-widget-option="homeassistant"]').first().click();
        await page.locator('.modal--widget-catalogue [data-widget-add="homeassistant"]').click();
        await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]')).toBeFocused({ timeout: 10_000 });
        const toggle = page.locator('[data-widget-settings]').last();
        const index = await toggle.getAttribute('data-widget-settings');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        const panel = page.locator(`[data-widget-detail="${index}"]`);

        await panel.locator('[data-widget-setting="server"]').fill('http://ha.lan:8123');
        await panel.locator('[data-widget-auth="secret"]').fill('ha-token-abc');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Home');

        const search = panel.locator('[data-ha-search]');
        await search.fill('lamp');
        await expect(panel.locator('[data-ha-pick]')).toHaveCount(1);
        await expect(search).toBeFocused();
        await panel.locator('[data-ha-pick="light.reading"]').check();
        await search.fill('');
        await panel.locator('[data-ha-pick="sensor.temperature"]').check();
        await expect(panel.locator('[data-ha-chosen]')).toHaveText([/Reading lamp/, /Temperature/]);
        await panel.locator('[data-ha-move="sensor.temperature"][data-ha-dir="up"]').click();
        await expect(panel.locator('[data-ha-chosen]')).toHaveText([/Temperature/, /Reading lamp/]);

        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            return (blocks.widgets || []).find((w) => w.type === 'homeassistant')?.config?.entities ?? null;
        }), { timeout: 15_000 }).toEqual(['sensor.temperature', 'light.reading']);
    });
});
