const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The trend chart used to sit at the end of the toolbar's button row, where it
 * got whatever sliver the buttons left over — too narrow to read a trend off.
 * It now shares a row with the filter note, filling the whitespace the note
 * leaves to its right.
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
    await page.waitForSelector('.health-view-trend', { timeout: 10_000 });
}

test.describe('health trend placement', () => {
    test('the chart sits in the note row, not the button row', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

        await expect(page.locator('.health-view-note-row .health-view-trend')).toBeVisible();
        // The old home: an implementation that left it there would still pass a
        // bare visibility check, so this asserts the move itself.
        await expect(page.locator('.health-view-toolbar-actions .health-view-trend')).toHaveCount(0);
    });

    test('it takes the width the note leaves, not a sliver', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

        const { row, trend } = await page.evaluate(() => {
            const w = (sel) => document.querySelector(sel).getBoundingClientRect().width;
            return { row: w('.health-view-note-row'), trend: w('.health-view-trend') };
        });
        // Roughly the right-hand half. The old toolbar slot was under a fifth.
        expect(trend / row).toBeGreaterThan(0.35);
        expect(trend / row).toBeLessThanOrEqual(0.55);
    });

    test('the ℹ beside it explains what is plotted', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

        await page.locator('[data-health-trend-help]').click();
        const modal = page.locator('.health-trend-explainer-modal');
        await expect(modal).toBeVisible();
        // The three questions the chart raises: what, why fixed, why gaps.
        await expect(modal).toContainText(/counted as healthy/i);
        await expect(modal).toContainText(/0–100%/);
        await expect(modal).toContainText(/gap/i);
    });

    // Only the ceiling is named: it is the one value that makes the fixed axis
    // legible, and a second number competed with the line itself.
    test('the axis names the ceiling and nothing else', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

        const labels = await page.locator('.health-view-trend-axis').allTextContents();
        expect(labels).toEqual(['100%']);
    });

    test('hovering a day reads out its date and value', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await openHealthWithTrend(page);

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

    test('narrow screens stack the two instead of squeezing', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 1000 });
        await openHealthWithTrend(page);

        const dir = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.health-view-note-row')).flexDirection);
        expect(dir).toBe('column');
    });
});
