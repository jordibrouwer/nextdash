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
        /*
         * The address, how to ask for it, how long an answer keeps, and the
         * list path. The fields[] editor is drawn separately, because a list of
         * objects is not a row in that table -- and so is the credential, which
         * used to be `credentialId` here: a text box asking for the name of an
         * entry made on another screen. It is a sign-in block of its own now,
         * so the key is typed where the widget is, and this table never sees it.
         */
        expect(state.settings).toEqual(['url', 'method', 'ttl', 'itemsPath']);
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

        /*
         * And then Save, which is the part that writes.
         *
         * The panel holds a draft: it used to write every field as it changed,
         * which meant a half-typed path was stored and a widget could be left
         * pointing at nonsense by walking away from the screen. Nothing leaves
         * the panel now until this is pressed.
         */
        await page.locator('[data-widget-save]').first().click();

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
            /*
             * Hidden cells are skipped rather than measured. Decimals and the
             * Data unit share a column and one of the two is always hidden, and
             * a hidden select reports a zero-width box at x=0 -- which reads as
             * overlapping everything on a row that is drawn correctly.
             */
            const boxes = (row) => [...row.children].filter((cell) => !cell.hidden).map((cell) => {
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
        /*
         * Five questions, said out loud rather than left as a wall of adjacent
         * boxes. "Start from a service" is first: it is the one that fills the
         * others in, so it comes before them. "Try it" sits between the figures
         * and the grid, where it is read -- after the paths it checks, before
         * the tile they end up on.
         */
        expect(geometry.groups).toHaveLength(5);
        expect(geometry.groups[0]).toBe('Start from a service');
        // Placeholders vanish once a row has a value; the header does not.
        expect(geometry.hasHeader).toBe(true);
    });
});

/*
 * A custom tile refreshes itself, on its own clock.
 *
 * Every other tile reads something nextDash already keeps, so a repaint is
 * enough to bring it up to date. This one is the only tile that asks the
 * outside world, and there is nothing on a dashboard left open that would ever
 * ask again — the TTL it carries is a cache expiry, not a schedule, so the
 * figures sat at whatever they were when the page loaded.
 *
 * The presets set that TTL per service with a reason: 60s for a download speed,
 * 300s for a queue, 3600s for a speed test that runs hourly. So the clock is
 * per widget rather than one shared tick — a 60x spread cannot be one number.
 */
