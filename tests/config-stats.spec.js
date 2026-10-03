// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/** Seed open counts so the score and the chart have something to show. */
async function openStats(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const DAY = 86400000;
        const now = Date.now();
        window.dashboardInstance.allBookmarks.forEach((b, i) => {
            b.openCount = [12, 30, 5, 0, 8, 2, 19][i % 7];
            b.lastOpened = b.openCount ? now - (i % 25) * DAY : 0;
        });
        window.dashboardInstance.config.openConfigView('stats');
    });
    await expect(page.locator('.config-tiles')).toBeVisible();
}

/**
 * Statistics is split into tabs, so a panel is only in the DOM while its own
 * tab is showing. Each test opens the tab that owns the panel it asserts on.
 */
async function openStatsTab(page, tab) {
    await openStats(page);
    await page.locator(`[data-stats-tab="${tab}"]`).click();
    await expect(page.locator('#config-stats-body .config-panel').first()).toBeVisible();
}

test.describe('config statistics visualisations', () => {
    test('the overview tab shows its headline tiles in an even grid', async ({ page }) => {
        await openStats(page);
        const tiles = page.locator('#config-stats-body .config-tiles--overview .config-tile');
        // Six on every tab since the redesign. The count is pinned so that
        // adding a seventh is a decision rather than an accident.
        await expect(tiles).toHaveCount(6);
        const grid = await page.evaluate(() => {
            const els = [...document.querySelectorAll('#config-stats-body .config-tiles--overview .config-tile')];
            const perRow = {};
            els.forEach((el) => {
                const y = Math.round(el.getBoundingClientRect().y);
                perRow[y] = (perRow[y] || 0) + 1;
            });
            const widths = els.map((el) => Math.round(el.getBoundingClientRect().width));
            return { rows: Object.values(perRow), narrowest: Math.min(...widths) };
        });
        // One even row of six on a wide window, or two even rows of three.
        expect([[6], [3, 3]]).toContainEqual(grid.rows);
        expect(grid.narrowest).toBeGreaterThan(110);
    });

    test('the cleanup score shows a value, a bar and its penalties', async ({ page }) => {
        await openStats(page);
        const val = page.locator('.config-score-value');
        await expect(val).toBeVisible();
        const score = Number((await val.textContent() || '').trim());
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);

        // The bar reflects the score rather than sitting at a fixed width.
        const width = await page.locator('.config-score .config-bar-fill')
            .evaluate((el) => el.style.width);
        expect(width).toBe(`${score}%`);
        await expect(page.locator('.config-stat-details').first()).toBeVisible();
    });

    test('the activity chart draws one bar per bucket, with a text fallback', async ({ page }) => {
        await openStatsTab(page, 'usage');
        // Drawn with uPlot (NdChart): a bar per bucket, a row per bucket in
        // the chart's table, so the same numbers are there without the canvas.
        const chart = page.locator('.config-stats-columns-host .nd-chart').first();
        await expect(chart.locator('canvas')).toBeVisible();
        expect(await chart.locator('table.nd-chart-table tbody tr').count()).toBeGreaterThan(1);
        await expect(chart.locator('table.nd-chart-table caption')).toHaveCount(1);
        const bars = await page.evaluate(() => window.dashboardInstance.config._statsColumnCharts
            .filter((c) => document.contains(c.plot.root)).map((c) => c.plot.data[0].length));
        expect(bars[0]).toBeGreaterThan(1);
    });

    test('changing the range redraws the chart', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const rows = page.locator('.config-stats-columns-host .nd-chart').first().locator('table.nd-chart-table tbody tr');
        await expect(rows.first()).toBeAttached();
        const before = await rows.count();
        await page.locator('[data-stats-range="7"]').click();
        await expect(page.locator('[data-stats-range="7"]')).toHaveClass(/is-active/);
        await expect(rows).toHaveCount(7);
        expect(before).not.toBe(7);
    });

    test('coverage bars report a count and a share of the total', async ({ page }) => {
        await openStatsTab(page, 'collection');
        const coverage = page.locator('.config-panel').filter({
            has: page.locator('.config-panel-title', { hasText: /^Coverage$/ }),
        });
        const rows = coverage.locator('.config-dist-row');
        await expect(rows).toHaveCount(5);
        await expect(rows.first().locator('.config-dist-count')).toContainText('%');
        await expect(rows.first().locator('.config-bar-fill')).toBeVisible();
    });

    test('top lists and distributions render bars per row', async ({ page }) => {
        await openStatsTab(page, 'usage');
        const rows = page.locator('.config-dist-row');
        expect(await rows.count()).toBeGreaterThan(3);
        await expect(rows.first().locator('.config-bar-fill')).toBeVisible();
        await expect(rows.first().locator('.config-dist-count')).toBeVisible();
    });

    test('issues by type counts every problem category', async ({ page }) => {
        await openStatsTab(page, 'health');
        // Rot, duplicates and shortcut clashes folded into one panel, a row
        // per issue type, zeroes included so a clean install says so.
        const panel = page.locator('.config-panel').filter({
            has: page.locator('.config-panel-title', { hasText: /Issues by type/i }),
        });
        await expect(panel).toHaveCount(1);
        await expect(panel.locator('.config-dist-row')).toHaveCount(8);
        await expect(panel).toContainText(/Duplicate URLs/);
        await expect(panel).toContainText(/Shortcut conflicts/);
    });

    test('the CSV export downloads a stats report', async ({ page }) => {
        await openStats(page);
        const dl = page.waitForEvent('download');
        await page.locator('[data-stats-action="export"]').click();
        const file = await dl;
        expect(file.suggestedFilename()).toMatch(/nextdash-stats-.*\.csv/);
    });

    test('link health reads its counts from the health summary', async ({ page }) => {
        await page.route('**/api/bookmark-health', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ summary: { healthyCount: 6, brokenCount: 2, uncheckedCount: 1, monitorDownCount: 1, duplicateCount: 0, staleCount: 3, shortcutConflictCount: 0 } }),
        }));
        await openStatsTab(page, 'health');
        const health = page.locator('#config-stats-health');
        await expect(health.locator('.config-stats-legend')).toContainText('Healthy 6');
        await expect(health.locator('.config-stats-legend')).toContainText('Broken 2');
        // 6 healthy of 10 counted → 60%. The denominator is every state a
        // bookmark can be in, monitorDown and content included: the server
        // splits those out precisely so the three add up, and leaving them out
        // let a collection with monitors down report "Healthy 100%".
        await expect(page.locator('.config-stats-kpis .config-tile-value').first()).toContainText('60%');
    });
});
