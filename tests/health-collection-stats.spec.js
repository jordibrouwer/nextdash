// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The collection layer: how the whole set is doing over time, and what the
 * per-row monitor strips add up to.
 *
 * The report is mocked so these describe the view rather than whatever the
 * seeded bookmarks happen to score.
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

function fleet(overrides = {}) {
    const now = Date.now();
    return {
        monitors: 4,
        uptime24h: { ratio: 0.995, samples: 400 },
        uptime7d: { ratio: 0.981, samples: 2800 },
        uptime30d: { ratio: 0.977, samples: 12000 },
        downNow: 0,
        avgResponseMs: 180,
        worst: [
            { name: 'Flaky service', url: 'https://flaky.test', ratio: 0.86, samples: 700, avgMs: 420 },
        ],
        incidents: [
            { name: 'Flaky service', url: 'https://flaky.test', start: now - 3 * 3600_000, end: now - 3 * 3600_000 + 600_000, durationMs: 600_000, checks: 2, reason: 'HTTP 503' },
            { name: 'Other service', url: 'https://other.test', start: now - 30 * 3600_000, end: now - 30 * 3600_000 + 120_000, durationMs: 120_000, checks: 1 },
        ],
        totalIncidents: 2,
        slower: [
            { name: 'Slowing service', url: 'https://slow.test', recentMs: 480, baselineMs: 120, changePct: 300 },
        ],
        ...overrides,
    };
}

function report({ trendPoints = trend(30, 60, 82), fleetStats = fleet() } = {}) {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 4, healthyCount: 4, brokenCount: 0, duplicateCount: 0,
            uncheckedCount: 0, staleCount: 0, unusedCount: 0, monitoredCount: 4,
        },
        issues: [1, 2, 3, 4].map((n) => ({
            pageId: 1, index: n - 1, pageName: 'dev', name: `Monitored ${n}`,
            url: `https://mon${n}.test`, category: 'tools',
            status: 'healthy', flags: ['healthy'], score: 100, duplicateCount: 0,
            lastChecked: Date.now(), reasons: [], reasonDetails: [],
            monitor: true, checkStatus: false,
        })),
        duplicateGroups: [],
        trend: trendPoints,
        fleet: fleetStats,
    };
}

async function open(page, body = report(), filter = 'monitored') {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`/?hv_filter=${filter}#health`);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

test.describe('collection health trend', () => {
    test('the header charts the trend and names the change', async ({ page }) => {
        await open(page);

        await expect(page.locator('.health-view-trend-chart')).toBeVisible();
        const delta = page.locator('.health-view-trend-delta');
        await expect(delta).toHaveClass(/is-up/);
        // 60% → 82% across the window.
        await expect(delta).toHaveAttribute('aria-label', /up 22 points over 30 days/i);
    });

    test('a falling collection is marked as down, not up', async ({ page }) => {
        await open(page, report({ trendPoints: trend(14, 90, 70) }));

        const delta = page.locator('.health-view-trend-delta');
        await expect(delta).toHaveClass(/is-down/);
        await expect(delta).toHaveAttribute('aria-label', /down 20 points over 14 days/i);
    });

    test('a single recorded day shows no trend at all', async ({ page }) => {
        // One point is a reading, not a trend — there is nothing to compare to.
        await open(page, report({ trendPoints: trend(1, 80, 80) }));

        await expect(page.locator('.health-view-trend-delta')).toHaveCount(0);
        await expect(page.locator('.health-view-trend-chart')).toHaveCount(0);
    });

    test('a report with no recorded history renders the header without a chart', async ({ page }) => {
        await open(page, report({ trendPoints: [] }));

        await expect(page.locator('.health-view-header')).toBeVisible();
        await expect(page.locator('.health-view-trend')).toHaveCount(0);
    });
});

test.describe('collection-wide monitoring', () => {
    test('the fleet panel summarises every monitor', async ({ page }) => {
        await open(page);

        const panel = page.locator('.health-fleet');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.health-fleet-headline')).toHaveText(/All 4 responding/i);
        await expect(panel.locator('.health-fleet-avg')).toHaveText(/180ms/);
        // The three pooled uptime windows.
        await expect(panel.locator('.health-monitor-stat')).toHaveCount(3);
    });

    test('a live outage is called out rather than folded into the average', async ({ page }) => {
        await open(page, report({
            fleetStats: fleet({
                downNow: 1,
                worst: [{ name: 'Down service', url: 'https://down.test', ratio: 0.5, samples: 100, down: true }],
            }),
        }));

        const headline = page.locator('.health-fleet-headline');
        await expect(headline).toHaveClass(/is-down/);
        await expect(headline).toHaveText(/1 of 4 not responding/i);
        await expect(page.locator('.health-fleet-row.is-down').first()).toContainText('Down service');
    });

    test('the worst monitors, slowdowns and outages are each listed', async ({ page }) => {
        await open(page);
        const panel = page.locator('.health-fleet');

        await expect(panel).toContainText('Flaky service');
        await expect(panel).toContainText(/86%/);

        // The slowdown reports both sides, so the number can be judged.
        await expect(panel).toContainText('Slowing service');
        await expect(panel).toContainText('+300%');
        await expect(panel).toContainText(/480ms vs 120ms/);

        await expect(panel).toContainText('HTTP 503');
        await expect(panel.locator('.health-fleet-list--incidents .health-fleet-row')).toHaveCount(2);
    });

    test('a capped outage list says how many there really were', async ({ page }) => {
        await open(page, report({ fleetStats: fleet({ totalIncidents: 40 }) }));

        // Otherwise two rows would read as the month's complete tally.
        await expect(page.locator('.health-fleet-more')).toHaveText(/2.*40/);
    });

    test('the panel stays off filters that are about fixing bookmarks', async ({ page }) => {
        await open(page, report(), 'healthy');

        // Same report, different filter: the work list must not be pushed down by
        // a panel about uptime.
        await expect(page.locator('.health-view-item').first()).toBeVisible();
        await expect(page.locator('.health-fleet')).toHaveCount(0);
    });

    test('an install with nothing monitored gets no panel', async ({ page }) => {
        // The server omits `fleet` entirely when nothing is monitored, which
        // arrives as absent rather than as an empty object.
        const body = report();
        delete body.fleet;
        await open(page, body);

        await expect(page.locator('.health-fleet')).toHaveCount(0);
    });

    test('a fleet that reports no monitors gets no panel either', async ({ page }) => {
        await open(page, report({ fleetStats: { monitors: 0 } }));

        await expect(page.locator('.health-fleet')).toHaveCount(0);
    });
});
