// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The Plex widget and the Plex "Now playing" widget.
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

const FILM = { id: 'sA', title: 'Dune: Part Two', kind: 'movie', who: 'jordi', device: 'Living room',
    method: 'transcode', progress: 0.4, remaining: 5976, poster: PNG, openUrl: 'https://plex.example/web/#/details?id=m1' };
const EPISODE = { id: 'sB', title: 'Severance', subtitle: 'S02E07 · Cold Harbor', kind: 'episode',
    device: 'Living room TV', method: 'direct', paused: true, progress: 0.33, remaining: 2400, poster: PNG,
    openUrl: 'https://plex.example/web/#/details?id=e1' };

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
    addedAt: Date.now() - 3600_000, poster: PNG, openUrl: 'https://plex.example/web/#/details?id=m1' };

async function draw(page, { type, items, config = {} }) {
    await page.evaluate(async ({ type, items, config }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}`)
            ? new Response(JSON.stringify({ fetchedAt: Date.now(), libraries: [{ id: 'lib-movies', name: 'Films' }], items }),
                { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('px-test')?.remove();
        const host = document.createElement('div');
        host.id = 'px-test';
        host.style.width = '320px';
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: 'w_px1', type, config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { type, items, config });
    return page.locator('#px-test');
}

test.describe('the Plex widgets', () => {
    test('both types are offered, with a renderer and the settings Jellyfin has, minus the user', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const keys = (type) => (Config?.WIDGET_SETTINGS?.[type] || []).map((f) => f.key);
            return {
                offered: ['plex', 'plex-playing'].map((t) => [...(Config?.WIDGET_TYPES || [])].includes(t)),
                renderers: ['plex', 'plex-playing'].map((t) => typeof window.DashboardWidgets?.[t]),
                plexKeys: keys('plex'), jellyfinKeys: keys('jellyfin'),
                playingKeys: keys('plex-playing'), jellyfinPlayingKeys: keys('jellyfin-playing'),
            };
        });
        expect(state.offered).toEqual([true, true]);
        expect(state.renderers).toEqual(['function', 'function']);
        expect(state.plexKeys.length).toBeGreaterThan(0);
        expect(state.plexKeys).toEqual(state.jellyfinKeys.filter((k) => k !== 'userId' && k !== 'hideWatched'));
        expect(state.playingKeys).toEqual(state.jellyfinPlayingKeys);
    });

    test('labels without Jellyfin in them keep their translated keys', async ({ page }) => {
        await open(page);
        const fields = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return { plex: Config?.WIDGET_SETTINGS?.plex || [], jellyfin: Config?.WIDGET_SETTINGS?.jellyfin || [] };
        });
        const layout = (list) => list.find((f) => f.key === 'layout').label;
        expect(layout(fields.jellyfin)[1]).not.toContain('Jellyfin');
        expect(layout(fields.plex)).toEqual(layout(fields.jellyfin));
        // Keys keep Jellyfin's name on purpose; what a reader sees must not.
        const text = (JSON.stringify(fields.plex).match(/"[^"]*"/g) || []).filter((t) => !t.startsWith('"config.')).join(' ');
        expect(text).not.toContain('Jellyfin');
        expect(text).not.toContain('Emby');
        expect(text).toContain('Plex');
    });

    test('the plex tile draws a poster row from the answer', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'plex', items: [ITEM] });
        const row = tile.locator('.media-row').first();
        await expect(row).toContainText('Dune: Part Two');
        await expect(row.locator('img')).toHaveCount(1);
    });

    test('the plex-playing tile draws a playing line', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { type: 'plex-playing', items: [FILM] });
        const row = tile.locator('.media-row').first();
        await expect(row).toContainText('Dune: Part Two');
        await expect(row.locator('.media-meta').first()).toHaveText('jordi · Living room · Transcoding · −100 min');
        await expect(row.locator('.media-progress')).toHaveAttribute('aria-valuenow', '40');
    });

    test('set up from the panel asks Plex\'s own route, not Jellyfin\'s', async ({ page }) => {
        let asked = 0;
        let askedJellyfin = 0;
        let askedEmby = 0;
        await page.route('**/api/widgets/plex/setup', async (route) => {
            asked += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'Plex Home', version: '2.15.0', libraries: [{ id: 'lib-movies', name: 'Films' }] }) });
        });
        await page.route('**/api/widgets/jellyfin/setup', async (route) => {
            askedJellyfin += 1;
            await route.fulfill({ status: 500, body: '{}' });
        });
        await page.route('**/api/widgets/emby/setup', async (route) => {
            askedEmby += 1;
            await route.fulfill({ status: 500, body: '{}' });
        });
        const row = await addInConfig(page, 'plex');
        await row.locator('[data-widget-setting="server"]').fill('http://tautulli.lan:8181');
        await row.locator('[data-widget-auth="secret"]').fill('k-123');
        await row.locator('[data-media-connect]').click();
        await expect(row.locator('[data-media-status]')).toContainText('Plex Home');
        expect(asked).toBe(1);
        expect(askedJellyfin).toBe(0);
        expect(askedEmby).toBe(0);
        await expect(row.locator('[data-widget-setting="userId"]')).toHaveCount(0);
        await expect(row.locator('[data-widget-setting="libraries"]')).toHaveCount(1);
    });
});
