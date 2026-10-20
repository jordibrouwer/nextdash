// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Confetti is the default theme for new installs. Someone who already has a
 * dashboard on another theme is asked once whether to try it: one button
 * switches, the other is a final no.
 */
const PROMO_ID = 'confetti-theme-try-v1';

async function load(page, theme) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, theme }) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        window.dashboardInstance.settings.theme = theme;
    }, { id: PROMO_ID, theme });
}

test.describe('the Confetti invitation', () => {
    test('it asks someone on another theme, and Try Confetti switches to it', async ({ page }) => {
        await load(page, 'nord-dark');
        expect(await page.evaluate(() => window.DashboardConfettiNotice.render())).toBe(true);
        const card = page.locator('.confetti-theme-notice-card');
        await expect(card).toBeVisible();
        await card.locator('[data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-confetti-dark');
    });

    test('a light theme still gets the dark half', async ({ page }) => {
        await load(page, 'nord-light');
        await page.evaluate(() => window.DashboardConfettiNotice.render());
        await page.locator('.confetti-theme-notice-card [data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-confetti-dark');
    });

    test('after switching, the card stays and can go back to the previous theme', async ({ page }) => {
        await load(page, 'nord-light');
        await page.evaluate(() => window.DashboardConfettiNotice.render());
        const card = page.locator('.confetti-theme-notice-card');
        await card.locator('[data-ct-action="try"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-confetti-dark');
        await expect(card).toBeVisible();
        await expect(card.locator('[data-ct-action="try"]')).toHaveCount(0);
        await card.locator('[data-ct-action="back"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('nord-light');
        await expect(card).toHaveCount(0);
    });

    test('Keep Confetti closes the card and leaves the theme', async ({ page }) => {
        await load(page, 'nord-dark');
        await page.evaluate(() => window.DashboardConfettiNotice.render());
        const card = page.locator('.confetti-theme-notice-card');
        await card.locator('[data-ct-action="try"]').click();
        await card.locator('[data-ct-action="keep"]').click();
        await expect(card).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('look-confetti-dark');
    });

    test('Not interested closes it for good and keeps the theme', async ({ page }) => {
        await load(page, 'nord-dark');
        await page.evaluate(() => window.DashboardConfettiNotice.render());
        await page.locator('.confetti-theme-notice-card .quickstart-btn[data-ct-action="dismiss"]').click();
        await expect(page.locator('.confetti-theme-notice-card')).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('nord-dark');
        expect(await page.evaluate(() => window.DashboardConfettiNotice.shouldShow())).toBe(false);
    });

    test('someone already on Confetti is not asked', async ({ page }) => {
        await load(page, 'look-confetti-light');
        expect(await page.evaluate(() => window.DashboardConfettiNotice.shouldShow())).toBe(false);
    });
});
