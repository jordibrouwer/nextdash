// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

const PROMO_ID = 'random-theme-v2';
const STORAGE_KEY = `nextdash:config-setting-promo-seen-v1:${PROMO_ID}`;

async function openAppearanceFresh(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((key) => {
        localStorage.removeItem(key);
        window.DiscoverabilityState?.resetSettingPromoSeen?.('random-theme-v2', { persist: false });
    }, STORAGE_KEY);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-appearance-select="randomThemeMode"]')).toBeVisible();
}

test.describe('Config setting promo', () => {
    test('shows on Appearance and dismisses once', async ({ page }) => {
        await openAppearanceFresh(page);

        const promo = page.locator('.config-setting-promo');
        await expect(promo).toBeVisible({ timeout: 8000 });
        await expect(promo.locator('.config-setting-promo-title')).toContainText(/random theme|willekeurig|zufällig|aléatoire/i);
        await expect(page.locator('[data-config-setting-promo-anchor="randomThemeMode"]')).toHaveClass(/config-setting-promo-anchor-highlight/);

        await promo.locator('.config-setting-promo-dismiss').click();
        await expect(promo).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.config.selectSection('behavior'));
        await page.evaluate(() => window.dashboardInstance.config.selectSection('appearance'));
        await expect(page.locator('.config-setting-promo')).toHaveCount(0, { timeout: 3000 });
    });

    test('Escape dismisses the promo without closing config', async ({ page }) => {
        await openAppearanceFresh(page);
        const promo = page.locator('.config-setting-promo');
        await expect(promo).toBeVisible({ timeout: 8000 });

        await page.keyboard.press('Escape');
        await expect(promo).toHaveCount(0);
        await expect(page.locator('.config-view')).toBeVisible();
    });
});
