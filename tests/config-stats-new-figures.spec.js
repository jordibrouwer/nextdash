// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Figures the install already recorded but never showed: how many bookmarks
 * are pinned, when anything was last edited or last kept, how long the
 * longest-standing failure has been failing, and how the collection grew.
 */

async function openStats(page) {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // 'stats', not 'statistics': that is the section id the view registers.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForSelector('#config-stats-body .config-panel', { timeout: 20_000 });
}

test.describe('statistics figures', () => {
    test('counts pinned bookmarks and the newest edit', async ({ page }) => {
        await openStats(page);

        const s = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cfg = d.config;
            const original = d.allBookmarks;
            d.allBookmarks = [
                { url: 'https://a.example/1', pageId: 1, pinned: true, updatedAt: 1000, tags: [] },
                { url: 'https://a.example/2', pageId: 1, pinned: true, updatedAt: 5000, tags: [] },
                { url: 'https://a.example/3', pageId: 1, updatedAt: 3000, tags: [] },
            ];
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            const out = cfg.computeStats();
            d.allBookmarks = original;
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            return { pinned: out.pinned, lastTouched: out.lastTouched };
        });

        expect(s.pinned).toBe(2);
        // The newest edit, not the last one seen.
        expect(s.lastTouched).toBe(5000);
    });

    test('reports the longest-standing failure, not just how many', async ({ page }) => {
        await openStats(page);

        const s = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cfg = d.config;
            const original = d.allBookmarks;
            d.allBookmarks = [
                { url: 'https://a.example/new', pageId: 1, brokenSince: 9000, name: 'Newer', tags: [] },
                { url: 'https://a.example/old', pageId: 1, brokenSince: 1000, name: 'Older', tags: [] },
            ];
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            const out = cfg.computeStats();
            d.allBookmarks = original;
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            return { at: out.oldestBrokenAt, name: out.oldestBrokenName };
        });

        // The oldest timestamp wins, which is the smallest one.
        expect(s.at).toBe(1000);
        expect(s.name).toBe('Older');
    });

    test('growth counts by month and says how many could be dated', async ({ page }) => {
        await openStats(page);

        const s = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cfg = d.config;
            const original = d.allBookmarks;
            const jan = new Date(2026, 0, 15).getTime();
            const feb = new Date(2026, 1, 2).getTime();
            d.allBookmarks = [
                { url: 'https://a.example/1', pageId: 1, createdAt: jan, tags: [] },
                { url: 'https://a.example/2', pageId: 1, createdAt: feb, tags: [] },
                { url: 'https://a.example/3', pageId: 1, createdAt: feb, tags: [] },
                // No createdAt: an older import, which must not be invented.
                { url: 'https://a.example/4', pageId: 1, tags: [] },
            ];
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            const out = cfg.computeStats();
            d.allBookmarks = original;
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            return { growth: out.growth, dated: out.withCreatedAt, total: out.total };
        });

        expect(s.growth).toEqual([['2026-01', 1], ['2026-02', 2]]);
        // Three of four could be placed, and the panel says so.
        expect(s.dated).toBe(3);
        expect(s.total).toBe(4);
    });

    /*
     * The row grew from six tiles to eight. A fixed repeat(6, ...) would have
     * squeezed every tile past legibility rather than wrapping, so the rule
     * has to give the row a column count it can actually fill.
     *
     * Read from the stylesheet rather than the rendered panel: the stats
     * module is loaded on demand and the fixture never gets far enough to
     * paint the tiles.
     */
    test('the overview tile row is allowed to wrap', async ({ page }) => {
        await page.goto('/');
        const css = await page.evaluate(async () => {
            const res = await fetch('/static/css/config-view.css');
            return res.ok ? res.text() : '';
        });
        expect(css).not.toBe('');

        const rule = css.slice(css.indexOf('.config-tiles--overview {'));
        const block = rule.slice(0, rule.indexOf('}'));
        // Not a hard six: eight tiles have to land somewhere sensible.
        expect(block).not.toMatch(/repeat\(6,/);
        expect(block).toMatch(/repeat\(4, minmax\(0, 1fr\)\)/);
        // And below the panel's usual width it hands back to auto-fit.
        expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]{0,200}config-tiles--overview[\s\S]{0,120}auto-fit/);
    });
});
