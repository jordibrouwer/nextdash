// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Jellystat: recent plays, the most viewed, the most active and a line of
 * totals, each optional. Drawn with a stubbed answer in the shape the server
 * sends (widgets_jellystat_test.go has the Go tests for the service half).
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
        stats: {
            days: 30,
            topics: ['activity', 'items', 'users', 'totals'],
            openUrl: 'http://js.example',
            totals: { plays: 214, seconds: 12600 * 4 },
            activity: [
                { id: 's1', title: 'Severance', subtitle: 'Hello, Ms. Cobel', who: 'jordi', device: 'Living room', method: 'DirectPlay',
                  seconds: 2700, at: NOW() - 5 * 60_000, poster: '/api/widgets/jellystat/image?x=1', openUrl: 'http://js.example/libraries/item/s1' },
                { id: 'm1', title: 'Heat', who: 'anna', method: 'Transcode', seconds: 1200, at: NOW() - 3 * 3600_000,
                  openUrl: 'http://js.example/libraries/item/m1' },
            ],
            items: [
                { id: 's1', title: 'Severance', kind: 'series', plays: 9, seconds: 30000, openUrl: 'http://js.example/libraries/item/s1' },
                { id: 'm1', title: 'Heat', kind: 'movie', plays: 5, seconds: 18000, openUrl: 'http://js.example/libraries/item/m1' },
            ],
            users: [
                { id: 'u1', name: 'jordi', plays: 12, openUrl: 'http://js.example/users/u1' },
                { id: 'u2', name: 'anna', plays: 3, openUrl: 'http://js.example/users/u2' },
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
        const stub = async (url, ...rest) => (String(url).includes('/api/widgets/jellystat')
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        window.fetch = stub;
        if (realNext) window.nextDashFetch = stub;
        document.getElementById('js-test')?.remove();
        const host = document.createElement('div');
        host.id = 'js-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.jellystat(body, { id: `w_jellystat_${width}`, type: 'jellystat', config }, d);
        } finally {
            window.fetch = realFetch;
            if (realNext) window.nextDashFetch = realNext;
            delete d._widgetMedia;
        }
    }, { result, config, width });
    return page.locator('#js-test');
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

