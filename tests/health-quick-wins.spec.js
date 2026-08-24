// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Four small additions to the health view: the monitor interval changeable from
 * the row, monitoring columns in the CSV, the sample count behind an uptime
 * percentage, and the report's age in the header.
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

function report({ generatedAt = Date.now(), interval = 15 } = {}) {
    return {
        generatedAt,
        summary: {
            totalBookmarks: 2, healthyCount: 2, brokenCount: 0, duplicateCount: 0,
            uncheckedCount: 0, staleCount: 0, unusedCount: 0, monitoredCount: 1,
        },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: 'Monitored one',
                url: 'https://example.com/mon', category: 'tools',
                status: 'healthy', flags: ['healthy'], score: 100, duplicateCount: 0,
                lastChecked: Date.now(), reasons: [], reasonDetails: [],
                monitor: true, checkStatus: false,
                monitorIntervalMinutes: interval,
                monitorStats: monitorStats(interval),
            },
            {
                pageId: 1, index: 1, pageName: 'dev', name: 'Plain one',
                url: 'https://example.com/plain', category: 'tools',
                status: 'healthy', flags: ['healthy'], score: 100, duplicateCount: 0,
                lastChecked: Date.now(), reasons: [], reasonDetails: [],
            },
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page, body = report()) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    // "healthy" rather than the default "broken": this fixture is deliberately
    // all-healthy, since it is about monitoring rather than scoring.
    await page.goto('/?hv_filter=healthy#health');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

test.describe('health view quick wins', () => {
    test('the interval picker writes the chosen cadence and keeps the mode', async ({ page }) => {
        await openHealthView(page);

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

        const row = page.locator('.health-view-item').first();
        await row.locator('.health-check-mode').click();

        // The picker is only offered on a row that is already monitoring.
        const picker = row.locator('.health-check-interval');
        await expect(picker).toBeVisible();
        await expect(picker.locator('.health-check-interval-btn.is-active')).toHaveText('15m');

        await picker.locator('[data-check-interval="60"]').click();

        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0].monitorIntervalMinutes).toBe(60);
        // The mode travels with it: this is a cadence change, not a re-enable, and
        // sending a different mode here would flip the row off monitoring.
        expect(writes[0].mode).toBe('monitor');
        expect(writes[0].url).toBe('https://example.com/mon');
    });

    test('choosing the current interval closes the menu without writing', async ({ page }) => {
        await openHealthView(page);

        /** @type {any[]} */
        const writes = [];
        await page.route('**/api/health/check-mode', async (route) => {
            writes.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });

        const row = page.locator('.health-view-item').first();
        await row.locator('.health-check-mode').click();
        await row.locator('[data-check-interval="15"]').click();

        await expect(row.locator('.health-check-menu')).toBeHidden();
        expect(writes).toHaveLength(0);
    });

    test('the interval picker is hidden on a row that is not monitored', async ({ page }) => {
        await openHealthView(page);

        // The second row has no monitoring, so there is no cadence to change.
        const row = page.locator('.health-view-item').nth(1);
        await row.locator('.health-check-mode').click();
        await expect(row.locator('.health-check-menu')).toBeVisible();
        await expect(row.locator('.health-check-interval')).toHaveCount(0);
    });

    test('the row shows how many checks the uptime rests on', async ({ page }) => {
        await openHealthView(page);

        const uptime = page.locator('.health-view-item').first().locator('.health-monitor-uptime');
        await expect(uptime).toContainText('100%');
        await expect(uptime.locator('.health-monitor-uptime-samples')).toHaveText('/96');
        // The accessible name carries the same fact as a sentence, so the bare
        // "/96" is not all a screen reader gets.
        await expect(uptime).toHaveAttribute('aria-label', /96 checks/);
    });

    test('the header says how old the report is', async ({ page }) => {
        await openHealthView(page, report({ generatedAt: Date.now() - 25 * 60 * 1000 }));

        const age = page.locator('.health-view-report-age');
        await expect(age).toBeVisible();
        await expect(age).toHaveText(/25m/);
    });

    test('a report generated moments ago reads "just now", not 0m', async ({ page }) => {
        await openHealthView(page, report({ generatedAt: Date.now() - 5000 }));

        await expect(page.locator('.health-view-report-age')).toHaveText(/just now/i);
    });

    test('the CSV export carries the monitoring columns', async ({ page }) => {
        await openHealthView(page);

        // Capture the download rather than writing to disk.
        const csv = await page.evaluate(() => new Promise((resolve) => {
            const health = window.dashboardInstance.healthView || window.dashboardInstance.health;
            const original = health.downloadFile.bind(health);
            health.downloadFile = (name, content) => {
                health.downloadFile = original;
                resolve(content);
            };
            health.exportFilteredCsv();
        }));

        const [header, monitored, plain] = String(csv).split('\r\n');
        expect(header).toContain('Monitor interval (min)');
        expect(header).toContain('Uptime 24h');
        expect(header).toContain('Checks recorded');

        // The monitored row carries real numbers; uptime is a bare number so a
        // spreadsheet can average the column.
        expect(monitored).toContain('15');
        expect(monitored).toContain('100');
        expect(monitored).toContain('142');

        // The unmonitored row leaves them blank rather than writing zeroes, which
        // would read as 0% uptime. Every field is quoted, so blank is `""`.
        const cells = plain.split(',');
        expect(cells.slice(-6)).toEqual(['""', '""', '""', '""', '""', '""']);
    });

    test('an export with no monitored rows keeps the original columns', async ({ page }) => {
        const plainOnly = report();
        plainOnly.issues = plainOnly.issues.filter((i) => !i.monitor);
        await openHealthView(page, plainOnly);

        const csv = await page.evaluate(() => new Promise((resolve) => {
            const health = window.dashboardInstance.healthView || window.dashboardInstance.health;
            const original = health.downloadFile.bind(health);
            health.downloadFile = (name, content) => {
                health.downloadFile = original;
                resolve(content);
            };
            health.exportFilteredCsv();
        }));

        const header = String(csv).split('\r\n')[0];
        expect(header).not.toContain('Uptime 24h');
        expect(header).toContain('Issues');
    });
});
