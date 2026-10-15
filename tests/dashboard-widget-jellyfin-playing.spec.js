// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The Jellyfin "Now playing" widget: who watches what right now.
 *
 * Drawn with a stubbed answer like the Jellyfin spec: the server half has its
 * own Go tests, and this file is about what the tile does with an answer.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const FILM = { id: 'sA', title: 'Dune: Part Two', kind: 'movie', who: 'jordi', device: 'Jellyfin Web',
    method: 'transcode', progress: 0.4, remaining: 5976, poster: PNG, openUrl: 'https://jellyfin.example/web/#/details?id=m1' };
const EPISODE = { id: 'sB', title: 'Severance', subtitle: 'S02E07 · Cold Harbor', kind: 'episode',
    device: 'Living room TV', method: 'direct', paused: true, progress: 0.33, remaining: 2400, poster: PNG,
    openUrl: 'https://jellyfin.example/web/#/details?id=e1' };

/** Open Config → Widgets on an empty page, add a widget of one type and open its settings. */
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
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
    await page.locator('[data-widget-catalogue]').click();
    await page.locator(`.modal--widget-catalogue [data-widget-option="${type}"]`).first().click();
    await page.locator(`.modal--widget-catalogue [data-widget-add="${type}"]`).click();
    await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]'))
        .toBeFocused({ timeout: 10_000 });
    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(page.locator(`[data-widget-detail="${index}"]`)).toBeVisible();
    return page.locator(`[data-widget-detail="${index}"]`);
}

async function draw(page, { items, config = {} }) {
    await page.evaluate(async ({ items, config }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes('/api/widgets/jellyfin-playing')
            ? new Response(JSON.stringify({ fetchedAt: Date.now(), items }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('jp-test')?.remove();
        const host = document.createElement('div');
        host.id = 'jp-test';
        host.style.width = '320px';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets['jellyfin-playing'](body, { id: 'w_jp1', type: 'jellyfin-playing', config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { items, config });
    return page.locator('#jp-test');
}

test.describe('the Jellyfin now playing widget', () => {
    test('offered, with a renderer and its settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])].includes('jellyfin-playing'),
                renderer: typeof window.DashboardWidgets?.['jellyfin-playing'],
                settings: (Config?.WIDGET_SETTINGS?.['jellyfin-playing'] || []).map((f) => f.key),
            };
        });
        expect(state.offered).toBe(true);
        expect(state.renderer).toBe('function');
        expect(state.settings).toEqual(['hideNames', 'click', 'target', 'rows', 'ttl']);
    });

    test('a playing line: who, device, method, bar and time left', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { items: [FILM] });
        const row = tile.locator('.media-row').first();
        await expect(row).toContainText('Dune: Part Two');
        await expect(row.locator('.media-meta').first()).toHaveText('jordi · Jellyfin Web · Transcoding · −100 min');
        await expect(row.locator('.media-progress')).toHaveAttribute('aria-valuenow', '40');
        await expect(row.locator('.media-badge')).toHaveCount(0);
    });

    test('paused shows the pause badge', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { items: [EPISODE] });
        await expect(tile.locator('.media-row .media-badge')).toHaveText('⏸');
    });

    test('without a name the line starts at the device', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { items: [EPISODE] });
        await expect(tile.locator('.media-row .media-meta').first()).toHaveText('Living room TV · Direct play · −40 min');
    });

    test('live tv: no bar and no time left', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { items: [{ id: 'sD', title: 'NPO 1', kind: 'tv', who: 'guest',
            device: 'Kitchen', method: 'direct', openUrl: 'https://jellyfin.example/' }] });
        await expect(tile.locator('.media-row .media-meta').first()).toHaveText('guest · Kitchen · Direct play');
        await expect(tile.locator('.media-progress')).toHaveCount(0);
    });

    test('nobody watching is a quiet empty line', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { items: [] });
        await expect(tile).toContainText('Nobody is watching right now.');
        await expect(tile.locator('.media-stale')).toHaveCount(0);
    });

    test('set up from the panel with Jellyfin\'s own Connect, nothing to choose', async ({ page }) => {
        let asked = 0;
        await page.route('**/api/widgets/jellyfin/setup', async (route) => {
            asked += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'Home', version: '10.10.3', users: [{ id: 'u1', name: 'jordi' }],
                libraries: [{ id: 'lib-movies', name: 'Films' }] }) });
        });
        const row = await addInConfig(page, 'jellyfin-playing');
        await row.locator('[data-widget-setting="server"]').fill('http://jellyfin.lan:8096');
        await row.locator('[data-widget-auth="secret"]').fill('k-123');
        await row.locator('[data-media-connect]').click();
        await expect(row.locator('[data-media-status]')).toContainText('Home');
        expect(asked).toBe(1);
        await expect(row.locator('[data-widget-setting="userId"]')).toHaveCount(0);
        await expect(row.locator('[data-widget-setting="libraries"]')).toHaveCount(0);
        await row.locator('[data-widget-setting="hideNames"]').check();
        await row.locator('[data-widget-save]').click();
        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            const widget = (blocks.widgets || []).find((w) => w.type === 'jellyfin-playing');
            return widget ? { ...widget.config } : null;
        }), { timeout: 15_000 }).toMatchObject({ server: 'http://jellyfin.lan:8096', hideNames: true });
    });

    test('on the dashboard it asks every beat, and redraws in place', async ({ page }) => {
        let asked = 0;
        await page.route('**/api/widgets/jellyfin-playing?*', async (route) => {
            asked += 1;
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ fetchedAt: Date.now(), items: [{ ...FILM, remaining: 6000 - asked * 60 }] }) });
        });
        await open(page);
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = { 'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [{
                id: 'w_jpbeat00001', type: 'jellyfin-playing', title: 'Now playing',
                config: { server: 'http://jellyfin.lan:8096', ttl: 5 } }] }) });
        });
        await page.reload();
        const body = page.locator('.dashboard-widget[data-widget-id="w_jpbeat00001"] .dashboard-widget-body');
        await expect(body.locator('.media-row')).toHaveCount(1, { timeout: 15_000 });
        const start = asked;
        // Watch for the loading line coming back between beats.
        await page.evaluate(() => {
            window.__jpFlashed = false;
            const target = document.querySelector('.dashboard-widget[data-widget-id="w_jpbeat00001"] .dashboard-widget-body');
            new MutationObserver(() => {
                if (target.querySelector('.dashboard-widget-waiting')) window.__jpFlashed = true;
            }).observe(target, { childList: true, subtree: true });
        });
        await page.waitForTimeout(11_500);
        expect(asked - start).toBeGreaterThanOrEqual(2);
        expect(await page.evaluate(() => window.__jpFlashed)).toBe(false);
        await expect(body.locator('.media-row')).toHaveCount(1);
    });
});
