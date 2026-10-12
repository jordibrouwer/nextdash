// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Sonarr and Radarr: what is coming and what is downloading, through the
 * shared media tile. Drawn with a stubbed answer; the server half has Go tests.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const day = 86_400_000;

function answer(extra = {}) {
    const now = Date.now();
    return {
        fetchedAt: now,
        libraries: [{ id: 'upcoming', name: 'Upcoming' }, { id: 'queue', name: 'Queue' }],
        items: [
            { id: 'e11', title: 'Severance', subtitle: 'S02E08 · Sweet Vitriol', kind: 'episode', library: 'Upcoming',
              libraryId: 'upcoming', when: now + day + 3_600_000, addedAt: now + day + 3_600_000, poster: PNG,
              openUrl: 'https://sonarr.example/series/severance' },
            { id: 'q3', title: 'The Bear', subtitle: 'S04E01 · Groundhog', kind: 'episode', library: 'Queue',
              libraryId: 'queue', progress: 0.75, left: '00:10:00', addedAt: now, poster: PNG,
              openUrl: 'https://sonarr.example/series/the-bear' },
        ],
        ...extra,
    };
}

async function draw(page, { type = 'sonarr', result, config = {}, width = 320 }) {
    await page.evaluate(async ({ type, result, config, width }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        window.fetch = async (url, ...rest) => (String(url).includes(`/api/widgets/${type}`)
            ? new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : realFetch(url, ...rest));
        document.getElementById('arr-test')?.remove();
        const host = document.createElement('div');
        host.id = 'arr-test';
        host.style.width = `${width}px`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);
        try {
            await window.DashboardWidgets[type](body, { id: 'w_arr1', type, config }, d);
        } finally {
            window.fetch = realFetch;
            delete d._widgetMedia;
        }
    }, { type, result, config, width });
    return page.locator('#arr-test');
}

test.describe('the Sonarr and Radarr widgets', () => {
    test('offered, with a renderer and their settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderers: [typeof window.DashboardWidgets?.sonarr, typeof window.DashboardWidgets?.radarr],
                sonarr: (Config?.WIDGET_SETTINGS?.sonarr || []).map((f) => f.key),
                radarr: (Config?.WIDGET_SETTINGS?.radarr || []).map((f) => f.key),
            };
        });
        expect(state.offered).toEqual(expect.arrayContaining(['sonarr', 'radarr']));
        expect(state.renderers).toEqual(['function', 'function']);
        expect(state.sonarr).toEqual(['show', 'days', 'layout', 'click', 'target', 'rows', 'ttl']);
        expect(state.radarr).toEqual(state.sonarr);
    });

    test('queue rows show progress, upcoming rows say when', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { layout: 'list' } });
        const upcoming = tile.locator('[data-media-item="e11"]');
        const queued = tile.locator('[data-media-item="q3"]');
        await expect(upcoming).toContainText('Severance — S02E08 · Sweet Vitriol');
        await expect(upcoming).toContainText('in 1d');
        await expect(queued.locator('.media-progress')).toHaveAttribute('aria-valuenow', '75');
        await expect(queued).toContainText('00:10:00');
    });

    test('the calendar reads soonest first, after what is downloading', async ({ page }) => {
        await open(page);
        const now = Date.now();
        const result = answer();
        result.items.push({ id: 'e12', title: 'Later show', kind: 'episode', library: 'Upcoming', libraryId: 'upcoming',
            when: now + 5 * day, addedAt: now + 5 * day, poster: PNG, openUrl: 'https://sonarr.example/series/later' });
        const tile = await draw(page, { result, config: { layout: 'list', rows: 6 } });
        const order = await tile.locator('[data-media-item]').evaluateAll((els) => els.map((el) => el.dataset.mediaItem));
        expect(order).toEqual(['q3', 'e11', 'e12']);
    });

    test('an empty queue says so, not "nothing new"', async ({ page }) => {
        await open(page);
        const result = { fetchedAt: Date.now(), libraries: [{ id: 'queue', name: 'Queue' }], items: [] };
        const tile = await draw(page, { result, config: { show: 'queue' } });
        await expect(tile).toContainText(/nothing in the queue/i);
        const upcoming = { fetchedAt: Date.now(), libraries: [{ id: 'upcoming', name: 'Upcoming' }], items: [] };
        const tile2 = await draw(page, { type: 'radarr', result: upcoming, config: { show: 'upcoming', days: 14 } });
        await expect(tile2).toContainText(/nothing coming up in the next 14 days/i);
    });

    test('the strip has Upcoming and Queue tabs', async ({ page }) => {
        await open(page);
        const tile = await draw(page, { result: answer(), config: { layout: 'strip' } });
        await expect(tile.locator('[data-media-tab]')).toHaveText(['Upcoming', 'Queue']);
        await tile.locator('[data-media-tab="queue"]').click();
        await expect(tile.locator('[data-media-item]')).toHaveCount(1);
        await expect(tile.locator('[data-media-item="q3"] .media-progress')).toBeVisible();
    });

    test('two columns: a long title and the progress bar stay inside the tile', async ({ page }) => {
        await open(page);
        const result = answer();
        result.items[1] = { ...result.items[1], title: 'A very long title of a show that goes on and on and on and on' };
        const tile = await draw(page, { result, config: { layout: 'list' }, width: 680 });
        const inside = await tile.evaluate((host) => {
            const edge = host.getBoundingClientRect().right;
            return [...host.querySelectorAll('.media-row, .media-progress')]
                .every((el) => el.getBoundingClientRect().right <= edge + 1);
        });
        expect(inside).toBe(true);
    });
});
