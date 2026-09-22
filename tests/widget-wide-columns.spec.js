// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A tile given two columns should say more, not say the same thing larger.
 *
 * The extra blocks are built at every width and hidden again by a container
 * query, so what is on screen follows the room the tile actually got: the grid
 * narrows a two-column widget back to one whenever the dashboard is showing
 * one, and a phone never shows two at all. These read visibility rather than
 * the DOM, because a block nobody can see is not a block the tile shows.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Draw one widget type at a given width, and report what is visible in it. */
function drawAt(page, type, width, prepare) {
    return page.evaluate(async ({ type, width, prepare }) => {
        document.querySelectorAll('.wide-probe').forEach((n) => n.remove());
        const host = document.createElement('div');
        host.className = 'dashboard-widget wide-probe';
        host.style.cssText = `width:${width}px;position:fixed;left:10px;top:10px;z-index:9999;`;
        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        host.appendChild(body);
        document.body.appendChild(host);

        const d = window.dashboardInstance;
        const realFetch = window.fetch;
        // The prepare step may stub fetch for the tiles that read an endpoint;
        // it is put back before anything else on the page asks.
        // eslint-disable-next-line no-new-func
        new Function('d', prepare)(d);
        try {
            await window.DashboardWidgets[type](body, { id: `probe-${type}-${width}`, type, config: {} }, d);
        } finally {
            window.fetch = realFetch;
        }

        const seen = (selector) => [...body.querySelectorAll(selector)]
            .filter((el) => el.offsetParent !== null);
        const columnsOf = (selector) => {
            const el = body.querySelector(selector);
            if (!el || el.offsetParent === null) return 0;
            const cols = getComputedStyle(el).gridTemplateColumns.trim();
            return cols === 'none' ? 1 : cols.split(/\s+/).length;
        };
        return {
            text: body.innerText.replace(/\s+/g, ' ').trim(),
            trendRows: seen('.dashboard-widget-trend-row').length,
            runTimes: seen('.dashboard-widget-row-detail.dashboard-widget-wide-only').length,
            healthRows: seen('.dashboard-widget-health-row').length,
            healthColumns: columnsOf('.dashboard-widget-health'),
            stats: seen('.dashboard-widget-stat').length,
            rowColumns: columnsOf('.dashboard-widget-rows'),
        };
    }, { type, width, prepare });
}

const HEALTH_SUMMARY = `d.healthSummary = {
    totalBookmarks: 100, healthyCount: 90, brokenCount: 6,
    monitorDownCount: 2, contentCount: 2,
};`;

const INBOX_ITEMS = `const day = 24 * 60 * 60 * 1000;
d._widgetInbox = [
    { id: '1', url: 'https://a.example/', title: 'Newest', addedAt: Date.now() - 1000, source: 'extension' },
    { id: '2', url: 'https://b.example/', title: 'Middle', addedAt: Date.now() - 3 * day, source: 'email' },
    { id: '3', url: 'https://c.example/', title: 'Oldest', addedAt: Date.now() - 30 * day, source: 'email' },
];`;

test.describe('widgets drawn wide', () => {
    /*
     * Broken and down now are what a narrow tile has room to carry; content
     * and healthy arrive with the width. Two abreast rather than four in a
     * file, so the second column holds figures and not white space.
     */
    test('the health tile carries two figures narrow and four wide', async ({ page }) => {
        await openDashboard(page);

        const narrow = await drawAt(page, 'health', 300, HEALTH_SUMMARY);
        expect(narrow.healthRows).toBe(2);
        expect(narrow.healthColumns).toBe(1);

        const wide = await drawAt(page, 'health', 700, HEALTH_SUMMARY);
        expect(wide.healthRows).toBe(4);
        expect(wide.healthColumns).toBe(2);
    });

    /*
     * The inbox headline answers "is it filling up". What arrived today, what
     * arrived this week and how long the queue has really stood answer "what
     * happened lately", and those are what the second column is for.
     */
    test('the inbox tile adds its figures and pairs its rows when wide', async ({ page }) => {
        await openDashboard(page);

        const narrow = await drawAt(page, 'inbox', 300, INBOX_ITEMS);
        expect(narrow.stats).toBe(0);
        expect(narrow.rowColumns).toBe(1);
        // The headline is the narrow tile's whole reading, and it stays.
        expect(narrow.text).toContain('3');

        const wide = await drawAt(page, 'inbox', 700, INBOX_ITEMS);
        expect(wide.stats).toBe(4);
        expect(wide.rowColumns).toBe(2);
        expect(wide.text.toLowerCase()).toContain('this week');
    });
});

const METRICS = (payload) => `const real = window.fetch;
window.fetch = async (url, ...rest) => (String(url).includes('/api/system/metrics')
    ? new Response(JSON.stringify(${payload}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : real(url, ...rest));
d._widgetSystem = {};`;

