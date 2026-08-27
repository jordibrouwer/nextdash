// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The four remaining ring 0 tiles.
 *
 * Uptime and Neglected are where "which bookmarks" belongs; Trend takes no
 * filter at all, because a filtered line answers a question nobody asked while
 * looking exactly like the one that answers the real one.
 */

const DAY = 24 * 60 * 60 * 1000;

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('uptime, trend, inbox and neglected', () => {
    test('all eight types have a renderer and settings', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.instance?.constructor;
            return {
                renderers: Object.keys(window.DashboardWidgets || {}).sort(),
                offered: [...(Config?.WIDGET_TYPES || [])].sort(),
                settings: Object.keys(Config?.WIDGET_SETTINGS || {}).sort(),
            };
        });
        /*
         * The ring 0 eight, checked as a floor rather than as the whole list.
         *
         * Spelled out, this failed the day the custom widget arrived — on the
         * count, not on anything being wrong. What it is really about is that
         * every offered type can be drawn and can be configured, which is a
         * property of the lists agreeing rather than of their length.
         */
        const ringZero = ['certs', 'feeds', 'health', 'inbox', 'neglected', 'sources', 'trend', 'uptime'];
        for (const type of ringZero) {
            expect(state.renderers, `${type} has a renderer`).toContain(type);
            expect(state.offered, `${type} is offered`).toContain(type);
        }
        // No type is offered without something to draw it or settings to give it.
        expect(state.offered.filter((t) => !state.renderers.includes(t))).toEqual([]);
        expect(state.offered.filter((t) => !state.settings.includes(t))).toEqual([]);
    });

    test('uptime puts what is down first and says when it has no samples', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.healthReport = { issues: [
                { url: 'https://fine.example/', monitor: true,
                  monitorStats: { uptime7d: { ratio: 0.999, samples: 400 } } },
                { url: 'https://broken.example/', monitor: true,
                  monitorStats: { downSince: Date.now() - 3600000, uptime7d: { ratio: 0.5, samples: 400 } } },
                { url: 'https://new.example/', monitor: true,
                  monitorStats: { uptime7d: { ratio: 0, samples: 0 } } },
                { url: 'https://unwatched.example/', monitor: false },
            ] };
            const body = document.createElement('div');
            window.DashboardWidgets.uptime(body, { type: 'uptime', config: { sparkline: false } }, d);
            const rows = [...body.querySelectorAll('.dashboard-widget-row')];
            return {
                names: rows.map((r) => r.querySelector('.dashboard-widget-row-name')?.textContent),
                details: rows.map((r) => r.querySelector('.dashboard-widget-row-detail')?.textContent),
            };
        });
        // Down first — a tile with five rows should spend them on what needs attention.
        expect(rendered.names[0]).toBe('broken.example');
        // A bookmark nobody asked to monitor has no samples and no place here.
        expect(rendered.names).not.toContain('unwatched.example');
        // "No data" and "0% up" are different answers.
        expect(rendered.details).toContain('—');
        expect(rendered.details.some((d) => d && d.includes('99.9'))).toBe(true);
    });

    test('uptime can be narrowed to what is down now', async ({ page }) => {
        await open(page);
        const names = await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.healthReport = { issues: [
                { url: 'https://fine.example/', monitor: true, monitorStats: { uptime7d: { ratio: 1, samples: 10 } } },
                { url: 'https://broken.example/', monitor: true, monitorStats: { downSince: Date.now() } },
            ] };
            const body = document.createElement('div');
            window.DashboardWidgets.uptime(body, { type: 'uptime', config: { downOnly: true } }, d);
            return [...body.querySelectorAll('.dashboard-widget-row-name')].map((n) => n.textContent);
        });
        expect(names).toEqual(['broken.example']);
    });

    test('the trend needs more than one day before it draws a line', async ({ page }) => {
        await open(page);
        const text = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d._widgetTrend = [{ t: Date.now(), b: 3 }];
            const body = document.createElement('div');
            await window.DashboardWidgets.trend(body, { type: 'trend', config: { days: 30 } }, d);
            return body.textContent || '';
        });
        // One point is not a trend, and saying so beats drawing a dot.
        expect(text.length).toBeGreaterThan(0);
        expect(await Promise.resolve(text)).not.toMatch(/^\s*3\s*$/);
    });

    test('the trend reads the direction, not just the latest number', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            // Twelve broken a month ago, four today: still high, clearly better.
            d._widgetTrend = [
                { t: Date.now() - 20 * day, b: 12 },
                { t: Date.now() - 10 * day, b: 8 },
                { t: Date.now(), b: 4 },
            ];
            const body = document.createElement('div');
            await window.DashboardWidgets.trend(body, { type: 'trend', config: { days: 30 } }, d);
            const change = body.querySelector('.dashboard-widget-trend-change');
            return {
                value: body.querySelector('.dashboard-widget-trend-value')?.textContent,
                change: change?.textContent,
                better: change?.classList.contains('is-better'),
                hasLine: !!body.querySelector('canvas'),
            };
        });
        expect(rendered.value).toBe('4');
        expect(rendered.change).toBe('-8');
        // Fewer broken links is good news even when the number is still high.
        expect(rendered.better).toBe(true);
        expect(rendered.hasLine).toBe(true);
    });

    test('the inbox tile leads with how long the oldest has waited', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            d._widgetInbox = [
                { id: '1', url: 'https://a.example/', title: 'Newer', addedAt: Date.now() - day },
                { id: '2', url: 'https://b.example/', title: 'Older', addedAt: Date.now() - 40 * day, source: 'extension' },
            ];
            const body = document.createElement('div');
            await window.DashboardWidgets.inbox(body, { type: 'inbox', config: {} }, d);
            return {
                count: body.querySelector('.dashboard-widget-headline-value')?.textContent,
                note: body.querySelector('.dashboard-widget-headline-note')?.textContent,
                first: body.querySelector('.dashboard-widget-row-name')?.textContent,
                sources: [...body.querySelectorAll('.dashboard-widget-row-detail')].map((s) => s.textContent),
            };
        });
        expect(rendered.count).toBe('2');
        expect(rendered.note).toContain('40');
        // Oldest first: a backlog clears from the bottom.
        expect(rendered.first).toBe('Older');
        expect(rendered.sources).toContain('extension');
    });

    /*
     * Never-opened is only neglect once there has been time to open it. A
     * bookmark saved this morning would otherwise head the list on day one.
     */
    test('a bookmark saved today is not neglected for having no opens', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            d.allBookmarks = [
                { url: 'https://fresh.example/', name: 'Saved today', createdAt: Date.now(), lastOpened: 0 },
                { url: 'https://old.example/', name: 'Never touched', createdAt: Date.now() - 400 * day, lastOpened: 0 },
                { url: 'https://stale.example/', name: 'Long ago', createdAt: Date.now() - 500 * day,
                  lastOpened: Date.now() - 300 * day },
                { url: 'https://recent.example/', name: 'Yesterday', createdAt: Date.now() - 400 * day,
                  lastOpened: Date.now() - day },
            ];
            const body = document.createElement('div');
            window.DashboardWidgets.neglected(body, { type: 'neglected', config: { sinceDays: 180 } }, d);
            return {
                names: [...body.querySelectorAll('.dashboard-widget-row-name')].map((n) => n.textContent),
                note: body.querySelector('.dashboard-widget-headline-note')?.textContent,
            };
        });
        expect(rendered.names).not.toContain('Saved today');
        expect(rendered.names).not.toContain('Yesterday');
        expect(rendered.names).toContain('Never touched');
        expect(rendered.names).toContain('Long ago');
        // The threshold is on screen: the count means nothing without it.
        expect(rendered.note).toContain('180');
    });

    test('never-opened can be left out entirely', async ({ page }) => {
        await open(page);
        const names = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            d.allBookmarks = [
                { url: 'https://never.example/', name: 'Never', createdAt: Date.now() - 400 * day, lastOpened: 0 },
                { url: 'https://stale.example/', name: 'Stale', createdAt: Date.now() - 400 * day,
                  lastOpened: Date.now() - 300 * day },
            ];
            const body = document.createElement('div');
            window.DashboardWidgets.neglected(body,
                { type: 'neglected', config: { sinceDays: 180, includeNeverOpened: false } }, d);
            return [...body.querySelectorAll('.dashboard-widget-row-name')].map((n) => n.textContent);
        });
        expect(names).toEqual(['Stale']);
    });
});

