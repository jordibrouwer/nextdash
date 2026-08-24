// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two ways the statistics figures were wrong.
 *
 * Categories are stored per page — a bookmark holds a bare name ("dev") and the
 * page it belongs to — so the same name on two pages is two categories, and the
 * Categories tile counted them that way. The panels underneath did not: they
 * keyed on the bare name, which merged the two into one row and averaged their
 * opens together. The same mis-keying broke the label lookup, so rows showed the
 * raw id instead of the category's display name.
 *
 * And computeActivity() clamped only the lower end of the bucket index. A
 * lastOpened dated ahead of now — clock skew between devices, or an import with
 * a bad date — made the offset negative, pushing the index past the end of the
 * array and writing outside it. The array grew holes, so every sum over it came
 * out NaN and the chart drew an extra bar.
 */

async function openStats(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
}

/** Two pages that both carry a category called "dev", used very differently. */
async function seedTwoPages(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        if (d.pages.length < 2) d.pages.push({ id: 'p2', name: 'Second' });
        const p1 = d.pages[0].id, p2 = d.pages[1].id;
        d.allBookmarks = [
            { name: 'A', url: 'https://a.example.com/', pageId: p1, category: 'dev', tags: [], openCount: 10, lastOpened: Date.now() },
            { name: 'B', url: 'https://b.example.com/', pageId: p2, category: 'dev', tags: [], openCount: 0, lastOpened: 0 },
        ];
        return { p1: String(p1), p2: String(p2) };
    });
}

test.describe('statistics: categories are counted per page', () => {
    test('the same name on two pages stays two categories', async ({ page }) => {
        await openStats(page);
        await seedTwoPages(page);
        const s = await page.evaluate(() => {
            const st = window.dashboardInstance.config.computeStats();
            return { tile: st.categories, rows: st.perCategory.length, effRows: st.categoryEffectiveness.length };
        });
        // The tile always counted 2; the panels used to collapse to 1, so the
        // page contradicted itself.
        expect(s.tile).toBe(2);
        expect(s.rows).toBe(2);
        expect(s.effRows).toBe(2);
    });

    test('opens per bookmark is not averaged across pages', async ({ page }) => {
        await openStats(page);
        await seedTwoPages(page);
        const eff = await page.evaluate(() =>
            window.dashboardInstance.config.computeStats()
                .categoryEffectiveness.map((c) => c.perBookmark).sort((a, b) => b - a));
        // 10 opens over 1 bookmark, and 0 over 1 — not 5.0 twice.
        expect(eff).toEqual([10, 0]);
    });

    test('the page name disambiguates a duplicated category name', async ({ page }) => {
        await openStats(page);
        await seedTwoPages(page);
        const labels = await page.evaluate(() =>
            window.dashboardInstance.config.computeStats().perCategory.map((r) => r[0]));
        expect(labels).toHaveLength(2);
        // Both rows would otherwise read "dev", which names neither of them.
        expect(new Set(labels).size).toBe(2);
        for (const l of labels) expect(l).toMatch(/dev/i);
    });

    test('a category unique to one page is not prefixed', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks = [{
                name: 'Solo', url: 'https://solo.example.com/', pageId: d.pages[0].id,
                category: 'development', tags: [], openCount: 1, lastOpened: Date.now(),
            }];
        });
        const labels = await page.evaluate(() =>
            window.dashboardInstance.config.computeStats().perCategory.map((r) => r[0]));
        // Prefixing unconditionally would make every row on a single-page
        // install read "main · …", which is noise rather than clarification.
        expect(labels[0]).not.toContain('·');
    });

    test('labels do not depend on a leftover bookmarks page filter', async ({ page }) => {
        await openStats(page);
        const ids = await seedTwoPages(page);
        const labels = await page.evaluate((p1) => {
            const c = window.dashboardInstance.config;
            // knownCategories() is page-scoped; computeStats must not inherit it.
            c.bmPageFilter = p1;
            const out = c.computeStats().perCategory.map((r) => r[0]);
            c.bmPageFilter = '';
            return out;
        }, ids.p1);
        expect(labels).toHaveLength(2);
        // A raw composite key leaking through would look like "p2::dev".
        for (const l of labels) expect(l).not.toContain('::');
    });
});

