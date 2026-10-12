// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The Jellyfin widget: what was added to the media server lately, with posters.
 *
 * Drawn with a stubbed answer, the way the RSS spec does: the server half has
 * its own Go tests, and this file is about what the tile does with an answer.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const hour = 3600_000;

function answer(extra = {}) {
    const now = Date.now();
    return {
        fetchedAt: now,
        libraries: [{ id: 'lib-movies', name: 'Films' }, { id: 'lib-tv', name: 'Series' }, { id: 'lib-anime', name: 'Anime' }],
        items: [
            { id: 'm1', title: 'Dune: Part Two', kind: 'movie', year: 2024, genres: ['Science Fiction'], runtimeMinutes: 166,
              overview: 'Paul joins the Fremen.', library: 'Films', libraryId: 'lib-movies', addedAt: now - 3 * hour,
              poster: PNG, backdrop: PNG, openUrl: 'https://jellyfin.example/web/#/details?id=m1' },
            { id: 'e1', title: 'Severance', subtitle: 'S02E07 · Cold Harbor', kind: 'episode', library: 'Series',
              libraryId: 'lib-tv', addedAt: now - 20 * hour, poster: PNG, openUrl: 'https://jellyfin.example/web/#/details?id=e1' },
            { id: 's2', title: 'Frieren', kind: 'series', newCount: 4, library: 'Anime', libraryId: 'lib-anime',
              addedAt: now - 30 * hour, openUrl: 'https://jellyfin.example/web/#/details?id=s2' },
            ...['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'].map((id, at) => ({
                id, title: `Film ${id}`, kind: 'movie', library: 'Films', libraryId: 'lib-movies', played: at === 0,
                addedAt: now - (40 + at) * hour, poster: PNG, openUrl: `https://jellyfin.example/web/#/details?id=${id}`,
            })),
        ],
        ...extra,
    };
}

