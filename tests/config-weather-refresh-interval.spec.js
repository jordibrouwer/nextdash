// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The refresh interval is only read when the timer is armed, so changing it has
 * to re-arm — redrawing the date line leaves the previous setInterval running at
 * the old cadence until a full reload.
 */

test('changing the weather refresh interval re-arms the timer live', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Arm a timer: the date block has to be on for one to exist at all.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showDate = true;
        d.settings.showWeatherWithDate = true;
        d.settings.weatherRefreshMinutes = 30;
        await d.saveSettings?.();
        d.updateDateVisibility();
    });

    const before = await page.evaluate(() => window.dashboardInstance.weatherRefreshTimer);
    expect(before).toBeTruthy();

    // Change it through the config path, not by hand.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.locator('[data-behavior-tab="datetime"]').click();
    const input = page.locator('[data-behavior-field="weatherRefreshMinutes"]');
    await input.scrollIntoViewIfNeeded();
    await input.fill('5');
    await input.blur();

    // A new interval id means clearInterval + setInterval actually ran.
    await expect.poll(() => page.evaluate(() =>
        window.dashboardInstance.weatherRefreshTimer), { timeout: 5000 }).not.toBe(before);
    expect(await page.evaluate(() =>
        window.dashboardInstance.settings.weatherRefreshMinutes)).toBe(5);
});
