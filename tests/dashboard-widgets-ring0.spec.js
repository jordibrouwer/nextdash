// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The second, third and fourth widget types — and the settings that make them
 * worth having.
 *
 * Until now the register held one type, and the Widgets tab offered a title, a
 * shown toggle and delete. The health widget read a `show` setting nothing in
 * the UI could write: a control that existed only in the renderer.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('ring 0 widgets', () => {
    test('every registered type is offered and can be drawn', async ({ page }) => {
        await open(page);
        // dashboard-config.js is lazy-loaded — the largest script the dashboard
        // ships — so the class does not exist until config is opened.
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.instance?.constructor
                || window.dashboardInstance.config?.constructor;
            return {
                offered: Config?.WIDGET_TYPES || [],
                renderers: Object.keys(window.DashboardWidgets || {}),
                settings: Object.keys(Config?.WIDGET_SETTINGS || {}),
            };
        });

        // The three built in this phase, beside the one that already existed.
        for (const type of ['health', 'sources', 'feeds', 'certs']) {
            expect(state.offered, `${type} offered`).toContain(type);
            expect(state.renderers, `${type} has a renderer`).toContain(type);
        }
        // A type offered without settings would be a row whose Settings button
        // opens nothing.
        for (const type of state.offered) {
            expect(state.settings, `${type} declares settings`).toContain(type);
        }
    });

    test('the sources tile says what each import last did', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d._widgetSources = [
                { id: 'github:stars', label: 'GitHub stars', lastRun: Date.now(), lastResult: '12 new, 0 changed' },
                { id: 'raindrop', label: 'Raindrop', lastRun: Date.now(), lastError: 'token rejected' },
            ];
            const body = document.createElement('div');
            await window.DashboardWidgets.sources(body, { type: 'sources', config: {} }, d);
            const rows = [...body.querySelectorAll('.dashboard-widget-row')];
            return {
                names: rows.map((r) => r.querySelector('.dashboard-widget-row-name')?.textContent),
                details: rows.map((r) => r.querySelector('.dashboard-widget-row-detail')?.textContent),
                bad: rows.map((r) => r.classList.contains('dashboard-widget-row--bad')),
            };
        });
        expect(rendered.names).toEqual(['GitHub stars', 'Raindrop']);
        expect(rendered.details[0]).toContain('12 new');
        // A failed import is the thing worth seeing, and it says why.
        expect(rendered.details[1]).toContain('token rejected');
        expect(rendered.bad).toEqual([false, true]);
    });

    test('the sources tile can be narrowed to what failed', async ({ page }) => {
        await open(page);
        const rows = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d._widgetSources = [
                { id: 'a', label: 'Fine', lastResult: 'ok' },
                { id: 'b', label: 'Broken', lastError: 'no' },
            ];
            const body = document.createElement('div');
            await window.DashboardWidgets.sources(body, { type: 'sources', config: { errorsOnly: true } }, d);
            return [...body.querySelectorAll('.dashboard-widget-row-name')].map((n) => n.textContent);
        });
        expect(rows).toEqual(['Broken']);
    });

    /*
     * A retired feed is the half nobody can see anywhere else: it is skipped on
     * every poll, so it produces no items and no error.
     */
    test('the feeds tile shows the feeds that stopped, first', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.feedFreshness = {
                a: { feedUrl: 'https://busy.example/rss', newCount: 7 },
                b: { feedUrl: 'https://dead.example/rss', newCount: 0, retired: true, failures: 5 },
            };
            const body = document.createElement('div');
            await window.DashboardWidgets.feeds(body, { type: 'feeds', config: {} }, d);
            const rows = [...body.querySelectorAll('.dashboard-widget-row')];
            return {
                names: rows.map((r) => r.querySelector('.dashboard-widget-row-name')?.textContent),
                first: rows[0]?.classList.contains('dashboard-widget-row--bad'),
            };
        });
        // "This stopped working" outranks "this has seven new items".
        expect(rendered.names[0]).toBe('dead.example');
        expect(rendered.first).toBe(true);
        expect(rendered.names).toContain('busy.example');
    });

    test('the certificates tile groups by host and honours its window', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            window.HealthFacts.remember({
                rows: [],
                certificates: {
                    'soon.example': { host: 'soon.example', expiresAt: Date.now() + 5 * day },
                    'later.example': { host: 'later.example', expiresAt: Date.now() + 200 * day },
                },
            });
            const body = document.createElement('div');
            window.DashboardWidgets.certs(body, { type: 'certs', config: { withinDays: 30 } }, d);
            return [...body.querySelectorAll('.dashboard-widget-row-name')].map((n) => n.textContent);
        });
        // 200 days away is not "expiring within 30".
        expect(rendered).toEqual(['soon.example']);
    });

    test('a widget with no certificates says so rather than waiting forever', async ({ page }) => {
        await open(page);
        const text = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            window.HealthFacts.remember({ rows: [], certificates: {} });
            d.healthSummary = d.healthSummary || {};
            const body = document.createElement('div');
            window.DashboardWidgets.certs(body, { type: 'certs', config: { withinDays: 14 } }, d);
            return body.textContent || '';
        });
        // Naming the window matters: nothing within 14 days, not nothing ever.
        expect(text).toContain('14');
    });

    /*
     * The point of the whole phase: a setting typed here survives.
     *
     * The health widget read `config.show` from the day it shipped and nothing
     * in the UI could write it — a control that existed only in the renderer.
     */
    test('a setting is stored, and the server keeps only what the type declares', async ({ page }) => {
        await open(page);
        const result = await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    widgets: [{
                        type: 'certs',
                        title: 'Certificates',
                        config: {
                            withinDays: 14,
                            rows: 5,
                            // None of these belong to this type, and none of
                            // them may reach bookmarks-N.json.
                            pageId: 3,
                            smuggled: 'value',
                            huge: 'x'.repeat(50000),
                        },
                    }],
                }),
            });
            const blocks = await (await send('/api/pages/1/blocks')).json();
            return blocks.widgets?.[0]?.config || {};
        });

        expect(result.withinDays).toBe(14);
        expect(result.rows).toBe(5);
        for (const key of ['pageId', 'smuggled', 'huge']) {
            expect(result, `${key} was stored`).not.toHaveProperty(key);
        }
    });

    // A value outside its range becomes absent, which every renderer already
    // reads as "use the default" — so a widget from a newer version still loads.
    test('an impossible value falls back to the default rather than failing', async ({ page }) => {
        await open(page);
        const stored = await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    widgets: [{ type: 'inbox', title: 'Inbox', config: { rows: 9999, columns: 'lots', showSource: true } }],
                }),
            });
            const blocks = await (await send('/api/pages/1/blocks')).json();
            return blocks.widgets?.[0]?.config || {};
        });
        // Out of range and nonsense are not the same mistake, and the server
        // stopped treating them alike (see TestOutOfRangeNumbersAreClamped-
        // AndNonsenseIsDropped). 9999 rows is a reader who did not know the
        // ceiling, so it is clamped to it — dropping the key would send them
        // back to the default with nothing on screen to say why.
        expect(stored.rows).toBe(20);
        // A string where a number belongs is the wrong shape, not a bad choice.
        // That becomes absent, which the renderer reads as "use the default".
        expect(stored).not.toHaveProperty('columns');
        // The rest of the config is untouched: one bad value is not a bad save.
        expect(stored.showSource).toBe(true);
    });
});
