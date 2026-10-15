// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The Emby widget and the Emby "Now playing" widget.
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

const FILM = { id: 'sA', title: 'Dune: Part Two', kind: 'movie', who: 'jordi', device: 'Emby Web',
    method: 'transcode', progress: 0.4, remaining: 5976, poster: PNG, openUrl: 'https://emby.example/web/#/details?id=m1' };
const EPISODE = { id: 'sB', title: 'Severance', subtitle: 'S02E07 · Cold Harbor', kind: 'episode',
    device: 'Living room TV', method: 'direct', paused: true, progress: 0.33, remaining: 2400, poster: PNG,
    openUrl: 'https://emby.example/web/#/details?id=e1' };

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


const ITEM = { id: 'm1', title: 'Dune: Part Two', kind: 'movie', library: 'Films', libraryId: 'lib-movies',
    addedAt: Date.now() - 3600_000, poster: PNG, openUrl: 'https://emby.example/web/#/details?id=m1' };

async function draw(page, { type, items, config = {} }) {
    await page.evaluate(async ({ type, items, config }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}`)
            ? new Response(JSON.stringify({ fetchedAt: Date.now(), libraries: [{ id: 'lib-movies', name: 'Films' }], items }),
                { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('em-test')?.remove();
        const host = document.createElement('div');
        host.id = 'em-test';
        host.style.width = '320px';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: 'w_em1', type, config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { type, items, config });
    return page.locator('#em-test');
}

test.describe('the Emby widgets', () => {
    test('both types are offered, with a renderer and the settings Jellyfin has', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const keys = (type) => (Config?.WIDGET_SETTINGS?.[type] || []).map((f) => f.key);
            return {
                offered: ['emby', 'emby-playing'].map((t) => [...(Config?.WIDGET_TYPES || [])].includes(t)),
                renderers: ['emby', 'emby-playing'].map((t) => typeof window.DashboardWidgets?.[t]),
                embyKeys: keys('emby'), jellyfinKeys: keys('jellyfin'),
                playingKeys: keys('emby-playing'), jellyfinPlayingKeys: keys('jellyfin-playing'),
            };
        });
        expect(state.offered).toEqual([true, true]);
        expect(state.renderers).toEqual(['function', 'function']);
        expect(state.embyKeys.length).toBeGreaterThan(0);
        expect(state.embyKeys).toEqual(state.jellyfinKeys);
        expect(state.playingKeys).toEqual(state.jellyfinPlayingKeys);
    });

    test('labels without Jellyfin in them keep their translated keys', async ({ page }) => {
        await open(page);
        const labels = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const pairs = (type) => (Config?.WIDGET_SETTINGS?.[type] || []).map((f) => f.label);
            return { emby: pairs('emby'), jellyfin: pairs('jellyfin') };
        });
        const layout = labels.jellyfin.findIndex((l) => Array.isArray(l) && !String(l[1]).includes('Jellyfin'));
        expect(layout).toBeGreaterThanOrEqual(0);
        expect(labels.emby[layout]).toEqual(labels.jellyfin[layout]);
        labels.emby.forEach((label) => expect(String(Array.isArray(label) ? label[1] : label)).not.toContain('Jellyfin'));
    });

    test('the emby tile draws a poster row from the answer', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'emby', items: [ITEM] });
        const row = tile.locator('.media-row').first();
        await expect(row).toContainText('Dune: Part Two');
        await expect(row.locator('img')).toHaveCount(1);
    });

    test('the emby-playing tile draws a playing line', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'emby-playing', items: [FILM] });
        const row = tile.locator('.media-row').first();
        await expect(row).toContainText('Dune: Part Two');
        await expect(row.locator('.media-meta').first()).toHaveText('jordi · Emby Web · Transcoding · −100 min');
        await expect(row.locator('.media-progress')).toHaveAttribute('aria-valuenow', '40');
    });

    test('set up from the panel asks Emby\'s own route, not Jellyfin\'s', async ({ page }) => {
        let asked = 0;
        let askedJellyfin = 0;
        await page.route('**/api/widgets/emby/setup', async (route) => {
            asked += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'Emby Home', version: '4.8.10', users: [{ id: 'u1', name: 'jordi' }],
                libraries: [{ id: 'lib-movies', name: 'Films' }] }) });
        });
        await page.route('**/api/widgets/jellyfin/setup', async (route) => {
            askedJellyfin += 1;
            await route.fulfill({ status: 500, body: '{}' });
        });
        const row = await addInConfig(page, 'emby');
        await row.locator('[data-widget-setting="server"]').fill('http://emby.lan:8096');
        await row.locator('[data-widget-auth="secret"]').fill('k-123');
        await row.locator('[data-media-connect]').click();
        await expect(row.locator('[data-media-status]')).toContainText('Emby Home');
        expect(asked).toBe(1);
        expect(askedJellyfin).toBe(0);
    });
});
