// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Seerr: requests, by whom, and whether they have arrived, through the shared
 * media tile. Drawn with a stubbed answer; the server half has Go tests.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const hour = 3_600_000;

function answer(extra = {}) {
    const now = Date.now();
    return {
        fetchedAt: now,
        libraries: [{ id: 'pending', name: 'Pending' }, { id: 'approved', name: 'Approved' }, { id: 'available', name: 'Available' }],
        items: [
            { id: 'r1', title: 'Dune: Part Two', subtitle: 'requested by Sam', kind: 'movie', year: 2024,
              library: 'Approved', libraryId: 'approved', addedAt: now - 2 * hour, poster: PNG,
              openUrl: 'https://seerr.example/movie/693134' },
            { id: 'r2', title: 'Severance', subtitle: 'requested by Alex', kind: 'tv', year: 2022,
              library: 'Available', libraryId: 'available', addedAt: now - 30 * hour, poster: PNG,
              openUrl: 'https://seerr.example/tv/95396' },
        ],
        ...extra,
    };
}

async function draw(page, { result, config = {}, width = 320 }) {
    await page.evaluate(async ({ result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes('/api/widgets/seerr')
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('seerr-test')?.remove();
        const host = document.createElement('div');
        host.id = 'seerr-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.seerr(body, { id: 'w_seerr1', type: 'seerr', config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { result, config, width });
    return page.locator('#seerr-test');
}

test.describe('the Seerr widget', () => {
    test('offered, with a renderer and its settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderer: typeof window.DashboardWidgets?.seerr,
                settings: (Config?.WIDGET_SETTINGS?.seerr || []).map((f) => f.key),
            };
        });
        expect(state.offered).toContain('seerr');
        expect(state.renderer).toBe('function');
        expect(state.settings).toEqual(['status', 'mediaType', 'layout', 'click', 'target', 'rows', 'ttl']);
    });

    test('a row names who asked, and the strip has a tab per status', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { layout: 'list' } });
        await expect(tile.locator('[data-media-item="r1"]')).toContainText('Dune: Part Two — requested by Sam');
        tile = await draw(page, { result: answer(), config: { layout: 'strip' } });
        await expect(tile.locator('[data-media-tab]')).toHaveText(['Pending', 'Approved', 'Available']);
        await expect(tile.locator('.media-strip-empty')).toContainText(/no pending requests/i);
    });

    test('an empty filter says what it looked for', async ({ page }) => {
        await open(page);
        const result = { fetchedAt: Date.now(), libraries: [{ id: 'available', name: 'Available' }], items: [] };
        const tile = await draw(page, { result, config: { status: 'available' } });
        await expect(tile).toContainText(/nothing requested has arrived yet/i);
    });

    test('set up from the panel: a key without its == still works, and a requester can be chosen', async ({ page }) => {
        let sentKey = '';
        await page.route('**/api/widgets/seerr/setup', async (route) => {
            sentKey = route.request().postDataJSON()?.draftCredential?.headers?.['X-Api-Key'] || '';
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
                sentKey.endsWith('==')
                    ? { serverName: 'Jellyseerr', version: '3.5.0', users: [{ id: '1', name: 'Sam' }, { id: '2', name: 'Alex' }] }
                    : { users: [], error: 'key refused' }) });
        });
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
        await page.locator('.modal--widget-catalogue [data-widget-add="seerr"]').click();
        await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]')).toBeFocused({ timeout: 10_000 });
        const toggle = page.locator('[data-widget-settings]').last();
        const index = await toggle.getAttribute('data-widget-settings');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        // The settings sit in the detail panel beside the list (wide config).
        await expect(page.locator(`[data-widget-detail="${index}"]`)).toBeVisible();
        const row = page.locator(`[data-widget-detail="${index}"]`);

        await row.locator('[data-widget-setting="server"]').fill('http://seerr.lan:5055');
        // What a double-click copy of a Seerr key gives: the base64 without its padding.
        await row.locator('[data-widget-auth="secret"]').fill('MTcwMDAwMDAwMDAwMGFhYWFhYWFhLWJiYmItNGNjYy04ZGRkLWVlZWVlZWVlZWVlZQ');
        await row.locator('[data-media-connect]').click();
        await expect(row.locator('[data-media-status]')).toContainText('Jellyseerr');
        expect(sentKey.endsWith('==')).toBe(true);

        await row.locator('[data-widget-setting="requestedBy"]').selectOption('2');
        await row.locator('[data-widget-save]').click();
        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            return (blocks.widgets || []).find((w) => w.type === 'seerr')?.config?.requestedBy ?? null;
        }), { timeout: 15_000 }).toBe('2');
    });
});
