// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Prowlarr: the indexers, what needs attention and a line of totals, each
 * optional. Drawn with a stubbed answer in the shape the server
 * sends (widgets_prowlarr_test.go has the Go tests for the service half).
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
        indexers: {
            days: 7,
            topics: ['indexers', 'issues', 'totals'],
            openUrl: 'http://pr.example',
            totals: { enabled: 4, total: 6, queries: 26599, grabs: 558, failed: 26 },
            indexers: [
                { id: 11, name: 'Example Indexer 6', protocol: 'usenet', queries: 5811, grabs: 4, failed: 0, avgMs: 4604, paused: true, openUrl: 'http://pr.example/indexers' },
                { id: 1, name: 'Example Indexer 1', protocol: 'usenet', queries: 5860, grabs: 195, failed: 0, avgMs: 424, openUrl: 'http://pr.example/indexers' },
                { id: 2, name: 'Example Indexer 2', protocol: 'torrent', queries: 5844, grabs: 79, failed: 8, avgMs: 440, openUrl: 'http://pr.example/indexers' },
            ],
            issues: [
                { id: 'p11', level: 'error', text: 'Example Indexer 6', until: NOW() + 3600_000, openUrl: 'http://pr.example/indexers' },
                { id: 'h0', level: 'warning', text: 'Indexers are unavailable due to failures for more than 6 hours: Example App', openUrl: 'http://pr.example/system/status' },
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
        const stub = async (url, ...rest) => (String(url).includes('/api/widgets/prowlarr')
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        window.fetch = stub;
        if (realNext) window.nextDashFetch = stub;
        document.getElementById('pw-test')?.remove();
        const host = document.createElement('div');
        host.id = 'pw-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.prowlarr(body, { id: `w_prowlarr_${width}`, type: 'prowlarr', config }, d);
        } finally {
            window.fetch = realFetch;
            if (realNext) window.nextDashFetch = realNext;
            delete d._widgetMedia;
        }
    }, { result, config, width });
    return page.locator('#pw-test');
}

