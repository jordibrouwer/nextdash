// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The corner card that points to the theme studio (Shift+A).
 *
 * Everyone is asked once. A new install is not greeted on its first day; an
 * upgrade, or an install without the first-run stamp, is asked at the next
 * quiet moment.
 */
const PROMO_ID = 'theme-studio-hint-v1';
const DAY = 24 * 60 * 60 * 1000;

async function load(page, settings = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, settings }) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        Object.assign(window.dashboardInstance.settings, { firstRunInstall: false, firstRunAt: 0 }, settings);
    }, { id: PROMO_ID, settings });
}

const card = (page) => page.locator('.theme-studio-notice-card');
const toast = (page) => page.locator('#app-notification.show');

test.describe('the theme studio hint', () => {
    test('it names the key, has no button and no corner card', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.render())).toBe(true);
        await expect(toast(page)).toBeVisible();
        await expect(toast(page)).toContainText('Shift+A');
        await expect(page.locator('#app-notification')).not.toHaveClass(/has-action/);
        await expect(page.locator('#app-notification .app-notification-action')).toBeHidden();
        await expect(card(page)).toHaveCount(0);
    });

    test('showing the toast counts as answered, so it is not asked again', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(true);
        await page.evaluate(() => window.DashboardThemeStudioNotice.render());
        await expect(toast(page)).toBeVisible();
        await expect(card(page)).toHaveCount(0);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(false);
    });

    test('a new install waits a day, an upgrade does not', async ({ page }) => {
        await load(page, { firstRunInstall: true, firstRunAt: Date.now() });
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(false);
        await page.evaluate((ago) => { window.dashboardInstance.settings.firstRunAt = Date.now() - ago; }, DAY + 60_000);
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(true);
        await page.evaluate(() => { window.dashboardInstance.settings.firstRunInstall = false; window.dashboardInstance.settings.firstRunAt = Date.now(); });
        expect(await page.evaluate(() => window.DashboardThemeStudioNotice.shouldShow())).toBe(true);
    });
});