/*
 * A widget added or changed in config shows on the dashboard at once.
 *
 * The tiles that fetch keep their answer on the dashboard object — sources runs
 * hourly, the trend has a day's granularity — so a redraw alone would paint the
 * new settings over data fetched before they existed, and read as though the
 * change did nothing.
 */
test.describe('widgets update as they are configured', () => {
    test('adding a widget puts it on the grid without a reload', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const before = await page.locator('.dashboard-widget').count();

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForSelector('[data-widget-catalogue]', { timeout: 15_000 });
        // The kind is the button: choosing one is what adds it. The catalogue
        // is an overlay, so it is opened first.
        await page.click('[data-widget-catalogue]');
        await page.click('.modal--widget-catalogue [data-widget-add="inbox"]');

        // No reload anywhere: the grid is redrawn in place.
        await expect.poll(async () => page.evaluate(() =>
            (window.dashboardInstance.widgets || []).some((w) => w.type === 'inbox')),
        { timeout: 15_000 }).toBe(true);

        // closeConfigView is how the app itself leaves config; showView does
        // not move away from it.
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            cfg.closeConfigView();
        });
        await expect.poll(async () => page.locator('.dashboard-widget').count(),
            { timeout: 15_000 }).toBeGreaterThan(before);
    });

    test('a changed setting clears what the tile had cached', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const cleared = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config?.load?.();
            const cfg = d.config?.instance || d.config;
            // Every store a fetching tile keeps, seeded as a first render would.
            d._widgetSources = [{ id: 'stale' }];
            d._widgetFeeds = { stale: {} };
            d._widgetTrend = [{ t: 1, b: 9 }];
            d._widgetInbox = [{ id: 'stale' }];
            await cfg.refreshDashboardBlocks();
            return {
                sources: d._widgetSources === undefined,
                feeds: d._widgetFeeds === undefined,
                trend: d._widgetTrend === undefined,
                inbox: d._widgetInbox === undefined,
            };
        });
        expect(cleared).toEqual({ sources: true, feeds: true, trend: true, inbox: true });
    });
});