/** Draw the tile at a given width with a stubbed answer; leaves it on the page. */
async function draw(page, { result, config = {}, width = 320 }) {
    await page.evaluate(async ({ result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes('/api/widgets/jellyfin')
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('jf-test')?.remove();
        const host = document.createElement('div');
        host.id = 'jf-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets.jellyfin(body, { id: 'w_jf1', type: 'jellyfin', config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { result, config, width });
    return page.locator('#jf-test');
}

/** How many of a selector are actually on screen (container queries hide the rest). */
async function visible(tile, selector) {
    return tile.locator(selector).evaluateAll((els) => els.filter((el) => el.checkVisibility()).length);
}

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
    await page.locator(`.modal--widget-catalogue [data-widget-add="${type}"]`).click();
    await expect(page.locator('.config-widget-row').last().locator('[data-widget="title"]'))
        .toBeFocused({ timeout: 10_000 });
    const toggle = page.locator('[data-widget-settings]').last();
    const index = await toggle.getAttribute('data-widget-settings');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(page.locator(`[data-widget-detail="${index}"]`)).toBeVisible();
    return page.locator(`[data-widget-detail="${index}"]`);
}

test.describe('the Jellyfin widget', () => {
    test('it is offered, has a renderer and declares its settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderer: typeof window.DashboardWidgets?.jellyfin,
                settings: (Config?.WIDGET_SETTINGS?.jellyfin || []).map((f) => f.key),
            };
        });
        expect(state.offered).toContain('jellyfin');
        expect(state.renderer).toBe('function');
        expect(state.settings).toEqual(['layout', 'click', 'target', 'hideWatched', 'rows', 'ttl']);
    });

    test('the list shows titles, library and pictures, newest first', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { rows: 3 } });
        const rows = tile.locator('[data-media-item]');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('Dune: Part Two');
        await expect(rows.nth(1)).toContainText('Severance — S02E07 · Cold Harbor');
        await expect(rows.nth(2)).toContainText('+4');
        await expect(rows.nth(0).locator('img')).toHaveAttribute('loading', 'lazy');
        // No poster: initials stand in, not a broken image.
        await expect(rows.nth(2).locator('.media-art')).toHaveClass(/is-missing/);
        await expect(rows.nth(2).locator('.media-art')).toContainText('F');
        expect(await rows.evaluateAll((els) => els.map((el) => el.tagName))).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    });

    test('each error code is worded', async ({ page }) => {
        await open(page);
        for (const [code, words] of [
            ['not set up', /settings/i],
            ['key refused', /refused/i],
            ['address not allowed', /local/i],
            ['no libraries', /choose again/i],
            ['unreachable', /could not be reached/i],
        ]) {
            const tile = await draw(page, { result: { items: [], libraries: [], fetchedAt: Date.now(), error: code } });
            await expect(tile).toContainText(words);
        }
    });

    test('a stale answer is drawn, with why and how old', async ({ page }) => {
        await open(page);
        const result = answer({ error: 'unreachable', stale: true, fetchedAt: Date.now() - 12 * 60_000 });
        const tile = await draw(page, { result });
        await expect(tile.locator('[data-media-item]').first()).toBeVisible();
        await expect(tile.locator('.media-stale')).toContainText(/could not be reached.*12m/i);
    });

    test('an empty answer says so', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: { items: [], libraries: [], fetchedAt: Date.now() } });
        await expect(tile).toContainText(/nothing new/i);
    });

    test('two columns show more per row than one', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { layout: 'list', rows: 4 }, width: 320 });
        expect(await visible(tile, '.media-overview')).toBe(0);
        tile = await draw(page, { result: answer(), config: { layout: 'list', rows: 4 }, width: 680 });
        expect(await visible(tile, '.media-overview')).toBe(1);
        await expect(tile.locator('.media-meta:visible').first()).toContainText('2024');
    });

    test('a long title does not push the second column out of the tile', async ({ page }) => {
        await open(page);
        const long = 'Stuart Fails to Save the Universe — S00E07 · Expanding the Universe Part 2 and then some more words';
        const result = answer();
        result.items[1] = { ...result.items[1], title: long, subtitle: '' };
        for (const layout of ['list', 'hero']) {
            const tile = await draw(page, { result, config: { layout, rows: 6 }, width: 680 });
            const geometry = await tile.evaluate((host) => {
                const edge = host.getBoundingClientRect().right;
                const rows = [...host.querySelectorAll('.media-row')].filter((el) => el.checkVisibility());
                return {
                    inside: rows.every((row) => row.getBoundingClientRect().right <= edge + 1),
                    lefts: [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().left)))].length,
                    scrolls: host.scrollWidth > host.clientWidth + 1,
                };
            });
            expect(geometry.inside, `${layout}: every row stays inside the tile`).toBe(true);
            expect(geometry.scrolls, `${layout}: the tile does not scroll sideways`).toBe(false);
            if (layout === 'list') expect(geometry.lefts, 'two columns of rows').toBe(2);
        }
    });

    test('grid, list and hero give every library a place when films are newest', async ({ page }) => {
        await open(page);
        const now = Date.now();
        const film = (n) => ({ id: `f${n}`, title: `Film ${n}`, kind: 'movie', library: 'Films', libraryId: 'lib-movies',
            addedAt: now - n * hour, poster: PNG, openUrl: `https://jellyfin.example/web/#/details?id=f${n}` });
        const result = {
            fetchedAt: now,
            libraries: [{ id: 'lib-movies', name: 'Films' }, { id: 'lib-tv', name: 'Series' }, { id: 'lib-anime', name: 'Anime' }],
            // Eight films, all newer than the one show and the one anime.
            items: [
                ...[1, 2, 3, 4, 5, 6, 7, 8].map(film),
                { id: 'tv1', title: 'Severance', kind: 'episode', library: 'Series', libraryId: 'lib-tv',
                  addedAt: now - 50 * hour, poster: PNG, openUrl: 'https://jellyfin.example/web/#/details?id=tv1' },
                { id: 'an1', title: 'Frieren', kind: 'series', library: 'Anime', libraryId: 'lib-anime',
                  addedAt: now - 60 * hour, poster: PNG, openUrl: 'https://jellyfin.example/web/#/details?id=an1' },
            ],
        };
        for (const layout of ['grid', 'list', 'hero']) {
            const tile = await draw(page, { result, config: { layout, rows: 6 }, width: 680 });
            const shown = await tile.locator('[data-media-item]').evaluateAll((els) => els.map((el) => el.dataset.mediaItem));
            expect(shown, `${layout}: one show and one anime among the films`).toEqual(expect.arrayContaining(['tv1', 'an1']));
            expect(shown.length, `${layout}: still ${6} items`).toBe(6);
            // Newest first, as a timeline reads.
            const times = shown.map((id) => result.items.find((item) => item.id === id).addedAt);
            expect(times, `${layout}: newest first`).toEqual([...times].sort((a, b) => b - a));
        }
    });

    test('strip: a library that could not be read says so instead of "nothing new"', async ({ page }) => {
        await open(page);
        const result = answer({ partial: true });
        result.items = result.items.filter((item) => item.libraryId !== 'lib-anime');
        const tile = await draw(page, { result, config: { layout: 'strip' } });
        await tile.locator('[data-media-tab="lib-anime"]').click();
        await expect(tile.locator('.media-strip-empty')).toContainText(/could not be read/i);
        await tile.locator('[data-media-tab="lib-tv"]').click();
        await expect(tile.locator('[data-media-item]')).toHaveCount(1);
    });

    test('strip: a tab per library, four posters narrow and eight wide', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { layout: 'strip', rows: 8 }, width: 320 });
        await expect(tile.locator('[data-media-tab]')).toHaveText(['Films', 'Series', 'Anime']);
        expect(await visible(tile, '[data-media-item]')).toBe(4);

        tile = await draw(page, { result: answer(), config: { layout: 'strip', rows: 8 }, width: 680 });
        expect(await visible(tile, '[data-media-item]')).toBe(8);

        await tile.locator('[data-media-tab="lib-anime"]').click();
        await expect(tile.locator('[data-media-tab="lib-anime"]')).toHaveAttribute('aria-selected', 'true');
        await expect(tile.locator('[data-media-item]')).toHaveCount(1);
        await expect(tile.locator('[data-media-tab="lib-anime"]')).toBeFocused();
    });

    test('hero: the newest large with a backdrop, the rest as a list', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { layout: 'hero', rows: 3 }, width: 320 });
        await expect(tile.locator('.media-hero')).toContainText('Dune: Part Two');
        await expect(tile.locator('.media-hero .media-art--backdrop img')).toHaveCount(1);
        await expect(tile.locator('.media-row')).toHaveCount(2);
        expect(await visible(tile, '.media-hero .media-overview')).toBe(0);

        tile = await draw(page, { result: answer(), config: { layout: 'hero', rows: 3 }, width: 680 });
        expect(await visible(tile, '.media-hero .media-overview')).toBe(1);
    });

    test('grid: titles only when wide', async ({ page }) => {
        await open(page);
        let tile = await draw(page, { result: answer(), config: { layout: 'grid', rows: 6 }, width: 320 });
        await expect(tile.locator('[data-media-item]')).toHaveCount(6);
        expect(await visible(tile, '.media-caption')).toBe(0);

        tile = await draw(page, { result: answer(), config: { layout: 'grid', rows: 6 }, width: 680 });
        expect(await visible(tile, '.media-caption')).toBe(6);
    });

    test('a click opens Jellyfin where the widget says', async ({ page, context }) => {
        await open(page);
        // On the context: the popup is a page of its own and the route must reach it too.
        await context.route('https://jellyfin.example/**', (route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: '<title>jf</title>' }));

        // _blank: a new tab.
        let tile = await draw(page, { result: answer(), config: { target: '_blank', rows: 1 } });
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            tile.locator('[data-media-item]').first().click(),
        ]);
        await popup.waitForURL(/jellyfin\.example\/web\//);
        await popup.close();

        // inherit follows the dashboard's own setting.
        const inherited = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const before = d.settings.openInNewTab;
            const ask = (value) => {
                d.settings.openInNewTab = value;
                return window.DashboardJellyfin.targetFor(d, { config: { target: 'inherit' } });
            };
            const out = [ask(true), ask(false)];
            d.settings.openInNewTab = before;
            return out;
        });
        expect(inherited).toEqual(['_blank', '_self']);

        // _self: this tab.
        tile = await draw(page, { result: answer(), config: { target: '_self', rows: 1 } });
        await tile.locator('[data-media-item]').first().click();
        await expect(page).toHaveURL(/jellyfin\.example\/web/);
    });

    test('detail: a card with the facts, closed with Escape, focus back on the item', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { click: 'detail', target: '_self', rows: 2 } });
        const first = tile.locator('[data-media-item]').first();
        await first.focus();
        await page.keyboard.press('Enter');

        const card = page.locator('dialog.media-detail[open]');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Dune: Part Two');
        await expect(card).toContainText('166 min');
        await expect(card).toContainText('Paul joins the Fremen.');
        await expect(card.locator('[data-media-open]')).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(card).toHaveCount(0);
        await expect(first).toBeFocused();
    });

    test('a saved widget opens with its choices, and no user is a choice', async ({ page }) => {
        await page.route('**/api/widgets/jellyfin/setup', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                serverName: 'Home', version: '10.11.0',
                users: [{ id: 'u1', name: 'jordi' }],
                libraries: [{ id: 'lib-movies', name: 'Films' }, { id: 'lib-anime', name: 'Anime' }],
            }) });
        });
        await open(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        // Quickstart sweeps favicons on a fresh store and reopens Overview when it finishes; let that end first.
        await page.waitForTimeout(6000);
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = {
                'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
            };
            await f('/api/health/credentials', { method: 'PUT', headers, body: JSON.stringify({
                id: 'widget:w_jfsaved00001', label: 'Jellyfin', headers: { 'X-Emby-Token': 'k-123' } }) });
            await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [{
                id: 'w_jfsaved00001', type: 'jellyfin', title: 'Media',
                config: { server: 'http://jellyfin.lan:8096', credentialId: 'widget:w_jfsaved00001' } }] }) });
            await window.dashboardInstance.config.openConfigView('widgets');
        });
        await page.locator('[data-widget-settings]').first().click();

        // No Connect clicked: the key is already filed, so the choices are asked for.
        const row = page.locator('[data-widget-detail]').first();
        await expect(row.locator('[data-widget-setting="libraries"][value="lib-anime"]')).toBeVisible({ timeout: 15_000 });
        await expect(row.locator('[data-widget-setting="userId"]')).toHaveValue('');

        await row.locator('[data-widget-setting="libraries"][value="lib-movies"]').uncheck();
        await row.locator('[data-widget-save]').click();
        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            const widget = (blocks.widgets || []).find((w) => w.type === 'jellyfin');
            return widget ? { libraries: widget.config.libraries, userId: widget.config.userId ?? null } : null;
        }), { timeout: 15_000 }).toEqual({ libraries: ['lib-anime'], userId: null });
    });

    test('set up from the panel: connect, choose a user and libraries, save', async ({ page }) => {
        await page.route('**/api/widgets/jellyfin/setup', async (route) => {
            const body = route.request().postDataJSON();
            const typed = body?.draftCredential?.headers?.['X-Emby-Token'];
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(typed === 'k-123'
                ? { serverName: 'Home', version: '10.10.3',
                    users: [{ id: 'u1', name: 'jordi' }, { id: 'u2', name: 'kids' }],
                    libraries: [{ id: 'lib-movies', name: 'Films' }, { id: 'lib-anime', name: 'Anime' }] }
                : { users: [], libraries: [], error: 'key refused' }) });
        });
        const row = await addInConfig(page, 'jellyfin');

        await row.locator('[data-widget-setting="server"]').fill('http://jellyfin.lan:8096');
        await row.locator('[data-widget-auth="secret"]').fill('wrong');
        await row.locator('[data-media-connect]').click();
        await expect(row.locator('[data-media-status]')).toContainText(/refused/i);

        await row.locator('[data-widget-auth="secret"]').fill('k-123');
        await row.locator('[data-media-connect]').click();
        await expect(row.locator('[data-media-status]')).toContainText('Home');
        // The typed key is still in its box after the panel redraws.
        await expect(row.locator('[data-widget-auth="secret"]')).toHaveValue('k-123');
        await row.locator('[data-widget-setting="userId"]').selectOption('u2');
        await row.locator('[data-widget-setting="libraries"][value="lib-movies"]').uncheck();
        await row.locator('[data-widget-save]').click();

        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            const widget = (blocks.widgets || []).find((w) => w.type === 'jellyfin');
            return widget ? { ...widget.config } : null;
        }), { timeout: 15_000 }).toMatchObject({
            server: 'http://jellyfin.lan:8096', userId: 'u2', libraries: ['lib-anime'],
        });

        const credentials = await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await send('/api/health/credentials')).json();
        });
        expect(JSON.stringify(credentials)).not.toContain('k-123');
        expect(Object.keys(credentials.credentials || {}).some((id) => id.startsWith('widget:'))).toBe(true);
    });
});
