// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The collection's trend, in the Bookmarks view's rail summary (Health's own
 * summary rows, shellSummary): how the whole set is doing over time.
 */

const DAY = 24 * 60 * 60 * 1000;

/** `days` daily points, healthy share rising from `from`% to `to`%. */
function trend(days, from, to) {
    const points = [];
    const midnight = Math.floor(Date.now() / DAY) * DAY;
    for (let i = 0; i < days; i += 1) {
        const share = from + ((to - from) * i) / Math.max(1, days - 1);
        points.push({
            t: midnight - (days - 1 - i) * DAY,
            n: 100,
            h: Math.round(share),
        });
    }
    return points;
}

const open = (page, points) => openBookmarksWithHealth(page, undefined, { report: () => ({ trend: points }) });
const summary = (page) => page.locator('#config-bm-rail .lvs-summary');

test.describe('collection health trend', () => {
    test('the rail summary carries the trend and names the change', async ({ page }) => {
        await open(page, trend(30, 60, 82));
        const trendRow = summary(page).locator('[data-summary-key="trend"]');
        await expect(trendRow).toBeVisible();
        // The row reads as an arrow and a size (trendDeltaText); the verbose
        // sentence (trendDeltaLabel) is what the score row's aria-label says.
        await expect(trendRow.locator('.config-bm-health-summary-value')).toHaveText('▲22');
    });

    test('a falling collection is marked as down, not up', async ({ page }) => {
        await open(page, trend(14, 90, 70));
        await expect(summary(page).locator('[data-summary-key="trend"] .config-bm-health-summary-value')).toHaveText('▼20');
    });

    test('a single recorded day shows no trend at all', async ({ page }) => {
        // One point is a reading, not a trend — there is nothing to compare to.
        await open(page, trend(1, 80, 80));
        await expect(summary(page)).toBeVisible();
        await expect(summary(page).locator('[data-summary-key="trend"]')).toHaveCount(0);
    });
});

test.describe('the fleet in the rail summary', () => {
    const fleet = (uptime24h) => ({
        fleet: {
            monitors: 4,
            uptime24h: uptime24h || { ratio: 0.995, samples: 400 },
            uptime7d: { ratio: 0.981, samples: 2800 },
            uptime30d: { ratio: 0.977, samples: 12000 },
            downNow: 0,
            avgResponseMs: 180,
        },
    });
    const monitored = (issues) => issues.map((issue) => ({ ...issue, monitor: true }));

    test('the rail summary reports the fleet', async ({ page }) => {
        await openBookmarksWithHealth(page, monitored, { report: () => fleet() });
        await expect(summary(page).locator('[data-summary-key="uptime"] .config-bm-health-summary-value')).toHaveText(/%/);
    });

    test('the uptime figure is the real fleet reading, not zero', async ({ page }) => {
        // fleet.uptime24h is a {ratio, samples} window, not a number — Number()
        // on it is NaN, and NaN || 0 is 0, so a naive read always shows "0%".
        await openBookmarksWithHealth(page, monitored, { report: () => fleet({ ratio: 0.987, samples: 120 }) });
        await expect(summary(page).locator('[data-summary-key="uptime"] .config-bm-health-summary-value')).toHaveText('98.7%');
    });

    test('the trend row carries a sparkline when there is enough history', async ({ page }) => {
        await open(page, trend(30, 60, 82));
        const chart = summary(page).locator('[data-summary-key="trend"] .health-view-trend-sparkline');
        await expect(chart).toBeVisible();
        await expect(chart).toHaveAttribute('role', 'img');
    });
});
