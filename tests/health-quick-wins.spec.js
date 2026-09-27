// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Small things Health adds to the Bookmarks view: the monitor interval
 * changeable from the side panel, the sample count behind an uptime
 * percentage, and the report's age in the rail's summary.
 */

function monitorStats(intervalMinutes = 15) {
    const now = Date.now();
    const heartbeat = [];
    for (let i = 0; i < 40; i += 1) {
        const from = now - (40 - i) * intervalMinutes * 60 * 1000;
        heartbeat.push({
            state: 'up',
            from,
            to: from + intervalMinutes * 60 * 1000,
            up: 1,
            down: 0,
            avgMs: 120 + (i % 7) * 15,
        });
    }
    return {
        intervalMinutes,
        uptime24h: { ratio: 1, samples: 96 },
        uptime7d: { ratio: 0.978, samples: 672 },
        uptime30d: { ratio: 0.981, samples: 2880 },
        heartbeat,
        incidents: [],
        lastSample: now,
        lastPingMs: 142,
        totalChecks: 2880,
    };
}

/** The first bookmark monitored every `interval` minutes, the second plain. */
function shape({ interval = 15 } = {}) {
    return (issues) => issues.slice(0, 2).map((issue, i) => ({
        ...issue,
        status: 'healthy', flags: ['healthy'], score: 100, reasons: [], reasonDetails: [],
        ...(i === 0 ? { monitor: true, checkStatus: false, monitorIntervalMinutes: interval, monitorStats: monitorStats(interval) } : {}),
    }));
}

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');

/** One section of a bookmark's Health tab, opened. */
async function openSection(page, bookmark, name) {
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmark.name }) }).first().click();
    await drawer(page).locator('[data-bm-tab-panel="health"]').click();
    const section = drawer(page).locator(`[data-bm-pane="health"] [data-bm-acc="${name}"]`);
    if (await section.getAttribute('open') === null) await section.locator('summary').click();
    return section;
}

const age = (page) => page.locator('#config-bm-rail .lvs-summary [data-summary-key="age"] .config-bm-health-summary-value');

test.describe('health quick wins', () => {
    test('the interval picker writes the chosen cadence and keeps the mode', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, shape());

        /** @type {any[]} */
        const writes = [];
        await page.route('**/api/health/check-mode', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            writes.push(body);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ mode: 'monitor', monitorIntervalMinutes: body.monitorIntervalMinutes }),
            });
        });

        const section = await openSection(page, bookmarks[0], 'checking');
        const picker = section.locator('.health-check-interval');
        await expect(picker).toBeVisible();
        await expect(picker.locator('.health-check-interval-btn.is-active')).toHaveText('15m');

        await picker.locator('[data-check-interval="60"]').click();

        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0].monitorIntervalMinutes).toBe(60);
        // The mode travels with it: a cadence change, not a re-enable.
        expect(writes[0].mode).toBe('monitor');
        expect(writes[0].url).toBe(bookmarks[0].url);
    });

    test('choosing the current interval writes nothing', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, shape());
        /** @type {any[]} */
        const writes = [];
        await page.route('**/api/health/check-mode', async (route) => {
            writes.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        const section = await openSection(page, bookmarks[0], 'checking');
        await section.locator('[data-check-interval="15"]').click();
        await page.waitForTimeout(300);
        expect(writes).toHaveLength(0);
    });

    test('the interval picker is hidden on a bookmark that is not monitored', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, shape());
        const section = await openSection(page, bookmarks[1], 'checking');
        await expect(section.locator('[data-check-mode]')).toHaveCount(3);
        await expect(section.locator('.health-check-interval')).toHaveCount(0);
    });

    test('the panel shows how many checks the uptime rests on', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page, shape());
        await openSection(page, bookmarks[0], 'monitor');
        const uptime = drawer(page).locator('.health-monitor-strip .health-monitor-uptime').first();
        await expect(uptime).toContainText('100%');
        await expect(uptime.locator('.health-monitor-uptime-samples')).toHaveText('/96');
        // The accessible name carries the same fact as a sentence.
        await expect(uptime).toHaveAttribute('aria-label', /96 checks/);
    });

    test('the summary says how old the report is', async ({ page }) => {
        await openBookmarksWithHealth(page, shape(), { report: () => ({ generatedAt: Date.now() - 25 * 60 * 1000 }) });
        await expect(age(page)).toHaveText(/25m/);
    });

    test('a report generated moments ago reads "just now", not 0m', async ({ page }) => {
        await openBookmarksWithHealth(page, shape(), { report: () => ({ generatedAt: Date.now() - 5000 }) });
        await expect(age(page)).toHaveText(/just now/i);
    });
});
