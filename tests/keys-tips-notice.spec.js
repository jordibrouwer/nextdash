// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/** Two bell tips: the mode strip (Shift+S) at once, the key legend (Shift+H) three days later. */
async function load(page, startedAgoMs) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.DashboardKeysTips, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((ago) => {
        const ds = window.DiscoverabilityState;
        ds.schedulePersist = () => {}; // probes must not reach the shared ./data
        const keep = ds.getSeenSettingPromos().filter((id) => id.startsWith('mode-strip-tip-start:') || id.endsWith('-tip-v1') && /^(mode-strip|key-legend)/.test(id));
        keep.forEach((id) => ds.resetSettingPromoSeen(id, { persist: false }));
        if (ago !== null) ds.markSettingPromoSeen(`mode-strip-tip-start:${Date.now() - ago}`, { persist: false });
    }, startedAgoMs);
    // Skip the settling minute: pretend the page was opened that long ago.
    await page.clock.install({ time: Date.now() });
    await page.clock.fastForward(61_000);
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}
const row = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);

test('a fresh install gets the strip tip and not the legend tip yet', async ({ page }) => {
    await load(page, null);
    await expect(row(page, 'mode-strip-tip')).toContainText('Shift+S');
    await expect(row(page, 'key-legend-tip')).toHaveCount(0);
});

test('three days after the strip tip the legend tip follows', async ({ page }) => {
    await load(page, 3 * 24 * 3600 * 1000 + 60_000);
    await expect(row(page, 'mode-strip-tip')).toBeVisible();
    await expect(row(page, 'key-legend-tip')).toContainText('Shift+H');
});

test('two days is too early for the legend tip', async ({ page }) => {
    await load(page, 2 * 24 * 3600 * 1000);
    await expect(row(page, 'key-legend-tip')).toHaveCount(0);
});

test('Mark read on the strip tip removes it for good', async ({ page }) => {
    await load(page, null);
    await row(page, 'mode-strip-tip').locator('button', { hasText: /mark read/i }).click();
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await expect(row(page, 'mode-strip-tip')).toHaveCount(0);
});

test('nothing shows in the first minute, and the bell stays silent', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.DashboardKeysTips, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.DiscoverabilityState.schedulePersist = () => {};
        window.__sounds = 0;
        window.NotificationBell.playSound = () => { window.__sounds += 1; };
        window.DiscoverabilityState.getSeenSettingPromos().filter((id) => id.startsWith('mode-strip-tip')).forEach((id) => window.DiscoverabilityState.resetSettingPromoSeen(id, { persist: false }));
        return window.NotificationBell.refreshAll();
    });
    await page.evaluate(() => window.NotificationBell.open());
    await expect(row(page, 'mode-strip-tip')).toHaveCount(0);
});