const MEMORY = METRICS(`{ memory: { available: true, usedPercent: 62, usedBytes: 6e9, availableBytes: 3e9,
    cacheBytes: 2e9, totalBytes: 1e10, hasSwap: true, swapUsedBytes: 1e8, swapTotalBytes: 2e9, swapPercent: 5 } }`);

const DISKS = METRICS(`{ disks: { available: true, freeBytes: 4e11, usedBytes: 6e11, totalBytes: 1e12,
    usedPercent: 60, unreadable: 0, mounts: [{ path: '/mnt/user', label: 'Files', freeBytes: 4e11,
    usedBytes: 6e11, totalBytes: 1e12, usedPercent: 60, inodesTotal: 1000, inodesFree: 400 }] } }`);

const DOCKER = METRICS(`{ docker: { available: true, running: 12, stopped: 2, paused: 0, unhealthy: 1,
    total: 15, images: 40, unhealthyNames: ['jellyfin'], restartedNames: [] } }`);

const SOURCES = `const real = window.fetch;
d._widgetSources = null;
window.fetch = async (url, ...rest) => (String(url).includes('/api/sources')
    ? new Response(JSON.stringify([{ id: 'a', label: 'Pocket', lastResult: 'imported 42', lastRun: Date.now() - 3600000 }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    : real(url, ...rest));`;

const MONITORS = `d.healthReport = { issues: [
    { url: 'https://one.example/', monitor: true, monitorStats: { uptime7d: { ratio: 0.99, samples: 100 }, heartbeat: [] } },
    { url: 'https://two.example/', monitor: true, monitorStats: { uptime7d: { ratio: 0.95, samples: 100 }, heartbeat: [], downSince: Date.now() } },
] };`;

const TREND = `d.healthSummary = { totalBookmarks: 100, healthyCount: 90, brokenCount: 6,
    monitorDownCount: 2, contentCount: 2, monitoredCount: 4 };
d._widgetTrend = [];`;

const WEATHER = `d.settings = { ...(d.settings || {}), weatherSource: 'manual', weatherLocation: 'Leiden' };
d.weatherService = { lastFetchError: null, getWeatherType: () => 'cloudy', getWeatherLabelKey: () => 'weather.cloudy', fetchForecast: async () => ({
    locationName: 'Leiden',
    current: { temperature: 19, weatherCode: 3, unitSymbol: 'C', apparentTemperature: 17,
        humidity: 71, windSpeed: 12, windUnit: 'km/h', precipitationChance: 40 },
    days: [{ date: '2026-09-22', tempMax: 21, tempMin: 14, weatherCode: 3 }],
}) };`;

test.describe('the system tiles drawn wide', () => {
    /*
     * The cache is memory that is busy and instantly available at the same
     * time -- the half of the story a used-percentage leaves out. A tile with
     * the room says it whether or not the box was ticked.
     */
    test('memory adds the cache when there is room for it', async ({ page }) => {
        await openDashboard(page);
        expect((await drawAt(page, 'memory', 300, MEMORY)).stats).toBe(3);
        expect((await drawAt(page, 'memory', 700, MEMORY)).stats).toBe(4);
    });

    /* Used and total are what the headline already implies; free and how full
       are the pair a narrow tile keeps. */
    test('disks break their totals out when wide', async ({ page }) => {
        await openDashboard(page);
        expect((await drawAt(page, 'disks', 300, DISKS)).stats).toBe(2);
        expect((await drawAt(page, 'disks', 700, DISKS)).stats).toBe(4);
    });

    /* Running and stopped are the pair; the rest of the figures, and the name
       of what is failing, arrive with the width. */
    test('containers show every figure, and what is failing, when wide', async ({ page }) => {
        await openDashboard(page);
        const narrow = await drawAt(page, 'docker', 300, DOCKER);
        expect(narrow.stats).toBe(2);
        expect(narrow.text).not.toContain('jellyfin');

        const wide = await drawAt(page, 'docker', 700, DOCKER);
        expect(wide.stats).toBe(6);
        expect(wide.text).toContain('jellyfin');
    });

    /* A file of percentages says how one host is doing; the summary says how
       the watch is doing. */
    test('uptime adds its summary and pairs its rows when wide', async ({ page }) => {
        await openDashboard(page);
        const narrow = await drawAt(page, 'uptime', 300, MONITORS);
        expect(narrow.stats).toBe(0);
        expect(narrow.rowColumns).toBe(1);

        const wide = await drawAt(page, 'uptime', 700, MONITORS);
        expect(wide.stats).toBe(3);
        expect(wide.rowColumns).toBe(2);
    });

    /* "Imported 42" cannot say whether the source has stopped; a week-old
       success and this morning's read the same until the time is on the tile. */
    test('sources print when each last ran once there is room', async ({ page }) => {
        await openDashboard(page);
        expect((await drawAt(page, 'sources', 300, SOURCES)).runTimes).toBe(0);
        expect((await drawAt(page, 'sources', 700, SOURCES)).runTimes).toBe(1);
    });

    /* Score and trend are the reading; broken, down and the rest are the
       detail behind it. */
    test('the trend tile keeps two rows narrow and opens up wide', async ({ page }) => {
        await openDashboard(page);
        const narrow = await drawAt(page, 'trend', 300, TREND);
        expect(narrow.trendRows).toBe(2);

        const wide = await drawAt(page, 'trend', 700, TREND);
        expect(wide.trendRows).toBeGreaterThan(2);
    });

    /* A temperature answers "how warm"; these answer what anyone asks next. */
    test('weather adds what it feels like, the wind and the rain when wide', async ({ page }) => {
        await openDashboard(page);
        const narrow = await drawAt(page, 'weather', 300, WEATHER);
        expect(narrow.stats).toBe(0);
        expect(narrow.text).toContain('19');

        const wide = await drawAt(page, 'weather', 700, WEATHER);
        expect(wide.stats).toBe(4);
        expect(wide.text.toLowerCase()).toContain('humidity');
    });
});


