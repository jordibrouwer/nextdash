// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The panels the redesign added or corrected, drawn from seeded figures so
 * each assertion is about what the panel does with them.
 */

const DAY = 86400000;

async function openStats(page) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => window.DashboardConfigStatsReady === true, null, { timeout: 20_000 });
    // Overview asks for the report and the inbox on the way in; seeding
    // before they answer would have them overwrite what the test set.
    await page.waitForFunction(() => {
        const c = window.dashboardInstance.config;
        return c._statsHealth !== undefined && c._statsInboxItems !== undefined && c._statsTrend !== undefined;
    }, null, { timeout: 20_000 });
}

/** Seed bookmarks and server figures, then show one tab. */
async function show(page, tab, seed = {}) {
    await page.evaluate(({ tab, seed, DAY }) => {
        const d = window.dashboardInstance;
        const cfg = d.config;
        const pageId = d.pages?.[0]?.id ?? 1;
        if (seed.bookmarks) d.allBookmarks = seed.bookmarks.map((b) => ({ pageId, tags: [], ...b }));
        if ('health' in seed) cfg._statsHealth = seed.health;
        if ('trend' in seed) cfg._statsTrend = seed.trend;
        if ('inboxItems' in seed) cfg._statsInboxItems = seed.inboxItems;
        if ('inboxAgg' in seed) cfg._statsInboxAgg = seed.inboxAgg;
        if ('opensMode' in seed) cfg.statsOpensMode = seed.opensMode;
        if ('library' in seed) cfg._statsLibrary = seed.library;
        cfg.statsTab = tab;
        cfg.repaintStatsBody();
        void DAY;
    }, { tab, seed, DAY });
}

const health = (over = {}) => ({
    healthy: 10, broken: 2, monitorDown: 0, content: 0, unchecked: 0, stale: 0, drift: 0,
    duplicates: 0, shortcutConflicts: 0, orphanedCategories: 0,
    fleet: null, certificates: {}, archived: 1, tracked: 12, trend: [],
    flags: {}, avgScore: 90, newestCopyAt: 0, newestCopyName: '', brokenWithoutCopy: 2,
    missingPreview: 0, worst: [], incidents: [],
    ...over,
});

