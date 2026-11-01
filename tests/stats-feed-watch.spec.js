// @ts-check
const http = require('http');
const { test, expect } = require('./fixtures');
const { installWithBookmarks, headers } = require('./helpers/feed-watch');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Stats → Watch feeds: the figures counted on the server about every
 * watched feed (feed_stats.go), the period and series switches, the per-feed
 * list, the hours of one feed, and the settings in Config → Watch feeds.
 */
// Polling is global on the worker's server, so the tests of this file take turns.
test.describe.configure({ mode: 'serial' });

/** A feed whose entries are dated a few hours ago, so they land in this week. */
async function startRecentSite(title) {
    const posts = [{ id: `${title}-0`, at: Date.now() - 30 * 24 * 3600e3 }];
    let base = '';
    const server = http.createServer((req, res) => {
        if (req.url === '/feed/') {
            res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
            res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>${title} Posts</title>${posts.slice().reverse().map((p) =>
                `<item><title>${p.id}</title><link>${base}/${p.id}</link><guid>${p.id}</guid><pubDate>${new Date(p.at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><title>${title}</title><link rel="alternate" type="application/rss+xml" href="/feed/">`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    return {
        url: `${base}/`,
        feed: `${base}/feed/`,
        /** n new entries, `step` apart, the newest `offset + step` ago. */
        add(n, step = 3600e3, offset = 0) {
            const ids = [];
            for (let i = n; i >= 1; i -= 1) {
                const id = `${title}-${posts.length}`;
                posts.push({ id, at: Date.now() - offset - i * step });
                ids.push(id);
            }
            return ids;
        },
        close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    };
}

const watch = async (request, site) => {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: site.feed, intervalMinutes: 1440 }] },
    })).ok()).toBe(true);
};
const poll = async (request) => expect((await request.post('/api/feeds/watch/poll', { headers, data: {} })).ok()).toBe(true);
const markRead = async (request, site, ids) => expect((await request.post('/api/feeds/watch/read', {
    headers, data: { bookmarkUrl: site.url, feedUrl: site.feed, ids, read: true },
})).ok()).toBe(true);
const stats = async (request, q = '') => (await (await request.get(`/api/feeds/stats${q}`)).json());

async function openStatsFeeds(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.locator('[data-stats-tab="feeds"]').click();
}

let alpha;
let beta;
test.beforeEach(async ({ request }) => {
    alpha = await startRecentSite('Alpha');
    beta = await startRecentSite('Beta');
    await installWithBookmarks(request, [{ name: 'Alpha Blog', site: alpha }, { name: 'Beta Blog', site: beta }]);
    await request.post('/api/settings', { data: { feedStatsEnabled: true, feedStatsKeepDays: 90 }, headers });
    expect((await request.post('/api/feeds/stats/reset', { headers, data: {} })).ok()).toBe(true);
});
test.afterEach(async () => {
    await alpha.close();
    await beta.close();
});