async function addInConfig(page, type) {
    await open(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
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

test.describe('the Prowlarr widget', () => {
    test('offered under Media, with a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            const media = (Config?.WIDGET_TYPE_GROUPS || []).find(([group]) => group === 'media')?.[1] || [];
            return {
                offered: (Config?.WIDGET_TYPES || []).includes('prowlarr'),
                grouped: media.includes('prowlarr'),
                renderer: typeof window.DashboardWidgets?.prowlarr,
            };
        });
        expect(state).toMatchObject({ offered: true, grouped: true, renderer: 'function' });
    });

    test('one column: tabs, one topic at a time, totals on top', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 320 });
        await expect(tile.locator('.pw-figure:visible')).toHaveCount(4);
        await expect(tile.locator('.pw-figure:visible').first()).toContainText('4/6');
        await expect(tile.locator('.pw-figure--bad:visible')).toContainText('26');
        await expect(tile.locator('.pw-tab:visible')).toHaveCount(2);
        await expect(tile.locator('.pw-block:visible')).toHaveCount(1);
        // A paused indexer comes first and says so; a failing one says how often.
        const first = tile.locator('.pw-row:visible').first();
        await expect(first).toContainText('Example Indexer 6');
        await expect(first.locator('.pw-chip--bad')).toContainText(/paused/i);
        await expect(tile.locator('.pw-row:visible').nth(2).locator('.pw-chip--bad')).toContainText('8');
        await expect(tile.locator('.pw-row:visible').nth(1)).toContainText('424 ms');

        await tile.locator('.pw-tab:visible', { hasText: 'Attention' }).click();
        await expect(tile.locator('.pw-block:visible')).toHaveAttribute('data-topic', 'issues');
        await expect(tile.locator('.pw-row:visible').first()).toContainText(/paused until/i);
        await expect(tile.locator('.pw-row:visible').nth(1)).toContainText('unavailable');
        await expect(tile.locator('.pw-tab[aria-selected="true"]:visible')).toHaveText('Attention');
    });

    test('two columns: both topics side by side', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), width: 680 });
        await expect(tile.locator('.pw-block:visible')).toHaveCount(2);
        await expect(tile.locator('.pw-tab:visible')).toHaveCount(0);
    });

    test('a topic switched off is not drawn, and with one left there are no tabs', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { topics: ['issues'] }, width: 320 });
        await expect(tile.locator('.pw-tab')).toHaveCount(0);
        await expect(tile.locator('.pw-figure')).toHaveCount(0);
        await expect(tile.locator('.pw-block:visible')).toHaveAttribute('data-topic', 'issues');

        tile = await draw(page, { result: answer(), config: { topics: ['totals'] }, width: 680 });
        await expect(tile.locator('.pw-block')).toHaveCount(0);
        await expect(tile.locator('.pw-figure:visible')).toHaveCount(4);
    });

    test('nothing chosen says so', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { topics: [] }, width: 320 });
        await expect(tile).toContainText(/choose what to show/i);
    });

    test('rows cuts every list', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { rows: 1 }, width: 680 });
        await expect(tile.locator('.pw-block:visible[data-topic="indexers"] .pw-row')).toHaveCount(1);
        await expect(tile.locator('.pw-block:visible[data-topic="issues"] .pw-row')).toHaveCount(1);
    });

    test('nothing wrong says all clear, and no failures are not marked', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer({ issues: [], indexers: [], totals: { enabled: 0, total: 0, queries: 0, grabs: 0, failed: 0 } }), width: 680 });
        await expect(tile.locator('.pw-empty:visible')).toHaveCount(2);
        await expect(tile.locator('.pw-block:visible[data-topic="issues"]')).toContainText(/all clear/i);
        await expect(tile).not.toContainText('NaN');
        await expect(tile.locator('.pw-figure--bad')).toHaveCount(0);
    });

    test('names from the network are text, never markup', async ({ page }) => {
        await open(page);
        const hostile = answer({
            indexers: [{ id: 9, name: '<img src=x onerror=window.__pwned=1>', protocol: 'usenet', queries: 1, grabs: 0, failed: 0, avgMs: 0, openUrl: 'http://pr.example/indexers' }],
            issues: [{ id: 'h0', level: 'warning', text: '<b>bold</b>', openUrl: 'http://pr.example/system/status' }],
        });
        const tile = await draw(page, { result: hostile, width: 680 });
        await expect(tile.locator('.pw-block[data-topic="indexers"] .pw-row').first()).toContainText('<img src=x');
        await expect(tile.locator('.pw-block[data-topic="issues"] .pw-title').first()).toHaveText('<b>bold</b>');
        expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    });

    test('a part that could not be read is said, the rest stays', async ({ page }) => {
        await open(page);
        const result = answer({ issues: undefined });
        result.partial = true;
        const tile = await draw(page, { result, width: 680 });
        await expect(tile.locator('.pw-foot')).toContainText(/could not be read/i);
        await expect(tile.locator('.pw-block:visible[data-topic="indexers"]')).toBeVisible();
    });

    test('click: open goes straight to Prowlarr', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return null; }; });
        const tile = await draw(page, { result: answer(), config: { click: 'open', target: '_blank' }, width: 320 });
        await tile.locator('.pw-row:visible').first().click();
        await expect(page.locator('dialog.pw-detail')).toHaveCount(0);
        expect(await page.evaluate(() => window.__opened)).toEqual(['http://pr.example/indexers']);
    });

    test('click: detail opens a card first', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { click: 'detail' }, width: 320 });
        await tile.locator('.pw-row:visible').nth(1).click();
        const card = page.locator('dialog.pw-detail');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Example Indexer 1');
        await expect(card).toContainText('424 ms');
        await card.getByRole('button', { name: /close/i }).click();
        await expect(card).toHaveCount(0);
    });

    test('Connect names the version, and the topics and period are saved', async ({ page }) => {
        let sent = null;
        await page.route('**/api/widgets/prowlarr/setup', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: 'Prowlarr 2.7.0.5723' }) });
        });
        const panel = await addInConfig(page, 'prowlarr');
        await panel.locator('[data-widget-setting="server"]').fill('http://prowlarr.lan:9696');
        await panel.locator('[data-widget-auth="secret"]').fill('pr-key-0123456789');
        await panel.locator('[data-media-connect]').click();
        await expect(panel.locator('[data-media-status]')).toContainText('Prowlarr 2.7.0.5723');
        expect(sent?.draftCredential?.headers?.['X-Api-Key']).toBe('pr-key-0123456789');

        await panel.locator('[data-widget-setting="topics"][value="totals"]').uncheck();
        await panel.locator('[data-widget-setting="days"]').fill('14');
        await panel.locator('[data-widget-save]').click();
        await expect.poll(async () => (await savedConfig(page, 'prowlarr'))?.days ?? null, { timeout: 15_000 }).toBe(14);
        const saved = await savedConfig(page, 'prowlarr');
        expect(saved.topics).toEqual(['indexers', 'issues']);
        expect(JSON.stringify(saved)).not.toContain('pr-key-0123456789');
    });

    test('counts the server could not read are dashes and the rows leave them out', async ({ page }) => {
        await open(page);
        const result = answer({
            totals: { enabled: 4, total: 6 },
            indexers: [{ id: 1, name: 'Example Indexer 1', protocol: 'usenet', queries: 0, grabs: 0, failed: 0, avgMs: 0, noStats: true, openUrl: 'http://pr.example/indexers' }],
        });
        const tile = await draw(page, { result, width: 680 });
        await expect(tile.locator('.pw-figure:visible').first()).toContainText('4/6');
        await expect(tile.locator('.pw-figure:visible').nth(1)).toContainText('–');
        await expect(tile.locator('.pw-block[data-topic="indexers"] .pw-row').first()).not.toContainText('queries');
    });
});
