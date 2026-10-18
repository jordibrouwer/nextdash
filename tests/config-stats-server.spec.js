// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Statistics → Server, and the panels it brought to the other tabs: the
 * server lines in Overview's attention list, Notifications on Health and
 * Widgets on Collection. The server's answers are stubbed, because the test
 * machine has no Docker or Unraid to read; everything else goes through the
 * tabs a reader clicks.
 */

const DAY = 86400000;

async function stubServer(page, { backupAgeDays = 1 } = {}) {
    const now = Date.now();
    const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/docker/status', (r) => r.fulfill(json({ socket: true, control: false, reason: '' })));
    await page.route('**/api/docker/containers', (r) => r.fulfill(json({
        available: true,
        usageEnabled: true,
        containers: [
            { id: 'a', name: 'jellyfin', state: 'running', health: 'healthy', usage: { cpu: 12, mem: 1.5 * 1024 ** 3 } },
            { id: 'b', name: 'komga', state: 'running', health: 'unhealthy', update: { status: 'available' } },
            { id: 'c', name: 'radarr', state: 'exited', health: '' },
        ],
    })));
    await page.route('**/api/docker/history', (r) => r.fulfill(json({
        days: 30,
        events: [
            { container: 'komga', at: now - DAY, kind: 'crash' },
            { container: 'komga', at: now - 2 * DAY, kind: 'restart-loop', count: 4 },
            { container: 'jellyfin', at: now - 3 * DAY, kind: 'start' },
        ],
        updates: [{ at: now - 5 * DAY, kind: 'update', container: 'jellyfin', fromVersion: '10.9', toVersion: '10.10' }],
        disk: { images: 24 * 1024 ** 3, volumes: 11 * 1024 ** 3, buildCache: 3 * 1024 ** 3, containersStopped: 0, reclaimable: 4 * 1024 ** 3 },
        diskAt: now - 3600000,
    })));
    await page.route('**/api/unraid/area/overview', (r) => r.fulfill(json({
        area: 'overview',
        status: 'ok',
        data: {
            info: { name: 'tower' },
            array: {
                usedPct: 71, freeBytes: 8 * 1024 ** 4, diskCount: 2,
                disks: [
                    { name: 'disk1', usedPct: 60, tempC: 36, errors: 0, tone: 'good' },
                    { name: 'disk2', usedPct: 96, tempC: 41, errors: 0, tone: 'warn', problem: 'full' },
                ],
            },
            parity: { running: false, last: { date: new Date(now - 12 * DAY).toISOString(), errors: 0, durationSec: 3600, speed: '140 MB/s' }, history: [] },
            vms: [{ name: 'win', state: 'running' }, { name: 'ha', state: 'stopped' }],
            notifications: { alerts: 0, warnings: 2, items: [] },
        },
    })));
    const backupAt = new Date(now - backupAgeDays * DAY).toISOString();
    await page.route('**/api/auto-backups', (r) => r.fulfill(json({
        enabled: true, keep: 7, intervalDays: 3,
        backups: [{ name: 'b1.zip', size: 2048, createdAt: backupAt, bookmarks: 412, pages: 3 }],
    })));
}

async function openStats(page) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => window.DashboardConfigStatsReady === true, null, { timeout: 20_000 });
}

test.describe('statistics: server', () => {
    test('the Server tab reads containers, Unraid and backups', async ({ page }) => {
        await stubServer(page);
        await openStats(page);
        await page.locator('[data-stats-tab="server"]').click();
        const body = page.locator('#config-stats-body');

        const tile = (label) => body.locator('.config-tile').filter({ hasText: label });
        await expect(tile('Containers running')).toContainText('2');
        await expect(tile('Unhealthy')).toContainText('1');
        await expect(tile('Updates waiting')).toContainText('1');
        // A restart loop stands for its cycles: one crash plus four.
        await expect(tile('Crashes, 30 days')).toContainText('5');
        await expect(tile('Array used')).toContainText('71%');

        await expect(body.locator('.config-stats-panel').filter({ hasText: 'Most restless' })).toContainText('komga');
        await expect(body.locator('.config-stats-panel').filter({ hasText: 'Resources now' })).toContainText('jellyfin');
        await expect(body.locator('.config-stats-panel').filter({ hasText: 'Docker disk' })).toContainText('24');
        await expect(body.locator('.config-stats-panel').filter({ hasText: 'Unraid disks' })).toContainText('disk2');
        await expect(body.locator('.config-stats-panel').filter({ hasText: 'VMs running' })).toContainText('1 of 2');
        await expect(body.locator('.config-stats-panel').filter({ hasText: 'Automatic backups' })).toContainText('412 bookmarks');
        await expect(body).not.toContainText(/config\.stats/);
    });

    test('the update button opens Containers on its Updates tab', async ({ page }) => {
        await stubServer(page);
        await openStats(page);
        await page.locator('[data-stats-tab="server"]').click();
        await page.locator('#config-stats-body [data-stats-section-goto="containers:updates"]').first().click();
        await expect(page).toHaveURL(/#config\/containers\/updates/);
    });

    test('Overview lists an unhealthy container, a full disk and a late backup', async ({ page }) => {
        await stubServer(page, { backupAgeDays: 9 });
        await openStats(page);
        await page.locator('[data-stats-tab="overview"]').click();
        const list = page.locator('#config-stats-body .config-stats-attention');
        await expect(list.locator('[data-attention="containers-unhealthy"]')).toContainText('komga');
        await expect(list.locator('[data-attention="containers-updates"]')).toContainText('komga');
        await expect(list.locator('[data-attention="unraid-disk"]')).toContainText('disk2');
        await expect(list.locator('[data-attention="backup-late"]')).toBeVisible();
    });

    test('a fresh backup raises no line', async ({ page }) => {
        await stubServer(page, { backupAgeDays: 1 });
        await openStats(page);
        await page.locator('[data-stats-tab="overview"]').click();
        const list = page.locator('#config-stats-body .config-stats-attention');
        await expect(list.locator('[data-attention="containers-unhealthy"]')).toBeVisible();
        await expect(list.locator('[data-attention="backup-late"]')).toHaveCount(0);
    });

    test('Health lists where notices go', async ({ page }) => {
        await openStats(page);
        await page.locator('[data-stats-tab="health"]').click();
        const notify = page.locator('#config-stats-body .config-stats-panel').filter({ hasText: 'Notifications' });
        await expect(notify).toContainText('Open alerts');
        await expect(notify).toContainText('Push devices');
    });

    test('Collection counts widgets by kind', async ({ page }) => {
        await openStats(page);
        await page.locator('[data-stats-tab="collection"]').click();
        await expect(page.locator('#config-stats-body .config-stats-panel').filter({ hasText: 'Widgets by kind' })).toBeVisible();
    });
});