test.describe('the Jellystat widget', () => {
    test('offered under Media, with a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const media = (Config?.WIDGET_TYPE_GROUPS || []).find(([group]) => group === 'media')?.[1] || [];
            return {
                offered: (Config?.WIDGET_TYPES || []).includes('jellystat'),
                grouped: media.includes('jellystat'),
                renderer: typeof window.DashboardWidgets?.jellystat,
            };
        });
        expect(state).toMatchObject({ offered: true, grouped: true, renderer: 'function' });
    });

    test('one column: tabs, one topic at a time, totals on top', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 320 });
        await expect(tile.locator('.js-figure:visible')).toHaveCount(2);
        await expect(tile.locator('.js-figure:visible').first()).toContainText('214');
        await expect(tile.locator('.js-figure:visible').nth(1)).toContainText('14h');
        await expect(tile.locator('.js-tab:visible')).toHaveCount(3);
        // Recent plays first: the series title, its episode, who and how long ago.
        const first = tile.locator('.js-row:visible').first();
        await expect(first).toContainText('Severance');
        await expect(first).toContainText('Hello, Ms. Cobel');
        await expect(first).toContainText('jordi');
        await expect(first).toContainText('5m');
        await expect(tile.locator('.js-block:visible')).toHaveCount(1);

        await tile.locator('.js-tab:visible', { hasText: 'Most viewed' }).click();
        await expect(tile.locator('.js-block:visible')).toHaveAttribute('data-topic', 'items');
        await expect(tile.locator('.js-row:visible').first()).toContainText('9');
        // The choice survives a redraw.
        await expect(tile.locator('.js-tab[aria-selected="true"]:visible')).toHaveText('Most viewed');
    });

    test('two columns: every topic side by side', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 680 });
        await expect(tile.locator('.js-block:visible')).toHaveCount(3);
        await expect(tile.locator('.js-tab:visible')).toHaveCount(0);
        await expect(tile.locator('.js-block:visible[data-topic="users"] .js-row').first()).toContainText('jordi');
    });

    test('a topic switched off is not drawn, and with one left there are no tabs', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { topics: ['users'] }, width: 320 });
        await expect(tile.locator('.js-tab')).toHaveCount(0);
        await expect(tile.locator('.js-figure')).toHaveCount(0);
        await expect(tile.locator('.js-block:visible')).toHaveAttribute('data-topic', 'users');

        tile = await draw(page, { result: answer(), config: { topics: ['items', 'totals'] }, width: 680 });
        await expect(tile.locator('.js-block:visible')).toHaveCount(1);
        await expect(tile.locator('.js-figure:visible')).toHaveCount(2);
    });

    test('nothing chosen says so', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { topics: [] }, width: 320 });
        await expect(tile).toContainText(/choose what to show/i);
    });

    test('rows cuts every list', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { rows: 1 }, width: 680 });
        await expect(tile.locator('.js-block:visible[data-topic="users"] .js-row')).toHaveCount(1);
        await expect(tile.locator('.js-block:visible[data-topic="activity"] .js-row')).toHaveCount(1);
    });

    test('a quiet period says so instead of drawing an empty list', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer({ activity: [], items: [], users: [], totals: { plays: 0, seconds: 0 } }), width: 680 });
        await expect(tile.locator('.js-empty:visible')).toHaveCount(3);
        await expect(tile).not.toContainText('NaN');
        await expect(tile.locator('.js-figure:visible').first()).toContainText('0');
    });

    test('names from the network are text, never markup', async ({ page }) => {
        await open(page);
        const hostile = answer({ users: [{ id: 'u', name: '<img src=x onerror=window.__pwned=1>', plays: 4, openUrl: 'http://js.example/users/u' }] });
        const tile = await draw(page, { result: hostile, width: 680 });
        await expect(tile.locator('.js-block[data-topic="users"] .js-row').first()).toContainText('<img src=x');
        expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    });

    test('a part that could not be read is said, the rest stays', async ({ page }) => {
        await open(page);
        const result = answer({ users: undefined });
        result.partial = true;
        const tile = await draw(page, { result, width: 680 });
        await expect(tile.locator('.js-foot')).toContainText(/could not be read/i);
        await expect(tile.locator('.js-block:visible[data-topic="items"]')).toBeVisible();
    });

    test('click: open goes straight to Jellystat', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
        const tile = await draw(page, { result: answer(), config: { click: 'open', target: '_blank' }, width: 320 });
        await tile.locator('.js-row:visible').first().click();
        await expect(page.locator('dialog.js-detail')).toHaveCount(0);
        expect(await page.evaluate(() => window.__opened)).toEqual(['http://js.example/libraries/item/s1']);
    });

    test('click: detail opens a card first', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { click: 'detail' }, width: 320 });
        await tile.locator('.js-row:visible').first().click();
        const card = page.locator('dialog.js-detail');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Severance');
        await expect(card).toContainText('Living room');
        await card.getByRole('button', { name: /close/i }).click();
        await expect(card).toHaveCount(0);
    });

    test('Connect lists the libraries, and the topics and period are saved', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/jellystat/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                connected: '2 libraries', libraries: [{ id: 'lib-m', name: 'Movies' }, { id: 'lib-s', name: 'Shows' }] }) });
        });
        const panel = await addInConfig(page, 'jellystat');
        await panel.locator('[data-widget-setting="server"]').fill('http://jellystat.lan:3000');
        await panel.locator('[data-widget-auth="secret"]').fill('js-key-0123456789');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('2 libraries');
        expect(sent?.draftCredential?.headers?.['X-Api-Token']).toBe('js-key-0123456789');

        await panel.locator('[data-widget-setting="libraries"][value="lib-s"]').uncheck();
        await panel.locator('[data-widget-setting="topics"][value="users"]').uncheck();
        await panel.locator('[data-widget-setting="days"]').fill('7');
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page, 'jellystat'))?.days ?? null, { timeout: 15_000 }).toBe(7);
        const saved = await savedConfig(page, 'jellystat');
        expect(saved.libraries).toEqual(['lib-m']);
        expect(saved.topics).toEqual(['activity', 'items', 'totals']);
        expect(JSON.stringify(saved)).not.toContain('js-key-0123456789');

        // The key is filed, and a reload of the panel still knows it.
        const filed = await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const all = await (await send('/api/health/credentials')).json();
            return Object.values(all.details || {}).filter((d) => (d.headers || []).includes('X-Api-Token')).length;
        });
        expect(filed).toBe(1);
        await open(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.locator('[data-widget-settings]').first().click();
        const again = page.locator('[data-widget-detail]').first();
        await expect(again.locator('[data-widget-auth="secret"]')).toHaveAttribute('placeholder', /^Set/);

    });
});
