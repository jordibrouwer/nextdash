// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Opens Data & backups → Server log, the way the tab is reached in the app.
 */
async function openServerLogTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async () => {
        const config = window.dashboardInstance.config;
        await config.openConfigView('data-backups');
        const c = config.instance || config;
        c.dbTab = 'logs';
        c.render();
    });
}

test('the detail level is chosen in the app and reaches the server', async ({ page }) => {
    await openServerLogTab(page);

    const level = page.locator('[data-log-select="detail"]');
    await expect(level).toBeVisible({ timeout: 15_000 });

    await level.selectOption('debug');
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).serverLogLevel;
    }), { timeout: 15_000 }).toBe('debug');
});

test('the floor note says what is being kept, apart from the display filter', async ({ page }) => {
    await openServerLogTab(page);

    const note = page.locator('[data-log-floor-note]');
    await expect(note).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-log-select="detail"]').selectOption('warn');
    await expect(note).toContainText(/quiet/i, { timeout: 15_000 });
});

test('an activity channel can be switched on and is remembered', async ({ page }) => {
    await openServerLogTab(page);

    const health = page.locator('[data-activity-channel="health"]');
    await expect(health).toBeVisible({ timeout: 15_000 });
    await expect(health).not.toBeChecked();

    await health.check();
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).activityChannels || [];
    }), { timeout: 15_000 }).toContain('health');
});
