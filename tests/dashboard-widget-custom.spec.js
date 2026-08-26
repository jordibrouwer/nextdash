// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The one widget that reads from outside.
 *
 * Every dashboard that grew a widget per service ended up maintaining one thing
 * per upstream release it does not control. This is the escape hatch instead: a
 * JSON address, a few paths, and a format each.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('the custom widget', () => {
    test('it is offered and has a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderer: typeof window.DashboardWidgets?.custom,
                settings: (Config?.WIDGET_SETTINGS?.custom || []).map((f) => f.key),
            };
        });
        expect(state.offered).toContain('custom');
        expect(state.renderer).toBe('function');
        // url, credential, ttl and the list path — the fields[] editor is drawn
        // separately, because a list of objects is not a row in that table.
        expect(state.settings).toEqual(['url', 'credentialId', 'ttl', 'itemsPath']);
    });

    test('it draws the figures the server extracted', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/custom')) {
                    return new Response(JSON.stringify({
                        fetchedAt: Date.now(),
                        values: [
                            { label: 'photos', value: '4 210' },
                            { label: 'storage', value: '1.5 KB' },
                            { label: 'videos', value: '—', missing: true },
                        ],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.custom(body, { id: 'w_x', type: 'custom', config: {} }, d);
            } finally {
                window.fetch = realFetch;
                delete d._widgetCustom;
            }
            const figures = [...body.querySelectorAll('.dashboard-widget-figure')];
            return {
                values: figures.map((f) => f.querySelector('.dashboard-widget-figure-value')?.textContent),
                labels: figures.map((f) => f.querySelector('.dashboard-widget-figure-label')?.textContent),
                missing: figures.map((f) => f.classList.contains('is-missing')),
                asOf: !!body.querySelector('.dashboard-widget-asof'),
            };
        });
        expect(rendered.values).toEqual(['4 210', '1.5 KB', '—']);
        expect(rendered.labels).toEqual(['photos', 'storage', 'videos']);
        // A path that stopped matching is marked, because a blank reads as zero.
        expect(rendered.missing).toEqual([false, false, true]);
        // A cached figure that looks live is worse than a stale one that says so.
        expect(rendered.asOf).toBe(true);
    });

    test('it repeats the reason a fetch failed rather than saying nothing', async ({ page }) => {
        await open(page);
        const text = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/custom')) {
                    return new Response(JSON.stringify({
                        fetchedAt: Date.now(), error: 'that address is not allowed',
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.custom(body, { id: 'w_y', type: 'custom', config: {} }, d);
            } finally {
                window.fetch = realFetch;
                delete d._widgetCustom;
            }
            return body.textContent || '';
        });
        // The server knows which failure it was; each sends the reader somewhere
        // different, so the tile repeats it rather than saying "unavailable".
        expect(text).toContain('not allowed');
    });

    test('the settings panel offers a fields editor', async ({ page }) => {
        await open(page);
        await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: [{
                    type: 'custom', title: 'Immich',
                    config: { url: 'https://service.example/api/stats',
                        fields: [{ path: 'photos', label: 'photos', format: 'count' }] },
                }] }),
            });
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForSelector('[data-widget-settings]', { timeout: 15_000 });
        await page.locator('[data-widget-settings]').first().click();

        await expect(page.locator('[data-widget-setting="url"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-custom-field="path"]')).toHaveValue('photos');
        await expect(page.locator('[data-custom-field="format"]')).toHaveValue('count');
        await expect(page.locator('[data-custom-add]')).toBeVisible();
    });

    // A path typed in the editor reaches storage, and the server keeps only what
    // it can act on.
    test('a figure added in the editor is stored', async ({ page }) => {
        await open(page);
        await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: [{
                    type: 'custom', title: 'Immich',
                    config: { url: 'https://service.example/api/stats' },
                }] }),
            });
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForSelector('[data-widget-settings]', { timeout: 15_000 });
        await page.locator('[data-widget-settings]').first().click();
        await page.waitForSelector('[data-custom-add]', { timeout: 15_000 });
        await page.locator('[data-custom-add]').click();

        await page.waitForSelector('[data-custom-field="path"]', { timeout: 15_000 });
        await page.locator('[data-custom-field="path"]').fill('server.disk[0].used');
        await page.locator('[data-custom-field="path"]').dispatchEvent('change');

        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            return (blocks.widgets?.[0]?.config?.fields || []).map((f) => f.path);
        }), { timeout: 15_000 }).toEqual(['server.disk[0].used']);
    });

    /*
     * The panel has to be readable, which is a measurement and not a matter of
     * taste.
     *
     * The fields row is four controls wide and sat in one column of a
     * three-column grid: measured at 579px of content in a 247px column, so the
     * path and the label overlapped by sixty pixels and the row scrolled
     * sideways inside itself.
     */
    test('the settings panel lays out without overlap', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 1100 });
        await open(page);
        await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: [{
                    type: 'custom', title: 'Immich',
                    config: {
                        url: 'https://nas.lan:2283/api/server/statistics',
                        fields: [
                            { path: 'photos', label: 'photos', format: 'count' },
                            { path: 'usage', label: 'storage', format: 'bytes' },
                        ],
                    },
                }] }),
            });
        });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForSelector('[data-widget-settings]', { timeout: 15_000 });
        await page.locator('[data-widget-settings]').first().click();
        await page.waitForSelector('.config-custom-field', { timeout: 15_000 });

        const geometry = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.config-custom-field')];
            const boxes = (row) => [...row.children].map((cell) => {
                const rect = cell.getBoundingClientRect();
                return { left: Math.round(rect.x), right: Math.round(rect.right) };
            });
            return {
                rows: rows.length,
                // A row wider than its box scrolls inside itself, which is how
                // the controls ended up on top of each other.
                overflowing: rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length,
                overlapping: rows.filter((row) => {
                    const cells = boxes(row);
                    return cells.some((cell, i) => i > 0 && cell.left < cells[i - 1].right - 1);
                }).length,
                groups: [...document.querySelectorAll('.config-custom-group-title')]
                    .map((t) => t.textContent.trim()),
                hasHeader: !!document.querySelector('.config-custom-head'),
            };
        });

        expect(geometry.rows).toBe(2);
        expect(geometry.overflowing).toBe(0);
        expect(geometry.overlapping).toBe(0);
        // Three questions, said out loud rather than left as six adjacent boxes.
        expect(geometry.groups).toHaveLength(3);
        // Placeholders vanish once a row has a value; the header does not.
        expect(geometry.hasHeader).toBe(true);
    });
});