/*
 * A tile that shows five of twelve says so.
 *
 * The row count is a setting about what you want to see, so what falls outside
 * it has to be visible too: five rows out of twelve looked exactly like five
 * out of five, and the tile then quietly answers a different question than the
 * one it appears to answer.
 */
test.describe('what does not fit is stated', () => {
    test('the neglected tile counts the rows it left out', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const rendered = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            d.allBookmarks = Array.from({ length: 12 }, (_, i) => ({
                url: `https://n${i}.example/`,
                name: `Neglected ${i}`,
                createdAt: Date.now() - 400 * day,
                lastOpened: Date.now() - (300 + i) * day,
            }));
            const body = document.createElement('div');
            window.DashboardWidgets.neglected(body,
                { type: 'neglected', config: { sinceDays: 180, rows: 5 } }, d);
            const rows = [...body.querySelectorAll('.dashboard-widget-row')];
            const more = body.querySelector('.dashboard-widget-row--more');
            return {
                rowCount: rows.length,
                moreText: more?.querySelector('.dashboard-widget-row-name')?.textContent || '',
                headline: body.querySelector('.dashboard-widget-headline-value')?.textContent,
            };
        });

        // Five bookmarks plus the row that accounts for the other seven.
        expect(rendered.rowCount).toBe(6);
        expect(rendered.moreText).toContain('7');
        // The headline still reports the whole finding, not the visible part.
        expect(rendered.headline).toBe('12');
    });

    test('a list that fits gets no extra row', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const rows = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const day = 24 * 60 * 60 * 1000;
            d.allBookmarks = [
                { url: 'https://a.example/', name: 'One', createdAt: Date.now() - 400 * day,
                  lastOpened: Date.now() - 300 * day },
            ];
            const body = document.createElement('div');
            window.DashboardWidgets.neglected(body,
                { type: 'neglected', config: { sinceDays: 180, rows: 5 } }, d);
            return {
                total: body.querySelectorAll('.dashboard-widget-row').length,
                more: body.querySelectorAll('.dashboard-widget-row--more').length,
            };
        });
        expect(rows).toEqual({ total: 1, more: 0 });
    });

    // The sources tile had no row limit at all, so a dozen import sources filled
    // the block however long it happened to be.
    test('the sources tile honours a row count', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d._widgetSources = Array.from({ length: 9 }, (_, i) => ({
                id: `s${i}`, label: `Source ${i}`, lastResult: 'ok',
            }));
            const body = document.createElement('div');
            await window.DashboardWidgets.sources(body, { type: 'sources', config: { rows: 3 } }, d);
            return {
                total: body.querySelectorAll('.dashboard-widget-row').length,
                more: body.querySelector('.dashboard-widget-row--more .dashboard-widget-row-name')?.textContent || '',
            };
        });
        expect(rendered.total).toBe(4);
        expect(rendered.more).toContain('6');
    });

    // A retired feed pushed off the tile is exactly the one worth knowing about.
    test('the feeds tile counts both halves toward what did not fit', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        const more = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const feeds = {};
            for (let i = 0; i < 4; i++) feeds[`r${i}`] = { feedUrl: `https://r${i}.example/rss`, retired: true };
            for (let i = 0; i < 5; i++) feeds[`f${i}`] = { feedUrl: `https://f${i}.example/rss`, newCount: i + 1 };
            d.feedFreshness = feeds;
            const body = document.createElement('div');
            await window.DashboardWidgets.feeds(body, { type: 'feeds', config: { rows: 3 } }, d);
            return body.querySelector('.dashboard-widget-row--more .dashboard-widget-row-name')?.textContent || '';
        });
        // Three rows shown, all retired; one retired plus five fresh left over.
        expect(more).toContain('6');
    });
});

