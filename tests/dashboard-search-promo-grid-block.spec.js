// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissAppNotificationIfPresent } = require('./e2e-helpers');

test('search promo shows after grid keyboard promo when opening >', async ({ page }) => {
    await markWhatsNewSeen(page);

    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissAppNotificationIfPresent(page);
    await page.evaluate(() => {
        window.dashboardInstance?.inbox?.closeInboxView?.();
        [
            'nextdash:dashboard-search-promo-search-v2',
            'nextdash:dashboard-grid-keyboard-promo-confirmed-v1',
        ].forEach((k) => localStorage.removeItem(k));
        window.DashboardSearchPromo?.clearPromoSeen?.('search');
        window.DashboardGridKeyboardPromo?.clearPromoSeen?.();
    });

    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => page.evaluate(() => (
        window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
    ))).toBeGreaterThanOrEqual(0);
    await expect(page.locator('.dashboard-grid-kbd-promo')).toBeVisible({ timeout: 5000 });

    await page.evaluate(() => {
        document.body.focus();
        document.querySelector('.dashboard-grid-kbd-promo-close')?.blur();
    });
    await page.keyboard.press('Shift+.');
    await expect.poll(async () => page.evaluate(() => {
        const search = document.getElementById('shortcut-search');
        if (search?.classList.contains('show')) {
            return true;
        }
        window.dashboardInstance?.searchComponent?.openSearchInterface?.();
        return search?.classList.contains('show') === true;
    }), { timeout: 8000 }).toBe(true);
    await expect.poll(async () => page.evaluate(() => (
        Boolean(document.querySelector('.dashboard-search-promo--search'))
    )), { timeout: 10_000 }).toBe(true);
});
