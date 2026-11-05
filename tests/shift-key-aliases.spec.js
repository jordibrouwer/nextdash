// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * An old Shift key that still works says what replaced it, once per page load.
 */
test('the alias notice names the new key, once per pair', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    const calls = await page.evaluate(() => {
        const seen = [];
        window.dashboardInstance.showNotification = (message) => { seen.push(String(message)); };
        window.ShiftKeyAliases.notice('Shift + Y', 'Shift + C');
        window.ShiftKeyAliases.notice('Shift + Y', 'Shift + C');
        window.ShiftKeyAliases.notice('Shift + H', 'Shift + B');
        return seen;
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('Shift + Y');
    expect(calls[0]).toContain('Shift + C');
    expect(calls[1]).toContain('Shift + B');
});
