// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Two things the statistics section could not answer.
 *
 * "Is this better than it was?" — every figure was a snapshot, though the
 * server has been recording a point per day for the health report all along.
 * And "which of my pages is the neglected one?" — everything was worked out
 * across the whole library, so a page kept for one purpose could not be looked
 * at on its own.
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
    }
}

/** A health report carrying a trend, served in place of the real one. */
async function routeHealthWithTrend(page, percents) {
    const day = 86400000;
    const base = Date.UTC(2026, 6, 1);
    await page.route('**/api/bookmark-health*', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            summary: {
                healthyCount: 8, brokenCount: 1, uncheckedCount: 1,
                monitorDownCount: 0, duplicateCount: 0, staleCount: 0, shortcutConflictCount: 0,
            },
            // n is the collection size that day and b how many were broken;
            // the panel works the healthy share out from those, because h
            // changed meaning in August 2026 and b did not.
            trend: percents.map((p, i) => (p === null
                ? { t: base + i * day, n: 0, h: 0 }
                : { t: base + i * day, n: 100, h: p, b: 100 - p })),
        }),
    }));
}

test.describe('the health tab shows where the numbers came from', () => {
    test('a recorded series is drawn, and summarised in words', async ({ page }) => {
        await routeHealthWithTrend(page, [60, 64, 70, 72]);
        await openStats(page, 'health');

        // Drawn with uPlot (NdChart): a canvas, a day per row in its table,
        // and the days read out by the keys.
        const chart = page.locator('#config-stats-health .config-stats-healthline-host .nd-chart');
        await expect(chart.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
        await expect(chart.locator('table.nd-chart-table tbody tr')).toHaveCount(4);
        await chart.focus();
        await page.keyboard.press('Home');
        await expect(chart.locator('.nd-chart-readout')).toContainText('60%');
        await page.keyboard.press('End');
        await expect(chart.locator('.nd-chart-readout')).toContainText('72%');

        // The line is for the eye; the sentence is the part that survives being
        // read out, printed, or looked at on a phone.
        const summary = page.locator('.config-stats-trend-summary');
        await expect(summary).toContainText('72%');
        await expect(summary).toContainText(/up 12 points over 4 recorded days/i);
        await expect(summary).toHaveClass(/config-stats-trend-summary--good/);
    });

    test('a fall reads as a fall', async ({ page }) => {
        await routeHealthWithTrend(page, [90, 80, 70]);
        await openStats(page, 'health');
        await expect(page.locator('.config-stats-trend-summary'))
            .toContainText(/down 20 points over 3 recorded days/i, { timeout: 15_000 });
        await expect(page.locator('.config-stats-trend-summary')).toHaveClass(/config-stats-trend-summary--bad/);
    });

    test('days with nothing recorded break the line instead of reading as zero',
        async ({ page }) => {
            await routeHealthWithTrend(page, [80, null, 84]);
            await openStats(page, 'health');
            const chart = page.locator('#config-stats-health .config-stats-healthline-host .nd-chart');
            await expect(chart.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
            // The missing day is a gap, not a zero: it reads as no value, and
            // uPlot leaves a null out of the line rather than joining across it.
            await chart.focus();
            await page.keyboard.press('Home');
            await page.keyboard.press('ArrowRight');
            await expect(chart.locator('.nd-chart-readout')).toContainText('—');
            await expect(chart.locator('.nd-chart-readout')).not.toContainText('0%');
            const gaps = await page.evaluate(() => window.dashboardInstance.config._statsHealthCharts
                .map((c) => c.plot.data[1][1]));
            expect(gaps).toContain(null);
        });

    test('without uPlot the plain line stays', async ({ page }) => {
        await page.route('**/vendor/uplot/**', (route) => route.abort());
        await routeHealthWithTrend(page, [60, 64, 70, 72]);
        await openStats(page, 'health');
        await expect(page.locator('#config-stats-health .config-stats-trend-chart polyline')).toHaveCount(1, { timeout: 15_000 });
        await page.waitForTimeout(500);
        await expect(page.locator('#config-stats-health .nd-chart')).toHaveCount(0);
    });

    test('one day is not a trend, and says what it is waiting for', async ({ page }) => {
        await routeHealthWithTrend(page, [70]);
        await openStats(page, 'health');
        await expect(page.locator('#config-stats-health')).toContainText(/once there are a few/i, { timeout: 15_000 });
        await expect(page.locator('.config-stats-trend-chart')).toHaveCount(0);
    });
});

test.describe('the figures can be narrowed to one page', () => {
    async function withTwoPages(page) {
        await openStats(page);
        return page.evaluate(async () => {
            const d = window.dashboardInstance;
            // A second page, so there is a choice to offer at all.
            if (d.pages.length < 2) {
                d.pages = [...d.pages, { id: 9901, name: 'Probe page' }];
            }
            const first = d.pages[0];
            const other = d.pages[1];
            // One bookmark that belongs to the other page, so the two scopes
            // cannot report the same number by accident.
            d.allBookmarks = [
                ...(d.allBookmarks || []).map((b) => ({ ...b, pageId: first.id })),
                { name: 'Probe', url: 'https://probe.example/x', pageId: other.id, tags: [], openCount: 0 },
            ];
            d.config.render();
            return { first: first.id, other: other.id, total: d.allBookmarks.length };
        });
    }

    test('the scope control appears once there is more than one page', async ({ page }) => {
        const { other } = await withTwoPages(page);
        const select = page.locator('[data-stats-scope]');
        await expect(select).toBeVisible();

        // Driven through the control, not by setting the field: the repaint is
        // half of what is being checked.
        await select.selectOption(String(other));
        await expect(page.locator('.config-tiles--overview .config-tile-value').first()).toHaveText('1');

        await select.selectOption('');
        await expect(page.locator('.config-tiles--overview .config-tile-value').first())
            .not.toHaveText('1', { timeout: 5_000 });
    });

    test('the tabs the filter cannot reach say so', async ({ page }) => {
        const { other } = await withTwoPages(page);
        await page.locator('[data-stats-scope]').selectOption(String(other));

        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.statsTab = 'inbox';
            c.loadStatsTabData('inbox');
            c.repaintStatsBody();
        });
        // The inbox belongs to no page and the health report is built for the
        // whole collection; ignoring the filter silently would read as a bug.
        await expect(page.locator('.config-stats-scope-note')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.config-stats-scope-note')).toContainText('whole library');
    });

    test('the export records what it was scoped to', async ({ page }) => {
        const { other } = await withTwoPages(page);
        await page.locator('[data-stats-scope]').selectOption(String(other));

        const csv = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            let captured = null;
            const real = c.triggerDownload.bind(c);
            c.triggerDownload = (blob) => { captured = blob; };
            await c.exportStatsCSV();
            c.triggerDownload = real;
            return captured.text();
        });
        expect(csv.split('\n')[1]).toMatch(/^scope,/);
        expect(csv).not.toContain('scope,all pages');
    });
});
