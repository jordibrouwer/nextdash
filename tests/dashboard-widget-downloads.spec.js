// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * qBittorrent and SABnzbd: downloads with progress, speed and time left, and
 * the client's totals on top, through the shared media tile. Drawn with a
 * stubbed answer; the server half has Go tests.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const hour = 3_600_000;
const MB = 1024 * 1024;

function answer(extra = {}) {
    const now = Date.now();
    return {
        fetchedAt: now,
        libraries: [{ id: 'active', name: 'Downloading' }, { id: 'paused', name: 'Paused' }, { id: 'done', name: 'Done' }],
        items: [
            { id: 't1', title: 'Example.Movie.2024', subtitle: 'radarr', kind: 'download', library: 'Downloading',
              libraryId: 'active', addedAt: now - hour, progress: 0.25, speed: 5 * MB, size: 8192 * MB,
              left: '0:12:34', openUrl: 'http://qb.example:8080' },
            { id: 't2', title: 'Example.Show.S01E01', kind: 'download', library: 'Done', libraryId: 'done',
              addedAt: now - 2 * hour, progress: 1, size: 1024 * MB, openUrl: 'http://qb.example:8080' },
        ],
        totals: { down: 5 * MB, up: 1024, active: 1, paused: 0, done: 1 },
        ...extra,
    };
}

async function draw(page, { type = 'qbittorrent', result, config = {}, width = 320 }) {
    await page.evaluate(async ({ type, result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}`)
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('downloads-test')?.remove();
        const host = document.createElement('div');
        host.id = 'downloads-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: 'w_downloads1', type, config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { type, result, config, width });
    return page.locator('#downloads-test');
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
    // A media kind asks for its address first; this spec fills it in the panel.
    await page.locator('[data-widget-wizard-finish]').click();
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

test.describe('the download widgets', () => {
    test('both offered, with a renderer and the same settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return ['qbittorrent', 'sabnzbd'].map((type) => ({
                offered: (Config?.WIDGET_TYPES || []).includes(type),
                renderer: typeof window.DashboardWidgets?.[type],
                settings: (Config?.WIDGET_SETTINGS?.[type] || []).map((f) => f.key),
            }));
        });
        for (const one of state) {
            expect(one.offered).toBe(true);
            expect(one.renderer).toBe('function');
            expect(one.settings).toEqual(['filter', 'sort', 'hideCompleted', 'hideTotals', 'layout', 'click', 'target', 'rows', 'ttl']);
        }
    });

    test('totals on top, and a row with its bar, speed and time left', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), width: 680 });
        await expect(tile.locator('.media-totals')).toContainText('↓ 5.0 MB/s');
        await expect(tile.locator('.media-totals')).toContainText('↑ 1.0 KB/s');
        await expect(tile.locator('.media-totals')).toContainText('1 downloading');
        const row = tile.locator('[data-media-item="t1"]');
        await expect(row.locator('.media-meta:visible')).toContainText('0:12:34');
        await expect(row.locator('.media-meta:visible')).toContainText('5.0 MB/s');
        await expect(row.locator('.media-meta:visible')).toContainText('8.0 GB');
        await expect(row.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '25');
        // No pictures to show: no initials box beside a download.
        await expect(row.locator('.media-art')).toHaveCount(0);

        tile = await draw(page, { result: answer(), config: { hideTotals: true } });
        await expect(tile.locator('.media-totals')).toHaveCount(0);
    });

    test('the list keeps the order the client gave', async ({ page }) => {
        await open(page);
        const now = Date.now();
        const result = answer({ items: [
            { id: 'far', title: 'Far along', kind: 'download', library: 'Downloading', libraryId: 'active',
              addedAt: now - 5 * hour, progress: 0.9 },
            { id: 'new', title: 'Just started', kind: 'download', library: 'Downloading', libraryId: 'active',
              addedAt: now - hour, progress: 0.1 },
        ] });
        const tile = await draw(page, { result, config: { sort: 'progress' } });
        await expect(tile.locator('[data-media-item]')).toHaveText([/Far along/, /Just started/]);
    });

    test('the strip has a tab per group, and an empty one says so', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { layout: 'strip' } });
        await expect(tile.locator('[data-media-tab]')).toHaveText(['Downloading', 'Paused', 'Done']);
        await tile.locator('[data-media-tab="paused"]').click();
        await expect(tile.locator('.media-strip-empty')).toContainText(/nothing paused/i);
        await tile.locator('[data-media-tab="active"]').click();
        await expect(tile.locator('[data-media-item="t1"]')).toBeVisible();
    });

    test('qBittorrent signs in with a username and password, and a category can be chosen', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/qbittorrent/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'qBittorrent', version: '5.1.2',
                categories: [{ id: 'movies', name: 'movies' }, { id: 'tv', name: 'tv' }] }) });
        });
        const panel = await addInConfig(page, 'qbittorrent');
        await panel.locator('[data-widget-setting="server"]').fill('http://qb.lan:8080');
        await panel.locator('[data-widget-auth="basicUser"]').fill('reader');
        await panel.locator('[data-widget-auth="secret"]').fill('qb-pass-0123');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('qBittorrent');
        expect(sent?.draftCredential?.session).toMatchObject({
            loginPath: '/api/v2/auth/login', user: 'reader', password: 'qb-pass-0123', referer: true });

        await panel.locator('[data-widget-setting="category"]').selectOption('movies');
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page, 'qbittorrent'))?.category ?? null, { timeout: 15_000 }).toBe('movies');
        expect(JSON.stringify(await savedConfig(page, 'qbittorrent'))).not.toContain('qb-pass-0123');
    });

    test('qBittorrent 5.2 can take an API key instead', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/qbittorrent/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ serverName: 'qBittorrent', version: '5.2.0', categories: [] }) });
        });
        const panel = await addInConfig(page, 'qbittorrent');
        await panel.locator('[data-widget-setting="server"]').fill('http://qb.lan:8080');
        await panel.locator('[data-media-auth]').selectOption('key');
        await expect(panel.locator('[data-widget-auth="basicUser"]')).toHaveCount(0);
        await panel.locator('[data-widget-auth="secret"]').fill('qbt_key0123');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('5.2.0');
        expect(sent?.draftCredential?.headers).toEqual({ Authorization: 'Bearer qbt_key0123' });
    });

    test('SABnzbd sends its key as the apikey parameter', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/sabnzbd/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ serverName: 'SABnzbd', version: '5.1.3' }) });
        });
        const panel = await addInConfig(page, 'sabnzbd');
        await panel.locator('[data-widget-setting="server"]').fill('http://sab.lan:8081');
        await panel.locator('[data-widget-auth="secret"]').fill('sab0123456789');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('SABnzbd');
        expect(sent?.draftCredential).toEqual({ query: { apikey: 'sab0123456789' } });
    });
});