/*
 * Delete had never worked.
 *
 * The button carries its index on data-widget-delete and the handler read
 * data-index, which it does not have: Number(null) is 0, so every Delete asked
 * to remove block 0 — normally a category, where the isWidget check refuses and
 * returns without a word. Present since the tab shipped, and invisible because
 * failing silently is what it did.
 */
test('deleting a widget removes that widget', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async () => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await send('/api/pages/1/blocks', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: [
                { type: 'health', title: 'Keep me' },
                { type: 'inbox', title: 'Remove me' },
            ] }),
        });
    });

    await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
    await page.waitForSelector('[data-widget-delete]', { timeout: 15_000 });
    await expect(page.locator('.config-widget-row')).toHaveCount(2);

    // Confirmed through the app's own dialog, so the click is the real path.
    await page.evaluate(() => {
        const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
        cfg.confirmAction = async () => true;
    });
    await page.locator('[data-widget-delete]').nth(1).click();

    await expect.poll(async () => page.evaluate(async () => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const blocks = await (await send('/api/pages/1/blocks')).json();
        return (blocks.widgets || []).map((w) => w.title);
    }), { timeout: 15_000 }).toEqual(['Keep me']);

    // And the categories beside it are untouched — block 0 was what the broken
    // handler aimed at.
    const categories = await page.evaluate(async () => {
        const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const blocks = await (await send('/api/pages/1/blocks')).json();
        return (blocks.order || []).filter((id) => !String(id).startsWith('w_')).length;
    });
    expect(categories).toBeGreaterThan(0);
});

