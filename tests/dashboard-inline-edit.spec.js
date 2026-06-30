// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

test.describe('dashboard inline edit', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
    });

    test('; opens inline edit and Esc cancels without saving', async ({ page }) => {
        const nameBefore = await page.evaluate(() => {
            const kn = window.dashboardInstance?.keyboardNavigation;
            const row = kn?.navigableElements?.[kn.currentIndex];
            return row?.querySelector('.bookmark-text')?.textContent?.trim() || '';
        });
        expect(nameBefore.length).toBeGreaterThan(0);

        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-input').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.body.classList.contains('bookmark-inline-edit-active')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate(() => (
            window.FocusTrapUtils?.shouldTrapDashboardBackground?.() === true
        ))).toBe(true);

        await page.keyboard.press('Escape');
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate(() => (
            document.body.classList.contains('bookmark-inline-edit-active')
        ))).toBe(false);
        await expect.poll(async () => page.evaluate(() => (
            window.FocusTrapUtils?.shouldTrapDashboardBackground?.() === false
        ))).toBe(true);

        const nameAfter = await page.evaluate(() => {
            const kn = window.dashboardInstance?.keyboardNavigation;
            const row = kn?.navigableElements?.[kn.currentIndex];
            return row?.querySelector('.bookmark-text')?.textContent?.trim() || '';
        });
        expect(nameAfter).toBe(nameBefore);
    });

    test('Esc cancels inline edit when grid keyboard promo is still open', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        const whatsNew = page.locator('#app-modal.show');
        if (await whatsNew.count()) {
            await page.keyboard.press('Escape');
            await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
        }
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
        await expect(page.locator('.dashboard-grid-kbd-promo')).toBeVisible({ timeout: 3000 });

        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-input').first()).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
    });
});
