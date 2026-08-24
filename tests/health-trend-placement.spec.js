const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Where the 90-day trend lives.
 *
 * It began at the end of the toolbar's button row, where it got whatever sliver
 * the buttons left over — too narrow to read a trend off. It then moved into
 * the filter-note row, which on a narrow screen took the full width and pushed
 * the actual work below the fold. Since 3ea26f11 it is a sparkline in the tile
 * row — the space the tiles already occupy — and the full chart opens from that
 * tile, or from the delta in the header, into a dialog.
 *
 * This file asserted the note-row placement long after that move, which is why
 * the whole file was failing rather than telling anyone anything.
 */
async function openHealthWithTrend(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#health');
    await page.waitForSelector('.health-view-toolbar', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The toolbar can be on screen before the view object is assigned, so
    // reading dashboardInstance.health straight after the selector is a race.
    await page.waitForFunction(() => window.dashboardInstance?.health != null,
        null, { timeout: 15_000 });

    // The chart needs three or more recorded days; the report supplies them.
    await page.evaluate(() => {
        const h = window.dashboardInstance.health;
        const days = [];
        const base = Date.now() - 13 * 86400000;
        for (let i = 0; i < 14; i += 1) {
            const t = base + i * 86400000;
            // Two empty days, so a gap in the line is covered too.
            if (i === 7 || i === 8) { days.push({ t, n: 0, h: 0 }); continue; }
            days.push({ t, n: 106, h: 60 + Math.round(Math.sin(i * 0.7) * 18) });
        }
        h.report = { ...(h.report || {}), trend: days };
        h.render();
    });
    await page.waitForSelector('.health-view-tile--trend', { timeout: 10_000 });
}

/** The tile is the way in; the chart itself only exists inside the dialog. */
async function openTrendChart(page) {
    await page.locator('[data-health-trend-open]').first().click();
    await page.waitForSelector('.health-trend-modal .health-view-trend', { timeout: 10_000 });
}

test.describe('health trend placement', () => {
    test('the trend is a tile, not a row of its own', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

        // In the tile row, beside the counts.
        await expect(page.locator('.health-view-tiles .health-view-tile--trend')).toBeVisible();
        await expect(page.locator('.health-view-tile--trend .health-view-tile-spark')).toBeVisible();

        // Neither of its two former homes, both of which cost a row before the
        // list — the point of the move.
        await expect(page.locator('.health-view-note-row .health-view-trend')).toHaveCount(0);
        await expect(page.locator('.health-view-toolbar-actions .health-view-trend')).toHaveCount(0);
    });

    test('the tile opens the full chart', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendChart(page);

        const chart = page.locator('.health-trend-modal .health-view-trend');
        await expect(chart).toBeVisible();
        // Wide enough to read a trend off, which the toolbar sliver never was.
        const share = await page.evaluate(() => {
            const c = document.querySelector('.health-trend-modal .health-view-trend').getBoundingClientRect();
            return c.width / window.innerWidth;
        });
        expect(share).toBeGreaterThan(0.25);
    });

    test('the ℹ beside it explains what is plotted', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendChart(page);

        await page.locator('.health-trend-modal [data-health-trend-help]').click();
        const modal = page.locator('.health-trend-explainer-modal');
        await expect(modal).toBeVisible();
        // The three questions the chart raises: what, why fixed, why gaps.
        await expect(modal).toContainText(/counted as healthy/i);
        await expect(modal).toContainText(/0–100%/);
        await expect(modal).toContainText(/gap/i);
    });

    // The fixed axis is what makes two charts comparable; the labels name it.
    test('the axis names the scale it is drawn against', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendChart(page);

        const labels = await page.locator('.health-trend-modal .health-view-trend-axis').allTextContents();
        expect(labels[0]).toBe('100%');
        expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    });

    test('hovering a day reads out its date and value', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendChart(page);

        const zones = page.locator('.health-trend-modal .health-view-trend-zone');
        await expect(zones).toHaveCount(14);

        const tip = page.locator('.health-trend-modal .health-view-trend-tip');
        await expect(tip).toBeHidden();

        await zones.nth(3).hover();
        await expect(tip).toBeVisible();
        // A date and a percentage, not just one or the other.
        await expect(tip).toHaveText(/\w+ \d+ · \d+%/);

        // A day with no reading says so rather than showing 0%, which would be
        // a real value and read as a total collapse.
        await zones.nth(7).hover();
        await expect(tip).toContainText(/no reading/i);

        // The last day's readout must not hang off the right edge.
        await zones.nth(13).hover();
        const fits = await page.evaluate(() => {
            const t = document.querySelector('.health-trend-modal .health-view-trend-tip').getBoundingClientRect();
            const p = document.querySelector('.health-trend-modal .health-view-trend-plot').getBoundingClientRect();
            return Math.round(t.right) <= Math.round(p.right) + 1;
        });
        expect(fits).toBe(true);
    });

    // The reason it left the row above the list: on a narrow screen that row
    // took the full width and pushed the work off the screen.
    test('a narrow screen still shows the tiles, not a chart above the list', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 1000 });
        await openHealthWithTrend(page);

        await expect(page.locator('.health-view-tile--trend')).toBeVisible();
        await expect(page.locator('.health-view-note-row .health-view-trend')).toHaveCount(0);
    });
});