// HealthFacts.certificates is a getter over what the badge's own request
// carried, and the tile reads it first -- so the stand-in replaces the store
// rather than assigning through it, which a getter would swallow.
const CERTS = `d.healthSummary = { totalBookmarks: 2 };
window.HealthFacts = { certificates: {
    'one.example': { host: 'one.example', expiresAt: Date.now() + 3 * 86400000 },
    'two.example': { host: 'two.example', expiresAt: Date.now() + 20 * 86400000 },
} };`;

const FEEDS = `const real = window.fetch;
d._widgetFeeds = null;
window.fetch = async (url, ...rest) => (String(url).includes('/api/feeds')
    ? new Response(JSON.stringify({ feeds: {
        a: { feedUrl: 'https://a.example/feed', newCount: 3 },
        b: { feedUrl: 'https://b.example/feed', newCount: 0, retired: true },
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : real(url, ...rest));`;

const NEGLECTED = `const day = 24 * 60 * 60 * 1000;
d.allBookmarks = [
    { name: 'Dropped', url: 'https://a.example/', pageId: 1, lastOpened: Date.now() - 400 * day, createdAt: Date.now() - 500 * day },
    { name: 'Never touched', url: 'https://b.example/', pageId: 1, lastOpened: 0, createdAt: Date.now() - 400 * day },
];`;

test.describe('the list tiles drawn wide', () => {
    /* "14d" is the urgency; the date is what goes in the diary, and a tooltip
       cannot be read at a glance or on a phone at all. */
    test('certificates add their summary and the dates when wide', async ({ page }) => {
        await openDashboard(page);

        const narrow = await drawAt(page, 'certs', 300, CERTS);
        expect(narrow.stats).toBe(0);
        expect(narrow.runTimes).toBe(0);

        const wide = await drawAt(page, 'certs', 700, CERTS);
        expect(wide.stats).toBe(3);
        expect(wide.runTimes).toBe(2);
        expect(wide.rowColumns).toBe(2);
    });

    /* The rows say which feeds have something new; the summary says how many
       are followed at all and how many have quietly stopped. */
    test('feeds add how many are followed and how many stopped', async ({ page }) => {
        await openDashboard(page);
        expect((await drawAt(page, 'feeds', 300, FEEDS)).stats).toBe(0);

        const wide = await drawAt(page, 'feeds', 700, FEEDS);
        expect(wide.stats).toBe(3);
        expect(wide.rowColumns).toBe(2);
    });

    /* "Eleven neglected" is one number for two different piles: dropped after
       a while, and never opened at all. */
    test('neglected splits its count when there is room', async ({ page }) => {
        await openDashboard(page);
        expect((await drawAt(page, 'neglected', 300, NEGLECTED)).stats).toBe(0);

        const wide = await drawAt(page, 'neglected', 700, NEGLECTED);
        expect(wide.stats).toBe(3);
        expect(wide.text.toLowerCase()).toContain('never opened');
    });
});

const CALENDAR = `const real = window.fetch;
delete d._widgetCalendar;
window.fetch = async (url, ...rest) => (String(url).includes('/api/widgets/calendar')
    ? new Response(JSON.stringify({ fetchedAt: Date.now(), events: [
        { title: 'Standup', start: Date.now() + 3600000, end: Date.now() + 5400000 },
        { title: 'Release day', start: Date.now() + 5 * 86400000, allDay: true },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : real(url, ...rest));`;

test.describe('the calendar tile drawn wide', () => {
    /* "Thu 14:00" is enough to recognise an appointment and not enough to plan
       around one: which Thursday, and how long it takes, are the two things a
       diary is read for. */
    test('the calendar adds the date and the length when wide', async ({ page }) => {
        await openDashboard(page);

        const narrow = await drawAt(page, 'calendar', 300, CALENDAR);
        expect(narrow.runTimes).toBe(0);
        expect(narrow.rowColumns).toBe(1);

        const wide = await drawAt(page, 'calendar', 700, CALENDAR);
        expect(wide.runTimes).toBe(2);
        expect(wide.rowColumns).toBe(2);
        expect(wide.text.toLowerCase()).toContain('all day');
    });
});
