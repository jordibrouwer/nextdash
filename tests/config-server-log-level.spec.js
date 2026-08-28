// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Puts the log settings back to their defaults before a test reads them.
 *
 * Settings live on the server and survive a reload, so a test that switched a
 * channel on would otherwise decide what the next one starts from. Each test
 * states its own precondition instead of depending on the order they run in.
 */
async function resetLogSettings(page) {
    await page.evaluate(async () => {
        // Through nextDashFetch, which is what the app writes with: a bare
        // fetch misses the write token and comes back 401, leaving the previous
        // test's channels in place.
        await window.nextDashFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverLogLevel: '', activityChannels: ['mutate', 'status'] }),
        });
        // The panel renders from the in-memory copy, which a write to the
        // server does not refresh — a previous test's channels would otherwise
        // still be what this one draws.
        const settings = window.dashboardInstance.settings;
        if (settings) {
            settings.serverLogLevel = '';
            settings.activityChannels = ['mutate', 'status'];
        }
    });
}

/**
 * Opens Data & backups → Server log, the way the tab is reached in the app.
 */
async function openServerLogTab(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await resetLogSettings(page);
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

test('the detail level says what the container log is doing, as it changes', async ({ page }) => {
    await openServerLogTab(page);

    const live = page.locator('[data-log-detail-live]');
    await expect(live).toBeVisible({ timeout: 15_000 });
    await expect(live).toContainText(/docker logs/i);

    // The line follows the select immediately — that the change needs no
    // restart is the thing this control is easy to be wrong about.
    await page.locator('[data-log-select="detail"]').selectOption('debug');
    await expect(live).toContainText(/every step|elke stap/i, { timeout: 15_000 });

    await page.locator('[data-log-select="detail"]').selectOption('warn');
    await expect(live).toContainText(/problems only|alleen problemen/i, { timeout: 15_000 });
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

test('the activity trail can be put back to its defaults', async ({ page }) => {
    await openServerLogTab(page);

    // Nothing to reset while the list is untouched, matching the ↺ elsewhere
    // in config: it appears only when a value differs from the default.
    const reset = page.locator('[data-activity-reset]');
    await expect(page.locator('[data-activity-channel="mutate"]')).toBeVisible({ timeout: 15_000 });
    await expect(reset).toBeHidden();

    // Move away from the defaults in both directions at once: one channel on
    // that is off by default, one off that is on.
    await page.locator('[data-activity-channel="health"]').check();
    await page.locator('[data-activity-channel="mutate"]').uncheck();
    await expect(reset).toBeVisible({ timeout: 15_000 });

    await reset.click();

    await expect(page.locator('[data-activity-channel="mutate"]')).toBeChecked({ timeout: 15_000 });
    await expect(page.locator('[data-activity-channel="status"]')).toBeChecked();
    await expect(page.locator('[data-activity-channel="health"]')).not.toBeChecked();
    await expect(reset).toBeHidden();

    // And the server was told, not just the screen.
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/settings');
        return (await res.json()).activityChannels || [];
    }), { timeout: 15_000 }).toEqual(['mutate', 'status']);
});
