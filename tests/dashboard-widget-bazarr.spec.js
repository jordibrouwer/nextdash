// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Bazarr: what subtitles are missing, what was fetched lately and a line of
 * totals, each optional. Drawn with a stubbed answer in the shape the server
 * sends (widgets_bazarr_test.go has the Go tests for the service half).
 *
 * What these pin is what the reader sees: one column shows one topic behind
 * tabs, two columns show them side by side, a topic switched off is not drawn,
 * names from the network are text, and a click opens the item or a card.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const NOW = () => Date.now();

function answer(extra = {}) {
    return {
        fetchedAt: NOW(), items: [], libraries: [],
        subs: {
            topics: ['missing', 'recent', 'totals'],
            openUrl: 'http://bz.example',
            totals: { missingMovies: 18, missingEpisodes: 1, providerIssues: 0 },
            missing: [
                { id: 'm1', kind: 'movie', title: 'Example Movie One', languages: ['nl'], openUrl: 'http://bz.example/movies/1' },
                { id: 'e1', kind: 'episode', title: 'Example Show One', subtitle: '3x5 Example Episode', languages: ['nl', 'en+hi'], openUrl: 'http://bz.example/series/9' },
            ],
            recent: [
                { id: 'm2', kind: 'movie', title: 'Example Movie Two', language: 'nl', provider: 'opensubtitlescom', score: '90.56%', at: NOW() - 5 * 60_000, openUrl: 'http://bz.example/movies/2' },
                { id: 'e2', kind: 'episode', title: 'Example Show Two', subtitle: '1x3 Example Episode', language: 'nl+hi', provider: 'subf2m', upgrade: true, at: NOW() - 3 * 3600_000, openUrl: 'http://bz.example/series/8' },
            ],
            ...extra,
        },
    };
}