/*
 * Every figure on a tile is a button, and a button has to arrive somewhere.
 *
 * The tiles called dash.health.openWithFilter(), which does not exist. The ?.()
 * swallowed it, so clicking a figure on the health widget did nothing at all —
 * no view, no error, no sign that a click had registered.
 */
test.describe('a figure on a tile opens the rows behind it', () => {
    async function withHealthWidget(page) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: [{ type: 'health', title: 'Health' }] }),
            });
            const d = window.dashboardInstance;
            d.healthSummary = { brokenCount: 3, monitorDownCount: 1, contentCount: 2, healthyCount: 40 };
            d.renderDashboard?.({ animate: false, forceFull: true });
        });
        await page.waitForSelector('.dashboard-widget-health-row', { timeout: 15_000 });
    }

    test('clicking a figure opens health on that filter', async ({ page }) => {
        await withHealthWidget(page);

        // "Down now" — not the view's default, so arriving on it proves the
        // filter travelled rather than the view simply opening.
        await page.locator('[data-health-filter="monitored"]').first().click();

        await expect.poll(async () => page.evaluate(() => ({
            view: window.dashboardInstance.activeView,
            filter: (window.dashboardInstance.health?.instance || window.dashboardInstance.health)?.filter,
        })), { timeout: 15_000 }).toEqual({ view: 'health', filter: 'monitored' });
    });

    test('the filter is in the address, so the view can be returned to', async ({ page }) => {
        await withHealthWidget(page);
        await page.locator('[data-health-filter="content"]').first().click();
        await expect.poll(async () => page.url(), { timeout: 15_000 }).toContain('hv_filter=content');
    });

    test('every figure carries a filter the view accepts', async ({ page }) => {
        await withHealthWidget(page);
        const filters = await page.evaluate(() =>
            [...document.querySelectorAll('.dashboard-widget-health-row')].map((r) => r.dataset.healthFilter));
        expect(filters.length).toBeGreaterThan(0);

        const accepted = await page.evaluate(async (keys) => {
            await window.dashboardInstance.health?.load?.();
            const cls = (window.dashboardInstance.health?.instance || window.dashboardInstance.health)?.constructor;
            const valid = cls?.PERSISTED_FILTERS;
            return keys.map((key) => !!valid?.has(key));
        }, filters);
        // A key the view does not accept lands on the default, and the click
        // then reads as having gone to the wrong place.
        expect(accepted).not.toContain(false);
    });
});

/*
 * How wide a widget is drawn.
 *
 * Two at most: a widget is a summary, and one needing three columns is a view
 * that has not admitted it yet. A dashboard showing one column has nothing to
 * spread into, so the widget narrows rather than disappearing — the same thing
 * a category does, and the setting lives on a screen nobody opens on the phone
 * where a vanishing tile would bite.
 */
