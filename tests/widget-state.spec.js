// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Widgets that fetch from a service report how they are doing
 * (static/js/dashboard/dashboard-widget-state.js), for the checkup to read.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.WidgetState, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/**
 * Draw a widget with a stubbed server answer and report what the registry
 * knows about it afterwards. `answer` is the JSON, or null for a failing request.
 */
async function drawAndRead(page, { kind, route, id, answer, config = {} }) {
    return page.evaluate(async ({ kind, route, id, answer, config }) => {
        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        const realSend = window.nextDashFetch;
        const stub = async (url, ...rest) => {
            if (String(url).includes(route)) {
                if (answer === null) return new Response('nope', { status: 500 });
                return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return (realSend || realFetch)(url, ...rest);
        };
        window.fetch = stub;
        if (realSend) window.nextDashFetch = stub;
        const body = document.createElement('div');
        document.body.appendChild(body);
        window.WidgetState.clear(id);
        try {
            await window.DashboardWidgets[kind](body, { id, type: kind, config }, d);
        } finally {
            window.fetch = realFetch;
            if (realSend) window.nextDashFetch = realSend;
            for (const key of Object.keys(d)) if (key.startsWith('_widget')) delete d[key];
            body.remove();
        }
        return window.WidgetState.snapshot().find((e) => e.widgetId === id) || null;
    }, { kind, route, id, answer, config });
}

const CASES = [
    // emptyIsFine: nothing in the answer is a normal state (an empty calendar, nothing playing), not a fault.
    { kind: 'rss', route: '/api/widgets/rss', list: 'items', item: { title: 'Headline', link: 'https://example.com/1', publishedAt: Date.now() }, emptyIsFine: false },
    { kind: 'calendar', route: '/api/widgets/calendar', list: 'events', item: { title: 'Event', start: Date.now() + 3600000, end: Date.now() + 7200000 }, emptyIsFine: true },
    { kind: 'custom', route: '/api/widgets/custom', list: 'items', item: { label: 'Row', value: '1' }, emptyIsFine: false },
    { kind: 'jellyfin', route: '/api/widgets/jellyfin', list: 'items', item: { title: 'Film', library: 'Movies', addedAt: Date.now() }, emptyIsFine: true },
];

test.describe('widgets report how they are doing', () => {
    for (const c of CASES) {
        test(`${c.kind}: a failing request is an error`, async ({ page }) => {
            await open(page);
            const entry = await drawAndRead(page, { kind: c.kind, route: c.route, id: `w_state_${c.kind}`, answer: null });
            expect(entry).toMatchObject({ state: 'error' });
        });

        test(`${c.kind}: the service's own error is an error, with its words`, async ({ page }) => {
            await open(page);
            const entry = await drawAndRead(page, { kind: c.kind, route: c.route, id: `w_state_${c.kind}`, answer: { fetchedAt: Date.now(), error: 'unreachable', [c.list]: [] } });
            expect(entry).toMatchObject({ state: 'error', reason: 'unreachable' });
        });

        test(`${c.kind}: an answer with nothing in it ${c.emptyIsFine ? 'is a fine answer' : 'is empty'}`, async ({ page }) => {
            await open(page);
            const entry = await drawAndRead(page, { kind: c.kind, route: c.route, id: `w_state_${c.kind}`, answer: { fetchedAt: Date.now(), [c.list]: [] } });
            if (c.emptyIsFine) expect(entry).toBeNull();
            else expect(entry).toMatchObject({ state: 'empty' });
        });

        test(`${c.kind}: an answer with something in it is not listed`, async ({ page }) => {
            await open(page);
            const entry = await drawAndRead(page, { kind: c.kind, route: c.route, id: `w_state_${c.kind}`, answer: { fetchedAt: Date.now(), [c.list]: [c.item] } });
            expect(entry).toBeNull();
        });
    }
});