async function draw(page, { result, config = {}, width = 320 }) {
    await page.evaluate(async ({ result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        const realNext = window.nextDashFetch;
        const stub = async (url, ...rest) => (String(url).includes('/api/widgets/bazarr')
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        window.fetch = stub;
        if (realNext) window.nextDashFetch = stub;
        document.getElementById('bz-test')?.remove();
        const host = document.createElement('div');
        host.id = 'bz-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.bazarr(body, { id: `w_bazarr_${width}`, type: 'bazarr', config }, d);
        } finally {
            window.fetch = realFetch;
            if (realNext) window.nextDashFetch = realNext;
            delete d._widgetMedia;
        }
    }, { result, config, width });
    return page.locator('#bz-test');
}

async function addInConfig(page, type) {
    await open(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    // Quickstart sweeps favicons on a fresh store and reopens Overview when it finishes: waited out rather than raced.
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

test.describe('the Bazarr widget', () => {
    test('offered under Media, with a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const media = (Config?.WIDGET_TYPE_GROUPS || []).find(([group]) => group === 'media')?.[1] || [];
            return {
                offered: (Config?.WIDGET_TYPES || []).includes('bazarr'),
                grouped: media.includes('bazarr'),
                renderer: typeof window.DashboardWidgets?.bazarr,
            };
        });
        expect(state).toMatchObject({ offered: true, grouped: true, renderer: 'function' });
    });

    test('one column: tabs, one topic at a time, totals on top', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 320 });
        await expect(tile.locator('.bz-figure:visible')).toHaveCount(3);
        await expect(tile.locator('.bz-figure:visible').first()).toContainText('18');
        await expect(tile.locator('.bz-tab:visible')).toHaveCount(2);
        await expect(tile.locator('.bz-block:visible')).toHaveCount(1);
        const first = tile.locator('.bz-row:visible').first();
        await expect(first).toContainText('Example Movie One');
        await expect(first.locator('.bz-lang')).toHaveText(['nl']);
        const episode = tile.locator('.bz-row:visible').nth(1);
        await expect(episode).toContainText('3x5 Example Episode');
        await expect(episode.locator('.bz-lang')).toHaveText(['nl', 'en+hi']);

        await tile.locator('.bz-tab:visible', { hasText: 'Fetched' }).click();
        await expect(tile.locator('.bz-block:visible')).toHaveAttribute('data-topic', 'recent');
        const fetched = tile.locator('.bz-row:visible').first();
        await expect(fetched).toContainText('opensubtitlescom');
        await expect(fetched).toContainText('90.56%');
        await expect(fetched).toContainText('5m');
        await expect(tile.locator('.bz-row:visible').nth(1)).toContainText('upgraded');
        // The choice survives a redraw.
        await expect(tile.locator('.bz-tab[aria-selected="true"]:visible')).toHaveText('Fetched');
    });

    test('two columns: both topics side by side', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 680 });
        await expect(tile.locator('.bz-block:visible')).toHaveCount(2);
        await expect(tile.locator('.bz-tab:visible')).toHaveCount(0);
    });

    test('a topic switched off is not drawn, and with one left there are no tabs', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { topics: ['recent'] }, width: 320 });
        await expect(tile.locator('.bz-tab')).toHaveCount(0);
        await expect(tile.locator('.bz-figure')).toHaveCount(0);
        await expect(tile.locator('.bz-block:visible')).toHaveAttribute('data-topic', 'recent');

        tile = await draw(page, { result: answer(), config: { topics: ['totals'] }, width: 680 });
        await expect(tile.locator('.bz-block')).toHaveCount(0);
        await expect(tile.locator('.bz-figure:visible')).toHaveCount(3);
    });

    test('nothing chosen says so', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { topics: [] }, width: 320 });
        await expect(tile).toContainText(/choose what to show/i);
    });

    test('rows cuts every list', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { rows: 1 }, width: 680 });
        await expect(tile.locator('.bz-block:visible[data-topic="missing"] .bz-row')).toHaveCount(1);
        await expect(tile.locator('.bz-block:visible[data-topic="recent"] .bz-row')).toHaveCount(1);
    });

    test('empty lists say so instead of drawing nothing', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer({ missing: [], recent: [], totals: { missingMovies: 0, missingEpisodes: 0, providerIssues: 0 } }), width: 680 });
        await expect(tile.locator('.bz-empty:visible')).toHaveCount(2);
        await expect(tile).not.toContainText('NaN');
        await expect(tile.locator('.bz-figure--bad')).toHaveCount(0);
    });

    test('a provider in trouble is marked', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer({ totals: { missingMovies: 1, missingEpisodes: 0, providerIssues: 2 } }), width: 680 });
        await expect(tile.locator('.bz-figure--bad:visible')).toHaveCount(1);
        await expect(tile.locator('.bz-figure--bad:visible')).toContainText('2');
    });

    test('names from the network are text, never markup', async ({ page }) => {
        await open(page);
        const hostile = answer({ missing: [{ id: 'x', kind: 'movie', title: '<img src=x onerror=window.__pwned=1>', languages: ['<b>nl</b>'], openUrl: 'http://bz.example/movies/9' }] });
        const tile = await draw(page, { result: hostile, width: 680 });
        await expect(tile.locator('.bz-block[data-topic="missing"] .bz-row').first()).toContainText('<img src=x');
        await expect(tile.locator('.bz-block[data-topic="missing"] .bz-lang').first()).toHaveText('<b>nl</b>');
        expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    });

    test('a part that could not be read is said, the rest stays', async ({ page }) => {
        await open(page);
        const result = answer({ recent: undefined });
        result.partial = true;
        const tile = await draw(page, { result, width: 680 });
        await expect(tile.locator('.bz-foot')).toContainText(/could not be read/i);
        await expect(tile.locator('.bz-block:visible[data-topic="missing"]')).toBeVisible();
    });

    test('click: open goes straight to Bazarr', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
        const tile = await draw(page, { result: answer(), config: { click: 'open', target: '_blank' }, width: 320 });
        await tile.locator('.bz-row:visible').first().click();
        await expect(page.locator('dialog.bz-detail')).toHaveCount(0);
        expect(await page.evaluate(() => window.__opened)).toEqual(['http://bz.example/movies/1']);
    });

    test('click: detail opens a card first', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { click: 'detail' }, width: 320 });
        await tile.locator('.bz-row:visible').nth(1).click();
        const card = page.locator('dialog.bz-detail');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Example Show One');
        await expect(card).toContainText('3x5 Example Episode');
        await card.getByRole('button', { name: /close/i }).click();
        await expect(card).toHaveCount(0);
    });

    test('Connect names the version, and the topics are saved', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/bazarr/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: 'Bazarr 1.6.2' }) });
        });
        const panel = await addInConfig(page, 'bazarr');
        await panel.locator('[data-widget-setting="server"]').fill('http://bazarr.lan:6767');
        await panel.locator('[data-widget-auth="secret"]').fill('bz-key-0123456789');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Bazarr 1.6.2');
        expect(sent?.draftCredential?.headers?.['X-Api-Key']).toBe('bz-key-0123456789');

        await panel.locator('[data-widget-setting="topics"][value="totals"]').uncheck();
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page, 'bazarr'))?.topics ?? null, { timeout: 15_000 }).toEqual(['missing', 'recent']);
        const saved = await savedConfig(page, 'bazarr');
        expect(JSON.stringify(saved)).not.toContain('bz-key-0123456789');

        const filed = await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const all = await (await send('/api/health/credentials')).json();
            return Object.values(all.details || {}).filter((d) => (d.headers || []).includes('X-Api-Key')).length;
        });
        expect(filed).toBeGreaterThanOrEqual(1);
    });

    test('a count the server could not read is a dash, not a zero', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer({ totals: { missingMovies: 18 } }), width: 680 });
        await expect(tile.locator('.bz-figure:visible')).toHaveCount(3);
        await expect(tile.locator('.bz-figure:visible').first()).toContainText('18');
        await expect(tile.locator('.bz-figure:visible').nth(1)).toContainText('–');
        await expect(tile.locator('.bz-figure:visible').nth(2)).toContainText('–');
    });
});