test.describe('statistics panels', () => {
    test('needs attention lists only what is above zero, each with its button', async ({ page }) => {
        await openStats(page);
        const now = Date.now();
        await show(page, 'overview', {
            bookmarks: [
                { url: 'https://a.example', name: 'A', openCount: 4, lastOpened: now - DAY, brokenSince: now - 3 * DAY },
                { url: 'https://b.example', name: 'B', openCount: 0 },
            ],
            health: health({ certificates: { x: { host: 'x.example', expiresAt: now + 5 * DAY } } }),
            inboxItems: [{ addedAt: now - 40 * DAY }],
            inboxAgg: {},
        });
        const rows = page.locator('.config-stats-attention-row');
        await expect(rows).toHaveCount(4);
        await expect(page.locator('[data-attention="broken"] [data-stats-action="open-health-view"]')).toBeVisible();
        await expect(page.locator('[data-attention="certs"]')).toContainText('x.example');
        await expect(page.locator('[data-attention="inbox"]')).toContainText('1 unread');

        await show(page, 'overview', {
            bookmarks: [{ url: 'https://a.example', name: 'A', openCount: 4, lastOpened: now - DAY }],
            health: health({ broken: 0, healthy: 12 }),
            inboxItems: [],
        });
        await expect(rows).toHaveCount(0);
        await expect(page.locator('.config-stats-summary')).toContainText('Nothing needs attention');
        // The three panels it replaced are gone; their habit sentence is
        // this list's opening line.
        await expect(page.locator('#config-stats-body')).not.toContainText(/Personal usage insights|What this says/);
        await expect(page.locator('.config-stats-summary .config-stats-headline')).toHaveCount(1);
    });

    test('the opens chart waits for two weeks of log, and the pick is remembered', async ({ page }) => {
        await openStats(page);
        const now = Date.now();
        await show(page, 'usage', {
            opensMode: '',
            bookmarks: [{ url: 'https://a.example', openCount: 2, lastOpened: now - DAY, openLog: [now - DAY, now - 2 * DAY] }],
        });
        await expect(page.locator('#config-stats-opens')).toHaveClass(/config-stats-opens--lastUsed/);
        await show(page, 'usage', {
            bookmarks: [{ url: 'https://a.example', openCount: 2, lastOpened: now - DAY, openLog: [now - 20 * DAY, now - DAY] }],
        });
        await expect(page.locator('#config-stats-opens')).toHaveClass(/config-stats-opens--opens/);

        await page.locator('[data-stats-opens-mode="lastUsed"]').click();
        await expect(page.locator('#config-stats-opens')).toHaveClass(/config-stats-opens--lastUsed/);
        const stored = await page.evaluate(() => localStorage.getItem('nextdash:config-stats-opens-mode-v1'));
        expect(stored).toBe('lastUsed');
        await page.evaluate(() => localStorage.removeItem('nextdash:config-stats-opens-mode-v1'));
    });

    test('the heatmap says how many opens it has until there are enough', async ({ page }) => {
        await openStats(page);
        const now = Date.now();
        await show(page, 'usage', { bookmarks: [{ url: 'https://a.example', openCount: 3, openLog: [now - 1000, now - 2000, now - 3000] }] });
        await expect(page.locator('.config-stats-heat-empty')).toContainText('3 opens');
        const log = Array.from({ length: 25 }, (_, i) => now - i * 3600000);
        await show(page, 'usage', { bookmarks: [{ url: 'https://a.example', openCount: 25, openLog: log }] });
        await expect(page.locator('.config-stats-heat .config-stats-heat-cell')).toHaveCount(168);
    });

    test('the inbox chart keeps its own range', async ({ page }) => {
        await openStats(page);
        const day = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
        await show(page, 'inbox', {
            inboxItems: [],
            inboxAgg: { dailyBuckets: { [day(1)]: { added: 2 }, [day(20)]: { added: 3, promoted: 1 } } },
        });
        // A day per row of the chart's table (uPlot draws the bars).
        const bars = page.locator('#config-stats-inbox-flow .nd-chart table.nd-chart-table tbody tr');
        await expect(bars).toHaveCount(30);
        // The usage range moving does not move this chart.
        await page.evaluate(() => { window.dashboardInstance.config.statsRange = 7; window.dashboardInstance.config.repaintStatsBody(); });
        await expect(bars).toHaveCount(30);
        await page.locator('[data-stats-inbox-range="7"]').click();
        await expect(bars).toHaveCount(7);
        await page.evaluate(() => { window.dashboardInstance.config.statsRange = 30; });
    });

    test('inbox sources read as words', async ({ page }) => {
        await openStats(page);
        await show(page, 'inbox', {
            inboxItems: [{ source: 'keep-undo', addedAt: Date.now() }, { addedAt: Date.now() }],
            inboxAgg: { bySource: { 'keep-undo': 1, unknown: 1 } },
        });
        const text = await page.locator('.config-stats-pair').last().textContent();
        expect(text).toContain('Back from Unsorted');
        expect(text).toContain('Not recorded');
        expect(text).not.toContain('keep-undo');
    });

    test('the health line counts every day the same way and leaves gaps', async ({ page }) => {
        await openStats(page);
        const t0 = new Date(2026, 7, 7).getTime();
        const trend = [
            // h meant something else in August; one broken link of 102.
            { t: t0, n: 102, h: 28, b: 1 },
            { t: t0 + DAY, n: 102, h: 28, b: 1 },
            { t: t0 + 3 * DAY, n: 100, h: 97, b: 3 },
        ];
        await show(page, 'health', { health: health({ trend }), trend });
        const summary = page.locator('.config-stats-trend-summary').first();
        await expect(summary).toContainText('down 2 points');
        await expect(summary).not.toContainText('up 70');
        await expect(summary).toContainText('1 days without a report');
        // The day without a report is a gap in the line: no value, not a zero.
        const rows = page.locator('#config-stats-health .config-stats-healthline-host .nd-chart table.nd-chart-table tbody tr');
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(2)).toContainText('—');
    });

    test('health shows outages, worst monitors and certificates by host, and no settings panel', async ({ page }) => {
        await openStats(page);
        const now = Date.now();
        await show(page, 'health', {
            health: health({
                fleet: {
                    monitors: 2, downNow: 0, avgResponseMs: 120, totalIncidents: 2,
                    uptime24h: { ratio: 1, samples: 10 }, uptime7d: { ratio: 0.9, samples: 70 }, uptime30d: { ratio: 0.95, samples: 300 },
                },
                worst: [{ name: 'tower', url: 'https://tower', ratio: 0.9, samples: 70, avgMs: 200 }],
                incidents: [
                    { name: 'tower', url: 'https://tower', durationMs: 3600000, reason: 'Timeout' },
                    { name: 'tower', url: 'https://tower', durationMs: 1800000, reason: 'Timeout' },
                ],
                certificates: { a: { host: 'soon.example', expiresAt: now + 3 * DAY } },
            }),
        });
        const body = page.locator('#config-stats-body');
        await expect(body).toContainText('1.5');
        await expect(body).toContainText('hours down');
        await expect(body).toContainText('tower');
        await expect(body).toContainText('soon.example');
        await expect(body).not.toContainText('Interleave search mode');
    });

    test('a figure that could not be fetched is left out, not shown empty', async ({ page }) => {
        await openStats(page);
        const html = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c._statsLibrary = { widgets: 2, widgetTypes: [], feeds: null, sources: null, trash: 3, backups: null };
            return c.renderStatsLibraryBody();
        });
        expect(html).toContain('Waiting in the trash');
        expect(html).not.toContain('Automatic backups kept');
        expect(html).not.toContain('Import sources');
    });

    test('collection counts the uncategorised, folds empty pages, and dates the newest local copy', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.__pages = d.pages;
            d.pages = [{ id: d.pages[0].id, name: 'main' }, { id: 424242, name: 'empty one' }];
        });
        await show(page, 'collection', {
            bookmarks: [
                { url: 'https://a.example', category: 'c1', archiveCheckedAt: Date.now() - 1000 },
                { url: 'https://b.example' },
            ],
            health: health({ newestCopyAt: Date.now() - 3 * DAY, newestCopyName: 'Copied page' }),
            library: { widgets: 0, widgetTypes: [], trash: 0 },
        });
        const body = page.locator('#config-stats-body');
        await expect(body).toContainText('Uncategorised');
        await expect(page.locator('.config-stats-empty-pages')).toContainText('1 pages without bookmarks');
        await expect(page.locator('#config-stats-library')).toContainText('Copied page');
        await page.evaluate(() => { const d = window.dashboardInstance; d.pages = d.__pages; });
    });
});
