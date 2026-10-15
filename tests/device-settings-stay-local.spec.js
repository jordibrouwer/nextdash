// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * "Keep settings on this device only" kept them on the server as well.
 *
 * Every save posted the whole merged copy, this device's own choices included,
 * so a theme or a toggle set on the phone turned up in every other browser.
 * Only the keys that stay server-wide may reach /api/settings in that mode.
 */

const serverSettings = (page) => page.evaluate(async () => (await (await fetch('/api/settings')).json()));

test('device-only changes stay off the server, server-wide ones still reach it', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/#config/behavior');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.locator('[data-behavior-tab="privacy"]').click();

    const before = await serverSettings(page);
    const tips = Boolean(before.enableSessionTips);
    const updates = Boolean(before.updateCheckEnabled);
    try {
        await page.locator('[data-behavior-field="deviceSpecificSettings"]').setChecked(true);

        await page.locator('[data-behavior-field="enableSessionTips"]').setChecked(!tips);
        // The device copy is written once the server has answered the save.
        await expect.poll(() => page.evaluate(() =>
            JSON.parse(localStorage.getItem('dashboardSettings') || '{}').enableSessionTips), { timeout: 10_000 }).toBe(!tips);
        expect((await serverSettings(page)).enableSessionTips, 'a device-only toggle reached the server').toBe(tips);

        await page.locator('[data-behavior-field="updateCheckEnabled"]').setChecked(!updates);
        await expect.poll(async () => (await serverSettings(page)).updateCheckEnabled, { timeout: 10_000 }).toBe(!updates);
        expect((await serverSettings(page)).enableSessionTips, 'a server-wide save carried the device toggle along').toBe(tips);
    } finally {
        await page.evaluate(async ({ tips, updates }) => {
            localStorage.removeItem('deviceSpecificSettings');
            localStorage.removeItem('dashboardSettings');
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enableSessionTips: tips, updateCheckEnabled: updates }),
            });
        }, { tips, updates });
    }
});
