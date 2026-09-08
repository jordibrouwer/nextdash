// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The calendar widget: what is coming up, from the ICS feed the server
 * fetches and parses -- the tile itself only asks its own /api/widgets/calendar
 * endpoint, the same shape the custom widget already uses for its own fetch.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('the calendar widget', () => {
    test('it is offered and has a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderer: typeof window.DashboardWidgets?.calendar,
                settings: (Config?.WIDGET_SETTINGS?.calendar || []).map((f) => f.key),
            };
        });
        expect(state.offered).toContain('calendar');
        expect(state.renderer).toBe('function');
        // No feed field: that lives in Behavior -> Date & weather, once for
        // the whole install.
        expect(state.settings).toEqual(['daysAhead', 'rows']);
    });

    test('with no feed configured, it says so', async ({ page }) => {
        await open(page);
        const text = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/calendar')) {
                    return new Response(JSON.stringify({ fetchedAt: Date.now(), error: 'no calendar feed set' }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.calendar(body, { id: 'w_cal_1', type: 'calendar', config: {} }, d);
            } finally {
                window.fetch = realFetch;
                delete d._widgetCalendar;
            }
            return body.textContent;
        });
        expect(text).toContain('Config');
    });

    test('with no events ahead, it names the window it checked', async ({ page }) => {
        await open(page);
        const text = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/calendar')) {
                    return new Response(JSON.stringify({ fetchedAt: Date.now(), events: [] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.calendar(
                    body, { id: 'w_cal_2', type: 'calendar', config: { daysAhead: 7 } }, d);
            } finally {
                window.fetch = realFetch;
                delete d._widgetCalendar;
            }
            return body.textContent;
        });
        expect(text).toContain('7');
    });

    test('draws the events the server sent, in order', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const now = Date.now();
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                if (String(url).includes('/api/widgets/calendar')) {
                    return new Response(JSON.stringify({
                        fetchedAt: now,
                        events: [
                            { title: 'Team standup', start: now + 60 * 60 * 1000 },
                            { title: 'Dentist', start: now + 26 * 60 * 60 * 1000, allDay: true },
                        ],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.calendar(body, { id: 'w_cal_3', type: 'calendar', config: {} }, d);
            } finally {
                window.fetch = realFetch;
                delete d._widgetCalendar;
            }
            return [...body.querySelectorAll('.dashboard-widget-row')].map((row) => ({
                name: row.querySelector('.dashboard-widget-row-name')?.textContent,
                detail: row.querySelector('.dashboard-widget-row-detail')?.textContent,
            }));
        });
        expect(rendered).toHaveLength(2);
        expect(rendered[0].name).toBe('Team standup');
        expect(rendered[1].name).toBe('Dentist');
    });

    // Mirrors ring0b's "a changed setting clears what the tile had cached":
    // forgetWidgetCaches is the one place every fetching tile's client cache
    // is dropped after a save, and a tile that starts caching something has
    // to say so there or it keeps showing what it fetched under the old
    // settings until its own TTL runs out.
    test('saving any widget setting drops the calendar tile\'s own cache', async ({ page }) => {
        await open(page);
        const cleared = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config?.load?.();
            const cfg = d.config?.instance || d.config;
            d._widgetCalendar = { '1:w_stale': { result: { events: [] }, until: Date.now() + 999_999 } };
            await cfg.refreshDashboardBlocks();
            return d._widgetCalendar === undefined;
        });
        expect(cleared).toBe(true);
    });

    // The feed address is a global setting, not a per-widget one, so it does
    // not go through forgetWidgetCaches at all -- it has its own branch in
    // setBehavior's special:'datetime' handling, the same way the weather
    // fields do.
    test('changing the feed URL drops the calendar tile\'s cache and redraws it', async ({ page }) => {
        await open(page);
        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config?.load?.();
            const cfg = d.config?.instance || d.config;
            d._widgetCalendar = { '1:w_stale': { result: { events: [] }, until: Date.now() + 999_999 } };
            let redrawnType = null;
            const original = d.renderCore?.refreshWidgets?.bind(d.renderCore);
            if (d.renderCore) {
                d.renderCore.refreshWidgets = (type) => { redrawnType = type; return original?.(type); };
            }
            await cfg.setBehavior('calendarIcsUrl', 'https://example.invalid/second.ics', 'datetime');
            if (d.renderCore && original) d.renderCore.refreshWidgets = original;
            return { cleared: d._widgetCalendar === undefined, redrawnType, url: d.settings.calendarIcsUrl };
        });
        expect(result.cleared).toBe(true);
        expect(result.redrawnType).toBe('calendar');
        expect(result.url).toBe('https://example.invalid/second.ics');
    });
});
