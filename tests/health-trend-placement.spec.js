const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The trend chart is not on the health view itself.
 *
 * It began at the end of the toolbar's button row, where it got whatever
 * sliver the buttons left over. It then moved into the filter-note row. It now
 * lives behind a tile — renderTrendTile draws the last reading and a sparkline,
 * and clicking it opens the full chart in a modal (showTrendChart). The reason
 * is in the code: a chart wide enough to read a trend off cost a row of its own
 * on a view whose job is the list underneath it.
 *
 * What survived the move is everything about the chart itself — the fixed
 * axis, the gap handling, the hover readout, the explainer behind the ℹ — so
 * that is what these tests assert, now against the modal.
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

/**
 * Open the tile's modal and wait for the full chart inside it.
 *
 * The tile specifically: the delta button in a row carries the same
 * data-health-trend-open attribute, so the bare attribute matches twice.
 */
async function openTrendModal(page) {
    await page.locator('.health-view-tile--trend').click();
    await page.waitForSelector('.health-trend-modal .health-view-trend', { timeout: 10_000 });
}

test.describe('health trend placement', () => {
    test('the chart is behind a tile, not taking a row of the view', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

        // The tile carries the current reading and a sparkline, and nothing on
        // the view itself is the full chart.
        const tile = page.locator('.health-view-tile--trend');
        await expect(tile).toBeVisible();
        await expect(tile.locator('.health-view-tile-spark')).toHaveCount(1);
        await expect(page.locator('.health-view-trend')).toHaveCount(0);
        // The two homes it has had, so an implementation that put it back would
        // not quietly pass.
        await expect(page.locator('.health-view-note-row .health-view-trend')).toHaveCount(0);
        await expect(page.locator('.health-view-toolbar-actions .health-view-trend')).toHaveCount(0);

        await openTrendModal(page);
        await expect(page.locator('.health-trend-modal .health-view-trend')).toBeVisible();
    });

    test('it gets the width of the modal, not a sliver', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendModal(page);

        const { body, trend } = await page.evaluate(() => {
            const w = (sel) => document.querySelector(sel).getBoundingClientRect().width;
            return { body: w('.health-trend-modal-body'), trend: w('.health-view-trend') };
        });
        // The point of moving it: the chart fills what it is given. The old
        // toolbar slot was under a fifth of its row.
        expect(trend / body).toBeGreaterThan(0.9);
        // And what it is given is wide enough to read a fortnight off.
        expect(trend).toBeGreaterThan(400);
    });

    test('the ℹ beside it explains what is plotted', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendModal(page);

        await page.locator('.health-trend-modal [data-health-trend-help]').click();
        const modal = page.locator('.health-trend-explainer-modal');
        await expect(modal).toBeVisible();
        // The three questions the chart raises: what, why fixed, why gaps.
        await expect(modal).toContainText(/counted as healthy/i);
        await expect(modal).toContainText(/0–100%/);
        await expect(modal).toContainText(/gap/i);
    });

    // The axis is fixed rather than fitted to the data, so a dip reads as a
    // dip instead of being rescaled away. It names its three gridlines, and
    // only those: a fourth number would compete with the line itself.
    test('the axis names its fixed gridlines and nothing else', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendModal(page);

        const labels = await page.locator('.health-view-trend-axis').allTextContents();
        expect(labels).toEqual(['100%', '50%', '0%']);
    });

    test('hovering a day reads out its date and value', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendModal(page);

        const zones = page.locator('.health-view-trend-zone');
        await expect(zones).toHaveCount(14);

        const tip = page.locator('.health-view-trend-tip');
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
            const t = document.querySelector('.health-view-trend-tip').getBoundingClientRect();
            const p = document.querySelector('.health-view-trend-plot').getBoundingClientRect();
            return Math.round(t.right) <= Math.round(p.right) + 1;
        });
        expect(fits).toBe(true);

        await page.mouse.move(5, 5);
        await expect(tip).toBeHidden();
    });

    test('narrow screens keep the chart inside the viewport', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 1000 });
        await openHealthWithTrend(page);
        await openTrendModal(page);

        // modalMaxWidth is min(48rem, calc(100vw - 2.5rem)), so on a narrow
        // screen the modal — and the chart in it — must still fit with margin.
        const fits = await page.evaluate(() => {
            const t = document.querySelector('.health-view-trend').getBoundingClientRect();
            return t.left >= 0 && Math.round(t.right) <= window.innerWidth;
        });
        expect(fits).toBe(true);
    });
});
