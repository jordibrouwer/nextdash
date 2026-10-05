// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The daily install count is on by default, so it is announced once in the
 * corner: what leaves the server, and how to stop it. The card is not a
 * question, and it is not shown to anyone it would be pointless for.
 */

const PROMO_ID = 'install-count-v1';

async function loadWithCardPending(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((id) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        window.dashboardInstance.settings.installPingEnabled = true;
        window.dashboardInstance.telemetryLockedOff = false;
        document.querySelectorAll('.quickstart-card:not(.install-count-notice-card)').forEach((el) => el.remove());
    }, PROMO_ID);
}

test.describe('the install count notice', () => {
    test('shows what is sent, in words and not as locale keys', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardInstallCountNotice.render());
        const card = page.locator('.install-count-notice-card');
        await expect(card).toBeVisible();
        await expect(card).toContainText('random id');
        await expect(card).not.toContainText('dashboard.installCountNotice');
    });

    test('"Fine by me" keeps the count on and does not come back', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardInstallCountNotice.render());
        await page.locator('[data-install-count-action="keep"]').click();
        await expect(page.locator('.install-count-notice-card')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.installPingEnabled)).toBe(true);
        expect(await page.evaluate(() => window.DashboardInstallCountNotice.shouldShow())).toBe(false);
    });

    test('"Turn it off" switches the setting off', async ({ page }) => {
        await loadWithCardPending(page);
        await page.evaluate(() => window.DashboardInstallCountNotice.render());
        await page.locator('[data-install-count-action="off"]').click();
        await expect(page.locator('.install-count-notice-card')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.installPingEnabled)).toBe(false);
        // Put it back: this spec shares a data directory with the others.
        await page.evaluate(async () => {
            window.dashboardInstance.settings.installPingEnabled = true;
            await window.dashboardInstance.saveSettings();
        });
    });

    test('is not shown when the count is already off or locked off by the operator', async ({ page }) => {
        await loadWithCardPending(page);
        const off = await page.evaluate(() => {
            window.dashboardInstance.settings.installPingEnabled = false;
            return window.DashboardInstallCountNotice.shouldShow();
        });
        expect(off).toBe(false);
        const locked = await page.evaluate(() => {
            window.dashboardInstance.settings.installPingEnabled = true;
            window.dashboardInstance.telemetryLockedOff = true;
            return window.DashboardInstallCountNotice.shouldShow();
        });
        expect(locked).toBe(false);
    });
});
