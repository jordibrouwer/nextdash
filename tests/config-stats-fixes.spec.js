// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Statistics: the report has to agree with the rest of the app, and
 * with itself.
 *
 * Two of these are about a number meaning the same thing everywhere — duplicates
 * counted the way Health counts them, and an export column named after the
 * threshold that actually produced it. The rest are about the section being
 * usable from any of its five tabs rather than only from the one the controls
 * happened to sit on.
 */

async function openStats(page, tab = 'overview') {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForSelector('#config-stats-body', { timeout: 15_000 });
    if (tab !== 'overview') {
        await page.evaluate((t) => {
            const c = window.dashboardInstance.config;
            c.statsTab = t;
            c.loadStatsTabData(t);
            c.repaintStatsBody();
        }, tab);
        await page.waitForTimeout(600);
    }
}

test.describe('statistics counts the same things as the rest of the app', () => {
    test('duplicates use the shared URL key, not a plain lowercase', async ({ page }) => {
        await openStats(page);

        const same = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return {
                // The three ways the same link is written. A plain lowercase
                // treats each as its own URL, so the panel and the Health view
                // reported different numbers for one library.
                slash: c.canonicalStatsUrlKey('https://example.com/') === c.canonicalStatsUrlKey('https://example.com'),
                fragment: c.canonicalStatsUrlKey('https://a.example/x#top') === c.canonicalStatsUrlKey('https://a.example/x'),
                host: c.canonicalStatsUrlKey('https://Example.COM/x') === c.canonicalStatsUrlKey('https://example.com/x'),
                // And it still tells genuinely different links apart.
                different: c.canonicalStatsUrlKey('https://a.example/x') !== c.canonicalStatsUrlKey('https://a.example/y'),
            };
        });
        expect(same).toEqual({ slash: true, fragment: true, host: true, different: true });
    });

    test('the export names the stale threshold it actually used', async ({ page }) => {
        await openStats(page);

        const rows = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c.dash.settings.bookmarkStaleDays = 30;
            // The export waits for the two server-side tabs before it writes
            // the file, so this awaits it; triggerDownload itself is still
            // synchronous, which is why the blob can be captured this way.
            let captured = null;
            const real = c.triggerDownload.bind(c);
            c.triggerDownload = (blob) => { captured = blob; };
            await c.exportStatsCSV();
            c.triggerDownload = real;
            return (await captured.text()).split('\n');
        });

        // The column used to be called stale_90_days whatever the setting said,
        // so an export from an install on 30 days carried a number under a
        // heading that contradicted the panel it came from.
        expect(rows).toContain('stale_days_threshold,30');
        expect(rows.some((r) => r.startsWith('stale_bookmarks,'))).toBe(true);
        expect(rows.some((r) => r.startsWith('stale_90_days,'))).toBe(false);
    });

    test('the export carries the tabs whose figures come from the server', async ({ page }) => {
        await openStats(page, 'inbox');
        // Health is loaded on its own tab; visit it so both are in hand.
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.statsTab = 'health';
            c.loadStatsTabData('health');
        });
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._statsHealth !== undefined), { timeout: 15_000 }).toBe(true);

        const csv = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            let captured = null;
            const real = c.triggerDownload.bind(c);
            c.triggerDownload = (blob) => { captured = blob; };
            await c.exportStatsCSV();
            c.triggerDownload = real;
            return captured.text();
        });

        // Two of the five tabs contributed nothing to a file described as the
        // report.
        expect(csv).toContain('inbox_added_lifetime,');
        expect(csv).toContain('health_healthy,');
    });
});

test.describe('the controls belong to the section, not to one tab', () => {
    for (const tab of ['overview', 'activity', 'content', 'inbox', 'health']) {
        test(`export and refresh are on ${tab}`, async ({ page }) => {
            await openStats(page, tab);
            const foot = page.locator('.config-stats-foot');
            await expect(foot).toHaveCount(1);
            await expect(foot.locator('[data-stats-action="export"]')).toHaveCount(1);
            await expect(foot.locator('[data-stats-action="refresh"]')).toHaveCount(1);
        });
    }

    test('refreshing keeps one foot and re-reads the server tabs', async ({ page }) => {
        await openStats(page, 'health');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._statsHealth !== undefined), { timeout: 15_000 }).toBe(true);

        await page.locator('[data-stats-action="refresh"]').click();
        // Dropped and asked for again rather than repainted from what was held.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._statsHealth !== undefined), { timeout: 15_000 }).toBe(true);
        // The stamp is replaced, not nested: swapping the line for the whole
        // foot put a second pair of buttons inside the first.
        await expect(page.locator('.config-stats-foot')).toHaveCount(1);
        await expect(page.locator('[data-stats-action="export"]')).toHaveCount(1);
    });

    test('the health tab offers a way into the health view', async ({ page }) => {
        await openStats(page, 'health');
        await page.locator('[data-stats-action="open-health-view"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
            { timeout: 15_000 }).toBe('health');
    });
});

test.describe('reading the numbers', () => {
    test('counts are grouped for the locale', async ({ page }) => {
        await openStats(page);
        const formatted = await page.evaluate(() =>
            window.dashboardInstance.config.statsNumber(1274));
        // Whatever the locale's separator is, four digits do not run together.
        expect(formatted).not.toBe('1274');
        expect(formatted).toMatch(/1\D?274/);
    });

    test('an unused library says so instead of drawing an empty chart', async ({ page }) => {
        await openStats(page, 'activity');
        const state = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const s = c.computeStats();
            return {
                everOpened: Number(s.activity.totalOpens) > 0,
                body: document.getElementById('config-stats-body').innerText,
                bars: document.querySelectorAll('.config-chart-bar').length,
            };
        });
        test.skip(state.everOpened, 'this install has opens, so the chart is the right answer');
        expect(state.bars).toBe(0);
        expect(state.body).toMatch(/nothing to plot/i);
    });
});
