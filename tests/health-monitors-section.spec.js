// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    markHealthTutorialSeen } = require('./e2e-helpers');

const DAY = 24 * 60 * 60 * 1000;

/** `days` daily points, healthy share rising from `from`% to `to`% — the same
 *  shape tests/health-collection-stats.spec.js's helper of this name builds. */
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

/**
 * buildFleetStats on the server returns nil until something is both
 * monitored and has pooled samples (see health_fleet.go) — a fresh install
 * (every spec file starts from one, per tests/fixtures.js) has neither. The
 * tests below that need the fleet panel present mock the report the same way
 * tests/health-collection-stats.spec.js does, rather than waiting on real
 * checks to accumulate history.
 */
function fleetReport({ uptime24h, trendPoints = [] } = {}) {
    const now = Date.now();
    return {
        generatedAt: now,
        summary: {
            totalBookmarks: 4, healthyCount: 4, brokenCount: 0, duplicateCount: 0,
            uncheckedCount: 0, staleCount: 0, unusedCount: 0, monitoredCount: 4,
        },
        issues: [1, 2, 3, 4].map((n) => ({
            pageId: 1, index: n - 1, pageName: 'dev', name: `Monitored ${n}`,
            url: `https://mon${n}.test`, category: 'tools',
            status: 'healthy', flags: ['healthy'], score: 100, duplicateCount: 0,
            lastChecked: now, reasons: [], reasonDetails: [],
            monitor: true, checkStatus: false,
        })),
        duplicateGroups: [],
        trend: trendPoints,
        fleet: {
            monitors: 4,
            uptime24h: uptime24h || { ratio: 0.995, samples: 400 },
            uptime7d: { ratio: 0.981, samples: 2800 },
            uptime30d: { ratio: 0.977, samples: 12000 },
            downNow: 0,
            avgResponseMs: 180,
        },
    };
}

async function mockFleetApi(page, overrides = {}) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fleetReport(overrides)) });
    });
}

async function openHealth(page, hash = '#health') {
    await markWhatsNewSeen(page);
    await markHealthTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => window.dashboardInstance?.health != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Not prepareDashboardInteraction(): it calls ensureBookmarksDashboardView,
    // which unconditionally sets dash.activeView = 'bookmarks' — fine for a
    // spec that reads static markup, but every render() in this view is
    // gated on isActiveView(), so a click made afterwards would update
    // dataset flags with nothing on screen ever repainting. Its only other
    // effect (clearing a stale guided-flow lock) is reproduced directly.
    await page.evaluate(() => {
        window.GuidedFlowGuard?.sync?.();
        document.body.classList.remove('guided-flow-locked');
    });
    await page.waitForSelector('#dashboard-layout.health-layout .lvs', { timeout: 15_000 });
}

test('the rail lists Monitors as a section, separate from the filters', async ({ page }) => {
    await openHealth(page);
    const section = page.locator('.lvs-rail .lvs-section[data-lvs-section-key="monitors"]');
    await expect(section).toBeVisible();
    // A section is a destination, not a filter — it must not carry a filter hook.
    await expect(section).not.toHaveAttribute('data-health-filter', /.*/);
});

test('clicking Monitors shows the fleet panel and changes the hash', async ({ page }) => {
    await mockFleetApi(page);
    await openHealth(page);
    await page.locator('.lvs-section[data-lvs-section-key="monitors"]').click();

    await expect(page.locator('.lvs-body .health-fleet')).toHaveCount(1);
    await expect(page.locator('.lvs-body .health-view-feed')).toHaveCount(0);
    await expect(page.locator('.lvs-section[data-lvs-section-key="monitors"]')).toHaveClass(/is-active/);
    expect(new URL(page.url()).hash).toBe('#health/monitors');
});

test('#health/monitors opens the section directly', async ({ page }) => {
    await mockFleetApi(page);
    await openHealth(page, '#health/monitors');
    await expect(page.locator('.lvs-body .health-fleet')).toHaveCount(1);
    await expect(page.locator('.lvs-section[data-lvs-section-key="monitors"]')).toHaveClass(/is-active/);
});

test('picking a filter leaves the section and returns to the list', async ({ page }) => {
    await mockFleetApi(page);
    await openHealth(page, '#health/monitors');
    await page.locator('.lvs-rail [data-health-filter="all"]').click();

    await expect(page.locator('.lvs-body .health-view-feed')).toHaveCount(1);
    await expect(page.locator('.lvs-body .health-fleet')).toHaveCount(0);
    await expect(page.locator('.lvs-section[data-lvs-section-key="monitors"]')).not.toHaveClass(/is-active/);
    expect(new URL(page.url()).hash).toBe('#health');
});

test('the rail summary reports the fleet without opening it', async ({ page }) => {
    await mockFleetApi(page);
    await openHealth(page);
    const uptime = page.locator('.lvs-summary [data-lvs-summary-key="uptime"] .lvs-summary-value');
    await expect(uptime).toHaveText(/%/);
});

test('the rail uptime figure reflects the real fleet reading, not zero', async ({ page }) => {
    // fleet.uptime24h is a {ratio, samples} window, not a number — Number()
    // on it is NaN, and NaN || 0 is 0, so a naive read of this field always
    // shows "0%". 0.987 * 100 rounds to "98.7%", nowhere near zero.
    await mockFleetApi(page, { uptime24h: { ratio: 0.987, samples: 120 } });
    await openHealth(page);
    const uptime = page.locator('.lvs-summary [data-lvs-summary-key="uptime"] .lvs-summary-value');
    await expect(uptime).toHaveText('98.7%');
});

test('the rail summary carries the trend sparkline when there is enough history', async ({ page }) => {
    await mockFleetApi(page, { trendPoints: trend(30, 60, 82) });
    await openHealth(page);
    const chart = page.locator('.lvs-summary [data-lvs-summary-key="trend"] .health-view-trend-sparkline');
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('role', 'img');
});