test.describe('with two watched feeds', () => {
    let alphaIds;
    let betaIds;
    test.beforeEach(async ({ request }) => {
        await watch(request, alpha);
        await watch(request, beta);
        alphaIds = alpha.add(3);
        betaIds = beta.add(1);
        await poll(request);
        await markRead(request, beta, betaIds);
        await markRead(request, alpha, [alphaIds[0]]);
    });

    test('the six figures say what was counted', async ({ page }) => {
        await openStatsFeeds(page);
        const kpis = page.locator('.config-stats-feeds-kpis');
        await expect(kpis).toBeVisible();
        const tile = (label) => kpis.locator('.config-tile')
            .filter({ has: page.locator('.config-tile-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.config-tile-value');
        await expect(tile('Feeds watched')).toHaveText('2');
        await expect(tile('Items this week')).toHaveText('4');
        await expect(tile('Unread now')).toHaveText('2');
        await expect(tile('Errors this week')).toHaveText('0');
        await expect(tile('Busiest feed')).toHaveText('Alpha Blog');
        // 2 of 4 read.
        await expect(kpis.locator('.config-tile', { hasText: 'of 4 this week' }).locator('.config-tile-value')).toHaveText('50%');
    });

    test('the period buttons change the number of days and are remembered', async ({ page }) => {
        await openStatsFeeds(page);
        const bars = page.locator('[data-stats-feeds-bars]');
        await expect(bars).toHaveAttribute('data-stats-feeds-bars', '30');
        for (const n of [7, 14, 90, 30]) {
            await page.locator(`[data-stats-feeds-range="${n}"]`).click();
            await expect(bars).toHaveAttribute('data-stats-feeds-bars', String(n));
            await expect(page.locator(`[data-stats-feeds-range="${n}"]`)).toHaveAttribute('aria-pressed', 'true');
        }
        await page.locator('[data-stats-feeds-range="14"]').click();
        await expect(bars).toHaveAttribute('data-stats-feeds-bars', '14');
        await openStatsFeeds(page);
        await expect(page.locator('[data-stats-feeds-bars]')).toHaveAttribute('data-stats-feeds-bars', '14');
    });

    test('the published and read switch changes the bars', async ({ page }) => {
        await openStatsFeeds(page);
        const bars = page.locator('[data-stats-feeds-bars]');
        await expect(bars).toHaveAttribute('data-stats-feeds-series-shown', 'published');
        await expect(bars).toHaveAttribute('data-stats-feeds-total', '4');
        await page.locator('[data-stats-feeds-series="read"]').click();
        await expect(bars).toHaveAttribute('data-stats-feeds-series-shown', 'read');
        await expect(bars).toHaveAttribute('data-stats-feeds-total', '2');
    });

    test('the per-feed list sorts, and a row opens the feed in Config → Watch feeds', async ({ page }) => {
        await openStatsFeeds(page);
        const names = page.locator('#config-stats-feeds-list .config-stats-feed-row .config-stats-feed-name');
        await expect(names).toHaveText(['Alpha Blog', 'Beta Blog']);
        await page.locator('[data-stats-feeds-sort="read"]').click();
        await expect(names).toHaveText(['Beta Blog', 'Alpha Blog']);
        await expect(page.locator('#config-stats-feeds-list .config-stats-feed-row').first()).toContainText('100%');

        await page.locator('#config-stats-feeds-list .config-stats-feed-row', { hasText: 'Beta Blog' }).click();
        const open = page.locator('[data-feed-watch-overview] .feed-watch-list-row.is-open');
        await expect(open).toHaveCount(1);
        await expect(open).toContainText('Beta Blog');
    });

    test('the hours follow the feed chosen, with a summary from twenty items', async ({ page, request }) => {
        // A check takes at most ten new items, so twenty arrive in two rounds,
        // each newer than what came before.
        alpha.add(10, 60e3, 10 * 60e3);
        await poll(request);
        alpha.add(10, 60e3);
        await poll(request);
        await openStatsFeeds(page);
        const heat = page.locator('#config-stats-feeds-hours [data-stats-feeds-heat]');
        await expect(heat).toHaveAttribute('data-stats-feeds-heat', /Alpha|127\.0\.0\.1/);
        const alphaID = await heat.getAttribute('data-stats-feeds-heat');
        expect(alphaID).toContain(alpha.feed);
        await expect(page.locator('#config-stats-feeds-hours .config-panel-title')).toHaveText('When Alpha Blog publishes');
        await expect(page.locator('[data-stats-feeds-hours-summary]')).toContainText(/Most items between \d\d:00 and \d\d:00/);
        await expect(page.locator('#config-stats-feeds-hours .config-stats-heat')).toHaveAttribute('role', 'img');

        await page.locator('[data-stats-feeds-hour]').selectOption({ label: 'Beta Blog · Beta Posts' });
        await expect(page.locator('#config-stats-feeds-hours .config-panel-title')).toHaveText('When Beta Blog publishes');
        await expect(page.locator('#config-stats-feeds-hours [data-stats-feeds-heat]')).toHaveAttribute('data-stats-feeds-heat', new RegExp(beta.feed.replace(/[.]/g, '\\.')));
        // One item is too few for a summary.
        await expect(page.locator('[data-stats-feeds-hours-summary]')).toHaveCount(0);
    });

    test('fits a phone without scrolling sideways', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await openStatsFeeds(page);
        await expect(page.locator('#config-stats-feeds-list')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('Reset in Config → Watch feeds clears the numbers', async ({ page, request }) => {
        expect((await stats(request, '?days=7')).totals.published).toBe(4);
        await openStatsFeeds(page);
        await page.evaluate(() => window.dashboardInstance.config.selectSection('feed-watch'));
        await page.locator('[data-config-action="resetFeedStats"]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect(page.locator('[data-config-action-status="resetFeedStats"]')).toHaveText('Statistics cleared.');
        const after = await stats(request, '?days=7');
        expect(after.totals.published).toBe(0);
        expect(after.daily.every((d) => d.published === 0 && d.read === 0)).toBe(true);
    });
});

test('without watched feeds the tab says nothing is recorded yet', async ({ page }) => {
    await openStatsFeeds(page);
    await expect(page.locator('[data-stats-feeds-state="empty"]')).toContainText('Nothing recorded yet. Watch a feed and the numbers fill in.');
});

test('switched off, the tab says so and links to the setting', async ({ page, request }) => {
    await watch(request, alpha);
    await request.post('/api/settings', { data: { feedStatsEnabled: false }, headers });
    alpha.add(2);
    await poll(request);
    await openStatsFeeds(page);
    const off = page.locator('[data-stats-feeds-state="off"]');
    await expect(off).toContainText('Statistics about watched feeds are off.');
    await off.locator('[data-stats-section-goto="feed-watch"]').click();
    await expect(page.locator('[data-behavior-field="feedStatsEnabled"]')).toBeVisible();
    await request.post('/api/settings', { data: { feedStatsEnabled: true }, headers });
    expect((await stats(request, '?days=7')).totals.published).toBe(0);
});

test('the switch and the keep-days select in Config → Watch feeds save', async ({ page, request }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.locator('[data-config-section="feed-watch"]').click();
    const keep = page.locator('[data-behavior-field="feedStatsKeepDays"]');
    await expect(keep).toHaveValue('90');
    await keep.selectOption('365');
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedStatsKeepDays).toBe(365);
    const toggle = page.locator('[data-behavior-field="feedStatsEnabled"]');
    await expect(toggle).toBeChecked();
    await toggle.click({ force: true });
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).feedStatsEnabled).toBe(false);
    await expect(page.locator('[data-info-field="feedStatsEnabled"]')).toBeVisible();
    await request.post('/api/settings', { data: { feedStatsEnabled: true, feedStatsKeepDays: 90 }, headers });
});