test.describe('statistics: a future lastOpened cannot corrupt the chart', () => {
    /** Seeds one bookmark dated ahead of now, plus one genuinely recent. */
    async function seedFuture(page, range = 30) {
        await page.evaluate((r) => {
            const d = window.dashboardInstance;
            const pageId = d.pages[0].id;
            const now = Date.now();
            d.allBookmarks = [
                { name: 'Future', url: 'https://f.example.com/', pageId, category: '', tags: [], openCount: 1, lastOpened: now + 5 * 86400000 },
                { name: 'Recent', url: 'https://r.example.com/', pageId, category: '', tags: [], openCount: 1, lastOpened: now - 86400000 },
            ];
            d.config.statsRange = r;
        }, range);
    }

    test('the bucket array keeps its declared length', async ({ page }) => {
        await openStats(page);
        await seedFuture(page);
        const a = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const act = c.computeActivity(window.dashboardInstance.allBookmarks);
            return {
                length: act.buckets.length,
                labels: act.labels.length,
                dates: act.dateLabels.length,
                sum: act.buckets.reduce((x, y) => x + y, 0),
            };
        });
        expect(a.length).toBe(30);
        expect(a.labels).toBe(30);
        expect(a.dates).toBe(30);
        // The out-of-range write left holes, so this used to be NaN.
        expect(Number.isNaN(a.sum)).toBe(false);
        expect(a.sum).toBe(2);
    });

    test('a future date lands in the newest bucket rather than off the end', async ({ page }) => {
        await openStats(page);
        await seedFuture(page);
        const buckets = await page.evaluate(() =>
            window.dashboardInstance.config.computeActivity(window.dashboardInstance.allBookmarks).buckets);
        expect(buckets[buckets.length - 1]).toBe(1);
        expect(buckets.every((n) => Number.isFinite(n))).toBe(true);
    });

    test('it holds on the ranges that bucket by week and month', async ({ page }) => {
        await openStats(page);
        for (const range of [7, 90, 365]) {
            await seedFuture(page, range);
            const a = await page.evaluate(() => {
                const act = window.dashboardInstance.config.computeActivity(window.dashboardInstance.allBookmarks);
                return { sum: act.buckets.reduce((x, y) => x + y, 0), len: act.buckets.length };
            });
            expect(Number.isNaN(a.sum), `range ${range}`).toBe(false);
            expect(a.sum, `range ${range}`).toBe(2);
        }
    });

    test('the chart draws one bar per bucket', async ({ page }) => {
        await openStats(page);
        await seedFuture(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.statsTab = 'activity';
            c.repaintStatsBody();
        });
        // 31 bars on a 30-day range was the visible symptom.
        await expect(page.locator('.config-chart-bar')).toHaveCount(30);
    });

    test('the headline count agrees with the bars', async ({ page }) => {
        await openStats(page);
        await seedFuture(page);
        const a = await page.evaluate(() =>
            window.dashboardInstance.config.computeActivity(window.dashboardInstance.allBookmarks));
        // activeCount had no upper bound of its own, so it could count a
        // bookmark the bars had dropped.
        expect(a.activeCount).toBe(a.buckets.reduce((x, y) => x + y, 0));
    });

    test('a non-numeric timestamp is ignored rather than poisoning the sum', async ({ page }) => {
        await openStats(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const pageId = d.pages[0].id;
            d.allBookmarks = [
                { name: 'Junk', url: 'https://j.example.com/', pageId, category: '', tags: [], openCount: 1, lastOpened: 'yesterday' },
                { name: 'Good', url: 'https://g.example.com/', pageId, category: '', tags: [], openCount: 1, lastOpened: Date.now() },
            ];
            d.config.statsRange = 30;
        });
        const a = await page.evaluate(() =>
            window.dashboardInstance.config.computeActivity(window.dashboardInstance.allBookmarks));
        expect(Number.isNaN(a.buckets.reduce((x, y) => x + y, 0))).toBe(false);
        expect(a.activeCount).toBe(1);
    });
});
