// @ts-check
const { test, expect } = require('@playwright/test');

test('search promo shows after grid keyboard promo when opening >', async ({ page }) => {
    await page.addInitScript(() => {
        try {
            const release = '2026.06-dashboard-release-v71';
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
        } catch {
            // ignore
        }
    });

    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await page.evaluate(() => {
        [
            'nextdash:dashboard-search-promo-search-v2',
            'nextdash:dashboard-grid-keyboard-promo-confirmed-v1',
        ].forEach((k) => localStorage.removeItem(k));
        window.DashboardSearchPromo?.clearPromoSeen?.('search');
        window.DashboardGridKeyboardPromo?.clearPromoSeen?.();
    });

    const onboarding = page.locator('.onboarding-card');
    if (await onboarding.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(onboarding).toHaveCount(0, { timeout: 5000 });
    }

    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 5000 });
    }

    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => page.evaluate(() => (
        window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
    ))).toBeGreaterThanOrEqual(0);
    await expect(page.locator('.dashboard-grid-kbd-promo')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => page.locator('.dashboard-search-promo--search').isVisible(), {
        timeout: 5000,
    }).toBe(true);
});