test.describe('widget width', () => {
    async function withWidget(page, config) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        return page.evaluate(async (config) => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: [{ type: 'inbox', title: 'Wide', config }] }),
            });
            const blocks = await (await send('/api/pages/1/blocks')).json();
            const d = window.dashboardInstance;
            d.widgets = blocks.widgets;
            d.blockOrder = blocks.order;
            d.renderDashboard?.({ animate: false, forceFull: true });
            return blocks.widgets?.[0]?.config || {};
        }, config);
    }

    test('two columns is drawn across two columns', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        const stored = await withWidget(page, { columns: 2 });
        expect(stored.columns).toBe(2);

        await expect.poll(async () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-widget');
            return el ? getComputedStyle(el).gridColumn : null;
        }), { timeout: 15_000 }).toContain('span 2');
    });

    test('a one-column dashboard narrows the widget instead of dropping it', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await withWidget(page, { columns: 2 });

        await page.setViewportSize({ width: 420, height: 900 });
        await page.evaluate(() => window.dashboardInstance.renderDashboard?.({ animate: false, forceFull: true }));

        await expect.poll(async () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-widget');
            return {
                columns: window.dashboardInstance.renderCore?.getEffectiveColumnsPerRow?.(),
                present: !!el,
                wide: !!el?.classList.contains('category--wide'),
            };
        }), { timeout: 15_000 }).toEqual({ columns: 1, present: true, wide: false });
    });

    // Two is the ceiling wherever it is asked for: in storage, and again when
    // the block is drawn.
    test('more than two columns is refused', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        const stored = await withWidget(page, { columns: 5 });
        expect(stored).not.toHaveProperty('columns');

        const span = await page.evaluate(() => window.dashboardInstance.renderCore
            .widgetColumnSpan({ config: { columns: 5 } }));
        expect(span).toBeLessThanOrEqual(2);
    });

    /*
     * A widget keeps its width when the category sweep runs.
     *
     * refreshAllCategorySpans walks '.category[data-category-id]', and a widget
     * block carries both — it is a block in the same grid. So every pass reset
     * a two-column widget to one column, whatever its setting said, and the
     * fallback at one column appeared to work for entirely the wrong reason.
     */
    test('the category sweep leaves widget widths alone', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await withWidget(page, { columns: 2 });

        const after = await page.evaluate(() => {
            window.DashboardCategorySpan?.refreshAllCategorySpans?.(window.dashboardInstance, document);
            const el = document.querySelector('.dashboard-widget');
            return {
                wide: !!el?.classList.contains('category--wide'),
                span: el?.style.getPropertyValue('--category-span') || '',
            };
        });
        expect(after).toEqual({ wide: true, span: '2' });
    });

    test('the width can be set from the widgets tab', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await withWidget(page, {});

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
        await page.waitForSelector('[data-widget-settings]', { timeout: 15_000 });
        await page.locator('[data-widget-settings]').first().click();
        await page.waitForSelector('[data-widget-setting="columns"]', { timeout: 15_000 });

        await page.selectOption('[data-widget-setting="columns"]', '2');
        /*
         * And Save, which is the part that writes. The panel holds a draft:
         * it used to write every control as it changed, so a half-made choice
         * was stored and walking away from the screen left it there.
         */
        await page.locator('[data-widget-save]').first().click();

        await expect.poll(async () => page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const blocks = await (await send('/api/pages/1/blocks')).json();
            return blocks.widgets?.[0]?.config?.columns;
        }), { timeout: 15_000 }).toBe(2);
    });
});

/*
 * Widgets has a place in the rail rather than a tab under Pages & tags.
 *
 * It sat there because a widget is a block beside the categories, but the tab
 * had grown a settings panel per type and stopped being a list of names — and
 * the thing it is genuinely arranged with, the block order, lives on the
 * categories tab either way.
 */
test.describe('widgets as a section', () => {
    test('it sits in the rail under Data & backups', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));

        const rail = await page.evaluate(() =>
            [...document.querySelectorAll('[data-config-section]')].map((b) => b.textContent.trim()));
        const backups = rail.indexOf('Data & backups');
        const widgets = rail.indexOf('Widgets');
        expect(backups).toBeGreaterThan(-1);
        // Capitalised like every other section, and directly below backups.
        expect(widgets).toBe(backups + 1);

        // The editor is here, and it is the same one.
        await expect(page.locator('[data-widget-catalogue]')).toBeVisible({ timeout: 15_000 });
    });

    test('it is no longer a tab under Pages & tags', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));

        await expect(page.locator('[data-pt-tab="categories"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-pt-tab="widgets"]')).toHaveCount(0);
    });

    // The categories list offers a way to a widget's settings; that moved too.
    test('configuring a widget from the categories list lands in the section', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            const send = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await send('/api/pages/1/blocks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ widgets: [{ type: 'health', title: 'Health' }] }),
            });
        });

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
        await page.click('[data-pt-tab="categories"]');
        const configure = page.locator('[data-block-configure]').first();
        await expect(configure).toBeVisible({ timeout: 15_000 });
        await configure.click();

        await expect.poll(async () => page.evaluate(() =>
            (window.dashboardInstance.config?.instance || window.dashboardInstance.config)?.section),
        { timeout: 15_000 }).toBe('widgets');
    });
});