test.describe('a custom widget refreshes itself', () => {
    test('on its own TTL, and only while the tab is watched', async ({ page }) => {
        await open(page);
        const outcome = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            let calls = 0;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/custom')) {
                    calls += 1;
                    return new Response(JSON.stringify({
                        fetchedAt: Date.now(),
                        values: [{ label: 'down/s', value: String(calls) }],
                    }), { headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };

            const widget = { id: 'w_speed', type: 'custom', title: 'Speed', config: { ttl: 30 } };
            // Shaped like a real tile on the grid: the clock finds the body by
            // the widget's own id, the way it does after any repaint.
            const block = document.createElement('div');
            block.className = 'dashboard-widget';
            block.dataset.widgetId = widget.id;
            const body = document.createElement('div');
            body.className = 'dashboard-widget-body';
            block.appendChild(body);
            document.body.appendChild(block);

            const timers = () => d.renderCore?.customWidgetTimerCount?.() ?? -1;
            // Earlier tests in this file draw custom tiles too, and drawing one
            // starts its clock. Counting from whatever they left running would
            // make this test's numbers depend on the order it happens to run in.
            d.renderCore?.stopCustomWidgetTimers?.();

            /*
             * The clocks themselves are counted, not the map that tracks them.
             *
             * The map is keyed by widget id, so starting a second interval for
             * the same tile silently replaces the entry: the count still reads
             * 1 while the first interval keeps firing forever. Watching
             * setInterval/clearInterval is what sees that leak — and it has to
             * be installed before the first clock starts, or the one that leaks
             * is the one it never saw.
             */
            const liveIntervals = new Set();
            const realSet = window.setInterval;
            const realClear = window.clearInterval;
            const trackedSet = (...args) => {
                const id = realSet(...args);
                liveIntervals.add(id);
                return id;
            };
            const trackedClear = (id) => { liveIntervals.delete(id); return realClear(id); };
            window.setInterval = trackedSet;
            window.clearInterval = trackedClear;

            await window.DashboardWidgets.custom(body, widget, d);
            d.renderCore?.startCustomWidgetTimer?.(widget);
            const afterFirst = { calls, timers: timers(), intervals: liveIntervals.size };

            // Drawn again, as a repaint does.

            await window.DashboardWidgets.custom(body, widget, d);
            d.renderCore?.startCustomWidgetTimer?.(widget);
            const afterRepaint = { timers: timers(), intervals: liveIntervals.size };

            window.setInterval = realSet;
            window.clearInterval = realClear;

            /*
             * A beat, with the cache left exactly as the tile left it.
             *
             * Emptying it here first would test nothing: dropping this tile's
             * entry is the beat's own job, and a tick that forgot to would
             * quietly redraw the same figures forever.
             */
            await d.renderCore?.tickCustomWidget?.(widget);
            const afterExpiry = { calls };

            // Hidden tab: a dashboard on a second monitor must not keep asking
            // a service of the reader's own.
            Object.defineProperty(document, 'visibilityState',
                { value: 'hidden', configurable: true });
            await d.renderCore?.tickCustomWidget?.(widget);
            const afterHidden = { calls };

            Object.defineProperty(document, 'visibilityState',
                { value: 'visible', configurable: true });
            // Counted as intervals again: the map is emptied by .clear() either
            // way, so only the clocks themselves show whether they were stopped.
            const beforeStop = liveIntervals.size;
            window.setInterval = trackedSet;
            window.clearInterval = trackedClear;
            d.renderCore?.stopCustomWidgetTimers?.();
            window.setInterval = realSet;
            window.clearInterval = realClear;
            const afterStop = { timers: timers(), intervals: liveIntervals.size, beforeStop };

            window.fetch = realFetch;
            block.remove();
            return { afterFirst, afterRepaint, afterExpiry, afterHidden, afterStop };
        });

        expect(outcome.afterFirst.calls).toBe(1);
        expect(outcome.afterFirst.timers).toBe(1);
        expect(outcome.afterFirst.intervals).toBe(1);
        // One tile, one timer — however often it is drawn. The interval count
        // is the assertion that bites: the map alone cannot see a leak.
        expect(outcome.afterRepaint.timers).toBe(1);
        expect(outcome.afterRepaint.intervals).toBe(1);
        // Past its TTL it asks again.
        expect(outcome.afterExpiry.calls).toBe(2);
        // Hidden, it does not.
        expect(outcome.afterHidden.calls).toBe(2);
        // And leaving the page takes the clocks with it — the map is emptied
        // either way, so the intervals are what prove they stopped.
        expect(outcome.afterStop.beforeStop).toBe(1);
        expect(outcome.afterStop.timers).toBe(0);
        expect(outcome.afterStop.intervals).toBe(0);
    });
});

/*
 * The size a preset would give a figure, on a widget that never stored one.
 *
 * Widgets saved before figures had sizes hold fields with no shape of their
 * own. Rewriting them on load would change stored data nobody asked to have
 * changed, so the shape is worked out when the tile is drawn: the widget still
 * records which preset it came from, and the preset still knows what its own
 * figures are for.
 *
 * Driven through the two functions the renderer actually calls rather than
 * through a live tile, because a tile only draws figures once the service
 * answers -- and a service that is not there produces no figures, no meters,
 * and a result that looks exactly like the fallback having failed.
 */
test.describe('a figure takes its size from the preset it came from', () => {
    test('a widget with a presetId and no shapes still draws meters', async ({ page }) => {
        await open(page);
        const shapes = await page.evaluate(() => {
            const presets = window.DashboardWidgetPresets;
            // Glances: three percentages, which is what a meter is for.
            const widget = { config: { presetId: 'glances', fields: [
                { path: 'cpu' }, { path: 'mem' }, { path: 'swap' },
            ] } };
            return widget.config.fields.map((field) => presets.shapeFor('glances', field.path));
        });
        expect(shapes).toHaveLength(3);
        for (const shape of shapes) {
            expect(shape).toEqual({ shape: 'meter', tone: 'bad' });
        }
    });

    test('a path the preset does not know keeps the plain figure', async ({ page }) => {
        await open(page);
        const answers = await page.evaluate(() => ({
            unknownPath: window.DashboardWidgetPresets.shapeFor('glances', 'something_else'),
            unknownPreset: window.DashboardWidgetPresets.shapeFor('not_a_preset', 'cpu'),
            noPreset: window.DashboardWidgetPresets.shapeFor('', 'cpu'),
        }));
        // null rather than a guess: a figure nobody described is drawn the way
        // every figure was drawn before sizes existed.
        expect(answers.unknownPath).toBeNull();
        expect(answers.unknownPreset).toBeNull();
        expect(answers.noPreset).toBeNull();
    });
});

