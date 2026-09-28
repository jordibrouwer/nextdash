// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The figures behind the Statistics panels, checked without drawing them.
 * Each function is pure, so each test hands it data and reads the answer.
 */

async function openStats(page) {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => window.DashboardConfigStatsFiguresReady === true, null, { timeout: 20_000 });
}

const call = (page, fn, ...args) => page.evaluate(
    ([name, rest]) => window.dashboardInstance.config[name](...rest), [fn, args]);

test.describe('statistics figures', () => {
    test('healthy share comes from broken, down and unchecked, one slot per day', async ({ page }) => {
        await openStats(page);
        const out = await page.evaluate(() => {
            const t0 = new Date(2026, 7, 7).getTime();
            const t2 = new Date(2026, 7, 9).getTime();
            return window.dashboardInstance.config.statsHealthySeries([
                // The old meaning of h: 28 "healthy" with one broken link.
                { t: t0, n: 102, h: 28, b: 1 },
                { t: t2, n: 100, h: 97, b: 2, d: 1 },
            ]);
        });
        expect(out.map((p) => p.pct)).toEqual([99, null, 97]);
    });

    test('the last-used chart no longer claims a change against a previous period', async ({ page }) => {
        await openStats(page);
        const wow = await page.evaluate(() => window.dashboardInstance.config.computeStats().activity.wow);
        expect(wow).toBeUndefined();
    });

    test('opens per day come from openLog', async ({ page }) => {
        await openStats(page);
        const out = await page.evaluate(() => {
            const now = new Date(2026, 8, 28, 14).getTime();
            const day = 86400000;
            return window.dashboardInstance.config.statsOpenLogSeries([
                { openLog: [now - day, now - day + 1000, now - 3 * day], lastOpened: now - day },
                { openLog: [now - 40 * day] },
            ], 7, now);
        });
        expect(out.total).toBe(3);
        expect(out.buckets).toEqual([0, 0, 0, 1, 0, 2, 0]);
        expect(out.span).toBe(40);
        // The log reaches back past the previous week, so it can be compared.
        expect(out.prevTotal).toBe(0);
    });

    test('no comparison while the log does not cover the previous period', async ({ page }) => {
        await openStats(page);
        const out = await page.evaluate(() => {
            const now = new Date(2026, 8, 28, 14).getTime();
            return window.dashboardInstance.config.statsOpenLogSeries(
                [{ openLog: [now - 2 * 86400000] }], 7, now);
        });
        expect(out.prevTotal).toBeNull();
    });

    test('heatmap places an open on its local weekday and hour', async ({ page }) => {
        await openStats(page);
        const cell = await page.evaluate(() => {
            // 28 September 2026 is a Monday.
            const at = new Date(2026, 8, 28, 8, 30).getTime();
            const { grid, total } = window.dashboardInstance.config.statsOpenHeatmap([{ openLog: [at] }]);
            return { mon8: grid[0][8], total };
        });
        expect(cell).toEqual({ mon8: 1, total: 1 });
    });

    test('recency, opens and tag bands add up to the collection', async ({ page }) => {
        await openStats(page);
        const out = await page.evaluate(() => {
            const now = Date.now();
            const day = 86400000;
            const bms = [
                { lastOpened: now - day, openCount: 12, tags: ['a', 'b', 'c'] },
                { lastOpened: now - 10 * day, openCount: 1, tags: ['a'] },
                { lastOpened: now - 60 * day, openCount: 3, tags: [] },
                { lastOpened: now - 200 * day, openCount: 7 },
                { openCount: 0 },
            ];
            const cfg = window.dashboardInstance.config;
            return {
                recency: cfg.statsRecency(bms, now),
                bands: cfg.statsOpenCountBands(bms),
                tags: cfg.statsTagsPerBookmark(bms),
            };
        });
        expect(out.recency).toEqual([['lt7', 1], ['d7_30', 1], ['d30_90', 1], ['gt90', 1], ['never', 1]]);
        expect(out.bands).toEqual([['0', 1], ['1', 1], ['2-4', 1], ['5-9', 1], ['10+', 1]]);
        expect(out.tags).toEqual([['0', 3], ['1', 1], ['2', 0], ['3+', 1]]);
    });

    test('concentration curve marks the top 1, 5 and 10', async ({ page }) => {
        await openStats(page);
        const out = await call(page, 'statsConcentrationCurve', [
            { openCount: 50 }, { openCount: 20 }, { openCount: 10 }, { openCount: 10 },
            { openCount: 5 }, { openCount: 5 }, { openCount: 0 },
        ]);
        expect(out.total).toBe(100);
        expect(out.used).toBe(6);
        expect(out.marks).toEqual({ 1: 50, 5: 95 });
        expect(out.points[out.points.length - 1]).toEqual([6, 100]);
    });

    test('domains split self-hosted from internet', async ({ page }) => {
        await openStats(page);
        const d = await call(page, 'statsDomains', [
            { url: 'https://www.github.com/a' }, { url: 'https://github.com/b' },
            { url: 'http://192.168.0.3' }, { url: 'https://tower.tail1.ts.net' }, { url: 'https://nas.local' },
            { url: 'not a url' },
        ]);
        expect(d.hosts[0]).toEqual(['github.com', 2]);
        expect(d.unique).toBe(4);
        expect(d.selfHosted).toBe(3);
        expect(d.internet).toBe(2);
        expect(d.tlds).toEqual([['com', 2]]);
    });

    test('age bands keep the undated apart', async ({ page }) => {
        await openStats(page);
        const out = await page.evaluate(() => {
            const now = Date.now();
            const day = 86400000;
            return window.dashboardInstance.config.statsAge([
                { createdAt: now - 5 * day }, { createdAt: now - 45 * day },
                { createdAt: now - 120 * day }, { createdAt: now - 400 * day }, {},
            ], now);
        });
        expect(out).toEqual([['lt30', 1], ['d30_90', 1], ['d90_180', 1], ['gt180', 1], ['undated', 1]]);
    });

    test('growth keeps twelve months including empty ones', async ({ page }) => {
        await openStats(page);
        const g = await page.evaluate(() => {
            const now = new Date(2026, 8, 28).getTime();
            return window.dashboardInstance.config.statsGrowthMonths([
                { createdAt: new Date(2025, 0, 3).getTime() },
                { createdAt: new Date(2026, 4, 3).getTime() },
                { createdAt: new Date(2026, 8, 1).getTime() },
                {},
            ], now);
        });
        expect(g.months.length).toBe(12);
        expect(g.months[0]).toEqual(['2025-10', 0]);
        expect(g.months[7]).toEqual(['2026-05', 1]);
        expect(g.months[8]).toEqual(['2026-06', 0]);
        expect(g.months[11]).toEqual(['2026-09', 1]);
        // The January 2025 bookmark predates the window but is in the total.
        expect(g.running[0]).toBe(1);
        expect(g.running[11]).toBe(3);
        expect(g.undated).toBe(1);
    });

    test('categories count the uncategorised and pages drop the empty ones', async ({ page }) => {
        await openStats(page);
        const s = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cfg = d.config;
            const original = d.allBookmarks;
            const originalPages = d.pages;
            d.pages = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }];
            d.allBookmarks = [
                { url: 'https://a.example', pageId: 1, category: 'c1', tags: [] },
                { url: 'https://b.example', pageId: 1, tags: [] },
            ];
            cfg.invalidateStatsCache();
            const out = cfg.computeStats();
            d.allBookmarks = original;
            d.pages = originalPages;
            cfg.invalidateStatsCache();
            return {
                cats: out.perCategory.reduce((n, [, c]) => n + c, 0),
                pages: out.perPage.map(([name]) => name),
                empty: out.emptyPages,
            };
        });
        expect(s.cats).toBe(2);
        expect(s.pages).toEqual(['one']);
        expect(s.empty).toBe(1);
    });

    test('health extras read flags, scores and the newest local copy', async ({ page }) => {
        await openStats(page);
        const x = await page.evaluate(() => window.DashboardConfig.statsHealthExtras({
            summary: { missingPreviewCount: 4 },
            fleet: { worst: [{ name: 'tower' }], incidents: [{ name: 'tower', durationMs: 60000 }] },
            issues: [
                { name: 'A', flags: ['healthy', 'stale'], score: 90, localCopies: 1, localCopyAt: 2000 },
                { name: 'B', flags: ['broken'], score: 70, lastError: 'Timeout' },
                { name: 'C', flags: ['stale'], score: 100, localCopies: 2, localCopyAt: 5000, archiveCheckedAt: 9000 },
            ],
        }));
        expect(x.flags).toEqual({ healthy: 1, stale: 2, broken: 1 });
        expect(x.avgScore).toBe(86.7);
        expect(x.newestCopyAt).toBe(5000);
        expect(x.newestCopyName).toBe('C');
        expect(x.brokenWithoutCopy).toBe(1);
        expect(x.missingPreview).toBe(4);
        expect(x.worst.length).toBe(1);
        expect(x.incidents.length).toBe(1);
    });
});
